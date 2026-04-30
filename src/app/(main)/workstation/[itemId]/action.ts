"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { loadAntiCheatConfig } from "@/lib/anti-cheat-config";

export interface ScoreInput {
  dimensionId: string;
  value: number;
  failureTags: string[];
}

export interface SubmitPayload {
  itemId: string;
  scores: ScoreInput[];
  comment: string;
  watchRatio: number;
  dwellTimeMs: number;
  packageId?: string | null;
}

export interface SubmitResult {
  success: boolean;
  error?: string;
  nextItemId?: string | null;
}

export async function submitEvaluation(payload: SubmitPayload): Promise<SubmitResult> {
  const session = await getSession();
  if (!session) {
    return { success: false, error: "未登录" };
  }

  const { itemId, scores, comment, watchRatio, dwellTimeMs, packageId } = payload;

  // Validate scores synchronously before any DB hit so a malformed
  // payload doesn't cost roundtrips.
  for (const score of scores) {
    if (score.value < 1 || score.value > 5) {
      return { success: false, error: "分数必须在 1-5 之间 / Score must be 1-5" };
    }
    if (score.value <= 2 && score.failureTags.length === 0) {
      return { success: false, error: "分数 ≤ 2 时必须选择失败标签 / Failure tags required for score ≤ 2" };
    }
  }

  // ─── Parallel reads ─────────────────────────────────
  // Submit used to issue 5+ serial DB queries. Now: pull item-with-
  // duration, anti-cheat config, recent-scores window, and the
  // last-hour submit count concurrently. Order independence is fine
  // because we only USE these values further down once all four
  // resolve. Cuts submit latency by ~50-60% in practice.
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const [item, acConfig, recentScores, recentSubmitCount] = await Promise.all([
    // Combine the previous (item findUnique + videoAsset findFirst)
    // into one query via include, saving a round-trip for duration.
    prisma.evaluationItem.findUnique({
      where: { id: itemId },
      include: {
        videoAsset: { select: { durationSec: true } },
      },
    }),
    loadAntiCheatConfig(),
    prisma.score.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: 30, // safe upper bound; we'll trim below by acConfig.recentScoresWindow
      select: { value: true },
    }),
    prisma.evaluationItem.count({
      where: {
        assignedToId: session.userId,
        status: "COMPLETED",
        completedAt: { gte: oneHourAgo },
      },
    }),
  ]);

  if (!item || item.assignedToId !== session.userId) {
    return { success: false, error: "无权操作此任务" };
  }

  // Trim recentScores to the configured window after fetch.
  const recentScoresWindowed = recentScores.slice(0, acConfig.recentScoresWindow);

  const isRescore = item.status === "COMPLETED";

  // ─── Anti-cheat: enforce minimum watch ratio (skip for re-scoring) ───
  if (!isRescore && watchRatio < acConfig.minWatchRatio) {
    return {
      success: false,
      error: `请先观看至少 ${Math.round(acConfig.minWatchRatio * 100)}% 的视频 / Please watch at least ${Math.round(acConfig.minWatchRatio * 100)}% of the video`,
    };
  }

  // ─── Anti-cheat: enforce minimum dwell time ───
  const durationSec = item.videoAsset?.durationSec ?? 6;
  const minDwellMs = Math.max(acConfig.minDwellFloorMs, durationSec * acConfig.minDwellMultiplier * 1000);
  if (!isRescore && dwellTimeMs < minDwellMs) {
    return {
      success: false,
      error: "请在充分观看后再提交 / Please take sufficient time before submitting",
    };
  }

  // ─── Anti-cheat: detect fixed-value pattern ───
  const antiCheatEvents: { eventType: string; severity: string; payload: object }[] = [];
  let scoreValidity: "VALID" | "SUSPICIOUS" | "INVALID" = "VALID";

  if (recentScoresWindowed.length >= 10) {
    const valueCounts = new Map<number, number>();
    for (const s of recentScoresWindowed) {
      valueCounts.set(s.value, (valueCounts.get(s.value) ?? 0) + 1);
    }
    const maxCount = Math.max(...valueCounts.values());
    const dominantRatio = maxCount / recentScoresWindowed.length;

    if (dominantRatio > acConfig.fixedValueThreshold) {
      antiCheatEvents.push({
        eventType: "fixed_value_pattern",
        severity: "WARNING",
        payload: { dominantRatio, sampleSize: recentScoresWindowed.length },
      });
      scoreValidity = "SUSPICIOUS";
    }

    const mean = recentScoresWindowed.reduce((sum, s) => sum + s.value, 0) / recentScoresWindowed.length;
    const variance = recentScoresWindowed.reduce((sum, s) => sum + (s.value - mean) ** 2, 0) / recentScoresWindowed.length;
    const stddev = Math.sqrt(variance);
    if (stddev < acConfig.lowVarianceThreshold) {
      antiCheatEvents.push({
        eventType: "low_score_variance",
        severity: "WARNING",
        payload: { stddev, mean, sampleSize: recentScoresWindowed.length },
      });
      scoreValidity = "SUSPICIOUS";
    }
  }

  // ─── Anti-cheat: high-frequency submission check ───
  // recentSubmitCount was already fetched in the parallel block above.
  if (recentSubmitCount > acConfig.maxSubmitsPerHour) {
    await prisma.antiCheatEvent.create({
      data: {
        evaluationItemId: itemId,
        userId: session.userId,
        eventType: "high_frequency_submit",
        severity: "CRITICAL",
        payload: { submitsInLastHour: recentSubmitCount },
        watchRatio,
        dwellTimeMs,
      },
    });
    return {
      success: false,
      error: "提交频率过高，请稍后再试 / Too many submissions, please wait",
    };
  }

  // Low watch ratio → record as warning (even if above threshold)
  if (watchRatio < 0.9) {
    antiCheatEvents.push({
      eventType: "low_watch_ratio",
      severity: watchRatio < acConfig.minWatchRatio + 0.05 ? "WARNING" : "INFO",
      payload: { watchRatio },
    });
  }

  // Write everything in a transaction
  await prisma.$transaction(async (tx) => {
    // Upsert scores: create on first submit, update on re-score
    for (const s of scores) {
      await tx.score.upsert({
        where: {
          evaluationItemId_dimensionId_userId: {
            evaluationItemId: itemId,
            dimensionId: s.dimensionId,
            userId: session.userId,
          },
        },
        create: {
          evaluationItemId: itemId,
          dimensionId: s.dimensionId,
          userId: session.userId,
          value: s.value,
          failureTags: s.failureTags,
          comment: comment || null,
          validity: scoreValidity,
        },
        update: {
          value: s.value,
          failureTags: s.failureTags,
          comment: comment || null,
          validity: scoreValidity,
        },
      });
    }

    // Update evaluation item status
    await tx.evaluationItem.update({
      where: { id: itemId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        dwellTimeMs,
      },
    });

    // Record anti-cheat events
    if (antiCheatEvents.length > 0) {
      await tx.antiCheatEvent.createMany({
        data: antiCheatEvents.map((e) => ({
          evaluationItemId: itemId,
          userId: session.userId,
          eventType: e.eventType,
          severity: e.severity,
          payload: e.payload,
          watchRatio,
          dwellTimeMs,
        })),
      });
    }
  });

  // Find next item — scope to the current package to prevent cross-package
  // leakage. Fall back to the just-submitted item's own packageId if the
  // client didn't pass one (older clients). EvaluationItem.packageId is
  // authoritative; videoAsset.packageId is legacy 1:1 and breaks on Dataset reuse.
  const scopePackageId = packageId ?? item.packageId ?? null;
  const nextItem = await prisma.evaluationItem.findFirst({
    where: {
      assignedToId: session.userId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      id: { not: itemId },
      ...(scopePackageId ? { packageId: scopePackageId } : {}),
    },
    orderBy: [
      { videoAsset: { prompt: { externalId: "asc" } } },
      { id: "asc" },
    ],
    select: { id: true },
  });

  return { success: true, nextItemId: nextItem?.id ?? null };
}
