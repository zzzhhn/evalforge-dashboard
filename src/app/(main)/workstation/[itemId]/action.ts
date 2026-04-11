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

  const { itemId, scores, comment, watchRatio, dwellTimeMs } = payload;

  const item = await prisma.evaluationItem.findUnique({
    where: { id: itemId },
  });

  if (!item || item.assignedToId !== session.userId) {
    return { success: false, error: "无权操作此任务" };
  }

  if (item.status === "COMPLETED") {
    return { success: false, error: "该任务已完成" };
  }

  for (const score of scores) {
    if (score.value < 1 || score.value > 5) {
      return { success: false, error: "分数必须在 1-5 之间 / Score must be 1-5" };
    }
    if (score.value <= 2 && score.failureTags.length === 0) {
      return { success: false, error: "分数 ≤ 2 时必须选择失败标签 / Failure tags required for score ≤ 2" };
    }
  }

  // ─── Load configurable anti-cheat parameters ───
  const acConfig = await loadAntiCheatConfig();

  // ─── Anti-cheat: enforce minimum watch ratio ───
  if (watchRatio < acConfig.minWatchRatio) {
    return {
      success: false,
      error: `请先观看至少 ${Math.round(acConfig.minWatchRatio * 100)}% 的视频 / Please watch at least ${Math.round(acConfig.minWatchRatio * 100)}% of the video`,
    };
  }

  // ─── Anti-cheat: enforce minimum dwell time ───
  const videoDuration = await prisma.videoAsset.findFirst({
    where: { evaluationItems: { some: { id: itemId } } },
    select: { durationSec: true },
  });
  const durationSec = videoDuration?.durationSec ?? 6;
  const minDwellMs = Math.max(acConfig.minDwellFloorMs, durationSec * acConfig.minDwellMultiplier * 1000);
  if (dwellTimeMs < minDwellMs) {
    return {
      success: false,
      error: "请在充分观看后再提交 / Please take sufficient time before submitting",
    };
  }

  // ─── Anti-cheat: detect fixed-value pattern ───
  const antiCheatEvents: { eventType: string; severity: string; payload: object }[] = [];
  let scoreValidity: "VALID" | "SUSPICIOUS" | "INVALID" = "VALID";

  const recentScores = await prisma.score.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: acConfig.recentScoresWindow,
    select: { value: true },
  });

  if (recentScores.length >= 10) {
    const valueCounts = new Map<number, number>();
    for (const s of recentScores) {
      valueCounts.set(s.value, (valueCounts.get(s.value) ?? 0) + 1);
    }
    const maxCount = Math.max(...valueCounts.values());
    const dominantRatio = maxCount / recentScores.length;

    if (dominantRatio > acConfig.fixedValueThreshold) {
      antiCheatEvents.push({
        eventType: "fixed_value_pattern",
        severity: "WARNING",
        payload: { dominantRatio, sampleSize: recentScores.length },
      });
      scoreValidity = "SUSPICIOUS";
    }

    const mean = recentScores.reduce((sum, s) => sum + s.value, 0) / recentScores.length;
    const variance = recentScores.reduce((sum, s) => sum + (s.value - mean) ** 2, 0) / recentScores.length;
    const stddev = Math.sqrt(variance);
    if (stddev < acConfig.lowVarianceThreshold) {
      antiCheatEvents.push({
        eventType: "low_score_variance",
        severity: "WARNING",
        payload: { stddev, mean, sampleSize: recentScores.length },
      });
      scoreValidity = "SUSPICIOUS";
    }
  }

  // ─── Anti-cheat: high-frequency submission check ───
  const oneHourAgo = new Date(Date.now() - 3600_000);
  const recentSubmitCount = await prisma.evaluationItem.count({
    where: {
      assignedToId: session.userId,
      status: "COMPLETED",
      completedAt: { gte: oneHourAgo },
    },
  });
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

  if (watchRatio < 0.9) {
    antiCheatEvents.push({
      eventType: "low_watch_ratio",
      severity: watchRatio < acConfig.minWatchRatio + 0.05 ? "WARNING" : "INFO",
      payload: { watchRatio },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.score.createMany({
      data: scores.map((s) => ({
        evaluationItemId: itemId,
        dimensionId: s.dimensionId,
        userId: session.userId,
        value: s.value,
        failureTags: s.failureTags,
        comment: comment || null,
        validity: scoreValidity,
      })),
    });

    await tx.evaluationItem.update({
      where: { id: itemId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        dwellTimeMs,
      },
    });

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

  const nextItem = await prisma.evaluationItem.findFirst({
    where: {
      assignedToId: session.userId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      id: { not: itemId },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return { success: true, nextItemId: nextItem?.id ?? null };
}
