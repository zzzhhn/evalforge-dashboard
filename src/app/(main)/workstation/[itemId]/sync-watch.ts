"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * Sync watched seconds array to server for persistence across navigations.
 * Uses optimistic concurrency via version field to prevent race conditions.
 */
export async function syncWatchProgress(
  itemId: string,
  watchedSeconds: number[],
  version: number
): Promise<{ success: boolean; version: number }> {
  const session = await getSession();
  if (!session) return { success: false, version };

  // Input validation: bounds check on array size and element values
  if (!Array.isArray(watchedSeconds) || watchedSeconds.length > 10_000) {
    return { success: false, version };
  }
  if (!watchedSeconds.every((n) => Number.isFinite(n) && n >= 0 && n < 86400)) {
    return { success: false, version };
  }

  try {
    const updated = await prisma.evaluationItem.updateMany({
      where: {
        id: itemId,
        assignedToId: session.userId,
        version, // optimistic lock
      },
      data: {
        watchProgress: watchedSeconds,
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      // Version mismatch — fetch latest
      const latest = await prisma.evaluationItem.findUnique({
        where: { id: itemId },
        select: { version: true },
      });
      return { success: false, version: latest?.version ?? version };
    }

    return { success: true, version: version + 1 };
  } catch {
    return { success: false, version };
  }
}
