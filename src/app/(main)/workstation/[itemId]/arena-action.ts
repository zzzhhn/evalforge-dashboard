"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadAntiCheatConfig } from "@/lib/anti-cheat-config";
import type { ArenaVerdict } from "@prisma/client";

export interface ArenaSubmitPayload {
  itemId: string;
  verdict: ArenaVerdict;
  watchRatioA: number;
  watchRatioB: number;
  dwellTimeMs: number;
}

export interface ArenaSubmitResult {
  success: boolean;
  error?: string;
  nextItemId?: string | null;
}

const VALID_VERDICTS: ReadonlySet<ArenaVerdict> = new Set([
  "LEFT_WINS",
  "RIGHT_WINS",
  "BOTH_GOOD",
  "BOTH_BAD",
]);

export async function submitArenaVerdict(
  payload: ArenaSubmitPayload,
): Promise<ArenaSubmitResult> {
  const session = await getSession();
  if (!session) return { success: false, error: "未登录 / Not logged in" };

  const { itemId, verdict, watchRatioA, watchRatioB, dwellTimeMs } = payload;

  if (!VALID_VERDICTS.has(verdict)) {
    return { success: false, error: "无效的投票结果 / Invalid verdict" };
  }

  const item = await prisma.arenaItem.findUnique({
    where: { id: itemId },
    include: {
      videoAssetA: { select: { durationSec: true } },
      videoAssetB: { select: { durationSec: true } },
    },
  });

  if (!item || item.assignedToId !== session.userId) {
    return { success: false, error: "无权操作此任务 / Unauthorized" };
  }

  const isRevote = item.status === "COMPLETED";
  const acConfig = await loadAntiCheatConfig();

  // Dual watch-ratio threshold: weakest side gates the submission.
  const minRatio = Math.min(watchRatioA, watchRatioB);
  if (!isRevote && minRatio < acConfig.minWatchRatio) {
    return {
      success: false,
      error: `请先观看两个视频各至少 ${Math.round(acConfig.minWatchRatio * 100)}% / Please watch at least ${Math.round(acConfig.minWatchRatio * 100)}% of BOTH videos`,
    };
  }

  // Dwell gate: base on shorter of the two videos (fallback 6s each).
  const durationA = item.videoAssetA.durationSec ?? 6;
  const durationB = item.videoAssetB.durationSec ?? 6;
  const combinedDurationSec = Math.max(durationA, durationB);
  const minDwellMs = Math.max(
    acConfig.minDwellFloorMs,
    combinedDurationSec * acConfig.minDwellMultiplier * 1000,
  );
  if (!isRevote && dwellTimeMs < minDwellMs) {
    return {
      success: false,
      error: "请在充分观看后再提交 / Please take sufficient time before submitting",
    };
  }

  // High-frequency submission check: count arena + scoring submits together.
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const [arenaRecent, scoringRecent] = await Promise.all([
    prisma.arenaItem.count({
      where: {
        assignedToId: session.userId,
        status: "COMPLETED",
        completedAt: { gte: oneHourAgo },
      },
    }),
    prisma.evaluationItem.count({
      where: {
        assignedToId: session.userId,
        status: "COMPLETED",
        completedAt: { gte: oneHourAgo },
      },
    }),
  ]);
  const recentSubmitCount = arenaRecent + scoringRecent;

  if (recentSubmitCount > acConfig.maxSubmitsPerHour) {
    await prisma.antiCheatEvent.create({
      data: {
        arenaItemId: itemId,
        userId: session.userId,
        eventType: "high_frequency_submit",
        severity: "CRITICAL",
        payload: { submitsInLastHour: recentSubmitCount, context: "arena" },
        watchRatio: minRatio,
        dwellTimeMs,
      },
    });
    return {
      success: false,
      error: "提交频率过高，请稍后再试 / Too many submissions, please wait",
    };
  }

  // Arena-specific suspicion: always-same-side pattern.
  const antiCheatEvents: {
    eventType: string;
    severity: string;
    payload: object;
  }[] = [];

  const recentVerdicts = await prisma.arenaItem.findMany({
    where: {
      assignedToId: session.userId,
      status: "COMPLETED",
      verdict: { not: null },
    },
    orderBy: { completedAt: "desc" },
    take: acConfig.recentScoresWindow,
    select: { verdict: true },
  });

  if (recentVerdicts.length >= 10) {
    const verdictCounts = new Map<ArenaVerdict, number>();
    for (const v of recentVerdicts) {
      if (!v.verdict) continue;
      verdictCounts.set(v.verdict, (verdictCounts.get(v.verdict) ?? 0) + 1);
    }
    const maxCount = Math.max(...verdictCounts.values());
    const dominantRatio = maxCount / recentVerdicts.length;
    if (dominantRatio > acConfig.fixedValueThreshold) {
      antiCheatEvents.push({
        eventType: "arena_fixed_verdict_pattern",
        severity: "WARNING",
        payload: {
          dominantRatio,
          sampleSize: recentVerdicts.length,
        },
      });
    }
  }

  // Low combined watch ratio info event (records for analysis, not blocking).
  if (minRatio < 0.9) {
    antiCheatEvents.push({
      eventType: "arena_low_watch_ratio",
      severity:
        minRatio < acConfig.minWatchRatio + 0.05 ? "WARNING" : "INFO",
      payload: { watchRatioA, watchRatioB, minRatio },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.arenaItem.update({
      where: { id: itemId },
      data: {
        status: "COMPLETED",
        verdict,
        completedAt: new Date(),
        dwellTimeMs,
        version: { increment: 1 },
      },
    });

    if (antiCheatEvents.length > 0) {
      await tx.antiCheatEvent.createMany({
        data: antiCheatEvents.map((e) => ({
          arenaItemId: itemId,
          userId: session.userId,
          eventType: e.eventType,
          severity: e.severity,
          payload: e.payload,
          watchRatio: minRatio,
          dwellTimeMs,
        })),
      });
    }
  });

  // Find next pending arena item in the same package.
  const nextItem = await prisma.arenaItem.findFirst({
    where: {
      assignedToId: session.userId,
      packageId: item.packageId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      id: { not: itemId },
    },
    orderBy: { prompt: { externalId: "asc" } },
    select: { id: true },
  });

  return { success: true, nextItemId: nextItem?.id ?? null };
}

/**
 * Periodic watch-progress sync for Arena items.
 * Persists per-second watched arrays for both videos so restart/reload is resilient.
 */
export async function syncArenaWatchProgress(
  itemId: string,
  watchedSecondsA: number[],
  watchedSecondsB: number[],
  version: number,
): Promise<{ success: boolean; version: number }> {
  const session = await getSession();
  if (!session) return { success: false, version };

  const result = await prisma.arenaItem.updateMany({
    where: {
      id: itemId,
      assignedToId: session.userId,
      version,
    },
    data: {
      watchProgressA: watchedSecondsA,
      watchProgressB: watchedSecondsB,
      version: { increment: 1 },
    },
  });

  if (result.count === 0) {
    // Version mismatch: fetch latest and return
    const latest = await prisma.arenaItem.findUnique({
      where: { id: itemId },
      select: { version: true },
    });
    return { success: false, version: latest?.version ?? version };
  }

  return { success: true, version: version + 1 };
}
