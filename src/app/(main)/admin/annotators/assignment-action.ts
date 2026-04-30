"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import {
  getAdminScope,
  filterManageableUsers,
  type AdminScope,
} from "@/lib/admin-scope";

type ActionResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

// SYSTEM-only gate. Rejects GROUP admins (used for edits that access
// personal info or cross-group concerns).
async function requireSystem(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind !== "SYSTEM") {
    return { ok: false, message: "Forbidden: system admin only" };
  }
  return { ok: true };
}

// Scope-aware auth gate. SYSTEM admins (ADMIN/RESEARCHER) always pass.
// GROUP admins pass only if every targetUserId belongs to one of the
// groups they administer. If targetUserIds is omitted (caller has no
// per-user targets, e.g. pure metadata edits), GROUP admins also pass.
async function requireScope(
  targetUserIds?: string[],
): Promise<
  | { ok: true; scope: AdminScope & { kind: "SYSTEM" | "GROUP" }; userId: string }
  | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") {
    return { ok: false, message: "Unauthorized" };
  }
  if (scope.kind === "GROUP" && targetUserIds && targetUserIds.length > 0) {
    const allowed = await filterManageableUsers(scope, targetUserIds);
    if (allowed.size !== targetUserIds.length) {
      return {
        ok: false,
        message: `Forbidden: ${targetUserIds.length - allowed.size} target user(s) are outside your group`,
      };
    }
  }
  return { ok: true, scope, userId: scope.userId };
}

/**
 * Batch-remove annotators from a single package.
 * Only deletes NOT-yet-completed items — completed evaluation items are preserved
 * to avoid losing historical scoring data. Returns per-user tallies.
 */
export async function batchRemoveFromPackage(
  packageId: string,
  userIds: string[]
): Promise<ActionResult<{ removed: number; skippedCompleted: number }>> {
  const auth = await requireScope(userIds);
  if (!auth.ok) return { status: "error", message: auth.message };
  if (userIds.length === 0) {
    return { status: "error", message: "No annotators selected" };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, deletedAt: true },
  });
  if (!pkg || pkg.deletedAt) {
    return { status: "error", message: "Package not found" };
  }

  // Count completed (skipped) items up front for the return value.
  const skippedCompleted = await prisma.evaluationItem.count({
    where: {
      packageId,
      assignedToId: { in: userIds },
      status: "COMPLETED",
    },
  });

  const deleted = await prisma.evaluationItem.deleteMany({
    where: {
      packageId,
      assignedToId: { in: userIds },
      status: { not: "COMPLETED" },
    },
  });

  revalidatePath("/admin/annotators");
  revalidatePath("/admin/samples");
  return {
    status: "ok",
    data: { removed: deleted.count, skippedCompleted },
  };
}

/**
 * Bulk add + remove annotators on a single package in one transactional call.
 * Used by the "按任务批量调整" dialog in Phase 8 Sub-phase C.
 *
 * Semantics:
 * - addUserIds: clones the package's existing (asset × dim) pair set (or ArenaItem
 *   template) onto the new user. Skips users already assigned (idempotent).
 * - removeUserIds: deletes non-COMPLETED EvaluationItem/ArenaItem rows; COMPLETED
 *   rows are preserved to retain historical scores.
 *
 * Returns per-operation tallies so the dialog can render a precise summary.
 */
export async function adjustPackageAssignment(
  packageId: string,
  addUserIds: string[],
  removeUserIds: string[]
): Promise<
  ActionResult<{
    added: { userId: string; itemCount: number; alreadyAssigned: boolean }[];
    removed: number;
    skippedCompleted: number;
  }>
