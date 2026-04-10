"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

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

  // Validate item ownership
  const item = await prisma.evaluationItem.findUnique({
    where: { id: itemId },
  });

  if (!item || item.assignedToId !== session.userId) {
    return { success: false, error: "无权操作此任务" };
  }

  if (item.status === "COMPLETED") {
    return { success: false, error: "该任务已完成" };
  }

  // Validate scores: value must be 1-5, failure tags required when ≤ 2
  for (const score of scores) {
    if (score.value < 1 || score.value > 5) {
      return { success: false, error: `分数必须在 1-5 之间` };
    }
    if (score.value <= 2 && score.failureTags.length === 0) {
      return { success: false, error: `分数 ≤ 2 时必须选择失败标签` };
    }
  }

  // Anti-cheat checks (record events, don't block in demo)
  const antiCheatEvents: { eventType: string; severity: string; payload: object }[] = [];

  if (watchRatio < 0.8) {
    antiCheatEvents.push({
      eventType: "low_watch_ratio",
      severity: watchRatio < 0.3 ? "CRITICAL" : "WARNING",
      payload: { watchRatio },
    });
  }

  if (dwellTimeMs < 5000) {
    antiCheatEvents.push({
      eventType: "rapid_submit",
      severity: dwellTimeMs < 2000 ? "CRITICAL" : "WARNING",
      payload: { dwellTimeMs },
    });
  }

  // Check for all-same-value pattern
  const uniqueValues = new Set(scores.map((s) => s.value));
  if (scores.length >= 3 && uniqueValues.size === 1) {
    antiCheatEvents.push({
      eventType: "fixed_value",
      severity: "WARNING",
      payload: { value: scores[0].value, dimensionCount: scores.length },
    });
  }

  // Write everything in a transaction
  await prisma.$transaction(async (tx) => {
    // Create scores
    await tx.score.createMany({
      data: scores.map((s) => ({
        evaluationItemId: itemId,
        dimensionId: s.dimensionId,
        userId: session.userId,
        value: s.value,
        failureTags: s.failureTags,
        comment: comment || null,
      })),
    });

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

  // Find next item
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