> {
  const auth = await requireScope([...addUserIds, ...removeUserIds]);
  if (!auth.ok) return { status: "error", message: auth.message };

  if (addUserIds.length === 0 && removeUserIds.length === 0) {
    return { status: "error", message: "No changes requested" };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, deletedAt: true, evaluationMode: true },
  });
  if (!pkg || pkg.deletedAt) {
    return { status: "error", message: "Package not found" };
  }

  // --- Remove path ---
  let removed = 0;
  let skippedCompleted = 0;
  if (removeUserIds.length > 0) {
    skippedCompleted = await prisma.evaluationItem.count({
      where: {
        packageId,
        assignedToId: { in: removeUserIds },
        status: "COMPLETED",
      },
    });
    skippedCompleted += await prisma.arenaItem.count({
      where: {
        packageId,
        assignedToId: { in: removeUserIds },
        status: "COMPLETED",
      },
    });

    const delEval = await prisma.evaluationItem.deleteMany({
      where: {
        packageId,
        assignedToId: { in: removeUserIds },
        status: { not: "COMPLETED" },
      },
    });
    const delArena = await prisma.arenaItem.deleteMany({
      where: {
        packageId,
        assignedToId: { in: removeUserIds },
        status: { not: "COMPLETED" },
      },
    });
    removed = delEval.count + delArena.count;
  }

  // --- Add path ---
  const added: { userId: string; itemCount: number; alreadyAssigned: boolean }[] = [];

  if (addUserIds.length > 0) {
    if (pkg.evaluationMode === "ARENA") {
      const template = await prisma.arenaItem.findMany({
        where: { packageId },
        distinct: ["promptId", "dimensionId"],
        select: {
          promptId: true,
          dimensionId: true,
          videoAssetAId: true,
          videoAssetBId: true,
        },
      });
      if (template.length === 0) {
        return { status: "error", message: "Package has no arena items to clone" };
      }

      for (const userId of addUserIds) {
        const existing = await prisma.arenaItem.count({
          where: { packageId, assignedToId: userId },
        });
        if (existing > 0) {
          added.push({ userId, itemCount: existing, alreadyAssigned: true });
          continue;
        }
        const result = await prisma.arenaItem.createMany({
          data: template.map((t) => ({
            packageId,
            promptId: t.promptId,
            dimensionId: t.dimensionId,
            videoAssetAId: t.videoAssetAId,
            videoAssetBId: t.videoAssetBId,
            assignedToId: userId,
          })),
          skipDuplicates: true,
        });
        added.push({ userId, itemCount: result.count, alreadyAssigned: false });
      }
    } else {
      // Scoring mode: clone (asset, dim) pair set.
      // 2026-04-29: dropped legacy { packageId: null, videoAsset.packageId }
      // fallback. EvaluationItem.packageId is authoritative; legacy
      // VideoAsset.packageId has drifted (5 conflict groups in prod) and
      // would pull cross-package items into the clone. Q3 confirms 0 items
      // with packageId IS NULL remain.
      const templateItems = await prisma.evaluationItem.findMany({
        where: { packageId },
        select: { videoAssetId: true, dimensionId: true },
      });
      if (templateItems.length === 0) {
        return { status: "error", message: "Package has no evaluation items to clone" };
      }
      const pairSet = new Set<string>();
      const pairs: Array<{ videoAssetId: string; dimensionId: string }> = [];
      for (const item of templateItems) {
        const key = `${item.videoAssetId}|${item.dimensionId}`;
        if (!pairSet.has(key)) {
          pairSet.add(key);
          pairs.push({
            videoAssetId: item.videoAssetId,
            dimensionId: item.dimensionId,
          });
        }
      }

      for (const userId of addUserIds) {
        const existing = await prisma.evaluationItem.count({
          where: { packageId, assignedToId: userId },
        });
        if (existing > 0) {
          added.push({ userId, itemCount: existing, alreadyAssigned: true });
          continue;
        }
        const result = await prisma.evaluationItem.createMany({
          data: pairs.map((p) => ({
            videoAssetId: p.videoAssetId,
            dimensionId: p.dimensionId,
            assignedToId: userId,
            packageId,
          })),
          skipDuplicates: true,
        });
        added.push({ userId, itemCount: result.count, alreadyAssigned: false });
      }
    }

    // Increment annotatorCount for newly-assigned users only.
    const newlyAssignedCount = added.filter((a) => !a.alreadyAssigned).length;
    if (newlyAssignedCount > 0) {
      await prisma.evaluationPackage.update({
        where: { id: packageId },
        data: { annotatorCount: { increment: newlyAssignedCount } },
      });
    }
  }

  revalidatePath("/admin/annotators");
  revalidatePath("/admin/samples");
  return { status: "ok", data: { added, removed, skippedCompleted } };
}

export async function updatePersonalInfo(
  userId: string,
  patch: {
    gender?: string | null;
    ageRange?: string | null;
    city?: string | null;
    education?: string | null;
  }
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireSystem();
  if (!auth.ok) return { status: "error", message: auth.message };

  const clean = (v: string | null | undefined): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const trimmed = v.trim();
    return trimmed ? trimmed.slice(0, 64) : null;
  };

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        ...(patch.gender !== undefined ? { gender: clean(patch.gender) } : {}),
        ...(patch.ageRange !== undefined ? { ageRange: clean(patch.ageRange) } : {}),
        ...(patch.city !== undefined ? { city: clean(patch.city) } : {}),
        ...(patch.education !== undefined ? { education: clean(patch.education) } : {}),
      },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { id: userId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "User not found" };
    }
    throw err;
  }
}
