"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export interface PackageDetailAsset {
  id: string;
  promptZh: string;
  promptEn: string;
  externalId: string;
  modelName: string;
  taskType: string;
  durationSec: number | null;
  completedItems: number;
  totalItems: number;
}

export interface PackageDetailAnnotatorStat {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  assigned: number;
  completed: number;
  scoreCount: number;
  avgScore: number | null;
  lastSubmittedAt: string | null;
  isSuspended: boolean;
  // Merged from legacy Assignment view so admins see the full picture in
  // one table instead of flipping between two surfaces.
  riskLevel: string;
  groupName: string | null;
  isGroupAdmin: boolean;
  suspiciousCount: number;
  capability: {
    accuracy: number;
    consistency: number;
    coverage: number;
    detailOriented: number;
    speed: number;
    compositeScore: number;
  } | null;
}

export interface PackageDetailData {
  packageId: string;
  packageName: string;
  deadline: string | null;
  assets: PackageDetailAsset[];
  annotatorStats: PackageDetailAnnotatorStat[];
}

export async function fetchPackageDetail(
  packageId: string,
): Promise<
  | { status: "ok"; data: PackageDetailData }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    include: {
      // EvaluationItem.packageId is authoritative; videoAsset.packageId is
      // stale for Dataset-reused packages. Query items by package directly
      // instead of traversing through videoAssets.
      evaluationItems: {
        where: { packageId },
        select: {
          status: true,
          assignedToId: true,
          videoAssetId: true,
          videoAsset: {
            include: {
              model: true,
              prompt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      arenaItems: {
        include: {
          prompt: true,
          videoAssetA: { include: { model: true } },
          videoAssetB: { include: { model: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!pkg || pkg.deletedAt) return { status: "error", message: "Package not found" };

  const isArena = pkg.evaluationMode === "ARENA";

  const annotatorMap = new Map<
    string,
    { assigned: number; completed: number; expired: number }
  >();
  if (isArena) {
    for (const ai of pkg.arenaItems) {
      const entry = annotatorMap.get(ai.assignedToId) ?? {
        assigned: 0,
        completed: 0,
        expired: 0,
      };
      entry.assigned += 1;
      if (ai.status === "COMPLETED") entry.completed += 1;
      if (ai.status === "EXPIRED") entry.expired += 1;
      annotatorMap.set(ai.assignedToId, entry);
    }
  } else {
    for (const item of pkg.evaluationItems) {
      const uid = item.assignedToId;
      const entry = annotatorMap.get(uid) ?? {
        assigned: 0,
        completed: 0,
        expired: 0,
      };
      entry.assigned += 1;
      if (item.status === "COMPLETED") entry.completed += 1;
      if (item.status === "EXPIRED") entry.expired += 1;
      annotatorMap.set(uid, entry);
    }
  }

  const annotatorIds = [...annotatorMap.keys()];
  const [users, scoreAggs, suspiciousAggs] = await Promise.all([
    annotatorIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: annotatorIds } },
          select: {
            id: true,
            name: true,
            email: true,
            accountType: true,
            riskLevel: true,
            groupMemberships: {
              select: {
                isAdmin: true,
                group: { select: { name: true } },
              },
            },
            capabilityAssessments: {
              orderBy: { assessmentDate: "desc" },
              take: 1,
              select: {
                accuracy: true,
                consistency: true,
                coverage: true,
                detailOriented: true,
                speed: true,
                compositeScore: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    annotatorIds.length > 0
      ? prisma.score.groupBy({
          by: ["userId"],
          where: {
            // EvaluationItem.packageId is authoritative; videoAsset.packageId
            // is stale for Dataset-reused packages.
            evaluationItem: { packageId },
            userId: { in: annotatorIds },
          },
          _avg: { value: true },
          _count: { value: true },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    annotatorIds.length > 0
      ? prisma.score.groupBy({
          by: ["userId"],
          where: {
            evaluationItem: { packageId },
            userId: { in: annotatorIds },
            validity: "SUSPICIOUS",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const aggMap = new Map(scoreAggs.map((a) => [a.userId, a]));
  const suspiciousMap = new Map(
    suspiciousAggs.map((s) => [s.userId, s._count._all]),
  );

  const annotatorStats: PackageDetailAnnotatorStat[] = annotatorIds.map((uid) => {
    const user = userMap.get(uid);
    const counts = annotatorMap.get(uid)!;
    const agg = aggMap.get(uid);
    const primaryMembership = user?.groupMemberships[0];
    return {
      userId: uid,
      name: user?.name ?? uid,
      email: user?.email ?? "",
      accountType: user?.accountType ?? "INTERNAL",
      assigned: counts.assigned,
      completed: counts.completed,
      scoreCount: agg?._count?.value ?? 0,
      avgScore: agg?._avg?.value ?? null,
      lastSubmittedAt: agg?._max?.createdAt?.toISOString() ?? null,
      isSuspended: counts.expired > 0 && counts.completed < counts.assigned,
      riskLevel: user?.riskLevel ?? "LOW_RISK",
      groupName: primaryMembership?.group.name ?? null,
      isGroupAdmin: user?.groupMemberships.some((m) => m.isAdmin) ?? false,
      suspiciousCount: suspiciousMap.get(uid) ?? 0,
      capability: user?.capabilityAssessments[0] ?? null,
    };
  });

  const assets: PackageDetailAsset[] = isArena
    ? // Arena: one row per pair (prompt), completedItems counts verdicts cast
      (() => {
        const byPrompt = new Map<
          string,
          {
            promptZh: string;
            promptEn: string;
            externalId: string;
            modelA: string;
            modelB: string;
            taskType: string;
            durationSec: number | null;
            completed: number;
            total: number;
          }
        >();
        for (const ai of pkg.arenaItems) {
          const key = ai.promptId;
          const entry = byPrompt.get(key) ?? {
            promptZh: ai.prompt.textZh,
            promptEn: ai.prompt.textEn,
            externalId: ai.prompt.externalId,
            modelA: ai.videoAssetA.model.name,
            modelB: ai.videoAssetB.model.name,
            taskType: ai.videoAssetA.model.taskType,
            durationSec: ai.videoAssetA.durationSec,
            completed: 0,
            total: 0,
          };
          entry.total += 1;
          if (ai.status === "COMPLETED") entry.completed += 1;
          byPrompt.set(key, entry);
        }
        return [...byPrompt.entries()].map(([promptId, e]) => ({
          id: promptId,
          promptZh: e.promptZh,
          promptEn: e.promptEn,
          externalId: e.externalId,
          modelName: `${e.modelA} vs ${e.modelB}`,
          taskType: e.taskType,
          durationSec: e.durationSec,
          completedItems: e.completed,
          totalItems: e.total,
        }));
      })()
    : (() => {
        // Dedup by videoAssetId: one row per VideoAsset, counting items.
        const byAsset = new Map<
          string,
          {
            va: (typeof pkg.evaluationItems)[number]["videoAsset"];
            completed: number;
            total: number;
          }
        >();
        for (const item of pkg.evaluationItems) {
          const existing = byAsset.get(item.videoAssetId);
          if (existing) {
            existing.total += 1;
            if (item.status === "COMPLETED") existing.completed += 1;
          } else {
            byAsset.set(item.videoAssetId, {
              va: item.videoAsset,
              total: 1,
              completed: item.status === "COMPLETED" ? 1 : 0,
            });
          }
        }
        return [...byAsset.values()].map(({ va, completed, total }) => ({
          id: va.id,
          promptZh: va.prompt.textZh,
          promptEn: va.prompt.textEn,
          externalId: va.prompt.externalId,
          modelName: va.model.name,
          taskType: va.model.taskType,
          durationSec: va.durationSec,
          completedItems: completed,
          totalItems: total,
        }));
      })();

  return {
    status: "ok",
    data: {
      packageId,
      packageName: pkg.name,
      deadline: pkg.deadline?.toISOString() ?? null,
      assets,
      annotatorStats,
    },
  };
}

type TargetStatus = "PUBLISHED" | "RECALLED" | "ARCHIVED";

const VALID_TRANSITIONS: Record<string, TargetStatus[]> = {
  DRAFT: ["PUBLISHED"],
  PUBLISHED: ["RECALLED", "ARCHIVED"],
  RECALLED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: [],
};

export async function updatePackageStatus(
  packageId: string,
  targetStatus: TargetStatus
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { status: true },
  });

  if (!pkg) {
    return { status: "error", message: "Package not found" };
  }

  const allowed = VALID_TRANSITIONS[pkg.status] ?? [];
  if (!allowed.includes(targetStatus)) {
    return {
      status: "error",
      message: `Cannot transition from ${pkg.status} to ${targetStatus}`,
    };
  }

  const now = new Date();
  const updateData: Record<string, unknown> = { status: targetStatus };

  if (targetStatus === "PUBLISHED" && pkg.status === "DRAFT") {
    updateData.publishedAt = now;
  }
  if (targetStatus === "RECALLED") {
    updateData.recalledAt = now;
  }
  if (targetStatus === "PUBLISHED" && pkg.status === "RECALLED") {
    // Resuming: clear recalledAt
    updateData.recalledAt = null;
  }

  await prisma.evaluationPackage.update({
    where: { id: packageId },
    data: updateData,
  });

  return { status: "ok" };
}

/**
 * Edit package metadata in-place. Only fields that are typically wrong
 * after creation are editable here:
 *   - name (人类可读名)
 *   - modelCheckpoint / version
 *   - description
 * Model entities themselves and the prompt suite are NOT touched —
 * those affect VideoAsset / EvaluationItem identity and need a different
 * action path. UI calls this from the package detail panel via the
 * "编辑" button next to the title.
 */
export async function updatePackageInfo(
  packageId: string,
  patch: {
    name?: string;
    modelCheckpoint?: string | null;
    description?: string | null;
  },
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  const trimmedName = patch.name?.trim();
  if (patch.name !== undefined && (!trimmedName || trimmedName.length === 0)) {
    return { status: "error", message: "Package name cannot be empty" };
  }
  if (trimmedName && trimmedName.length > 200) {
    return { status: "error", message: "Package name too long (>200)" };
  }

  const data: Record<string, unknown> = {};
  if (trimmedName !== undefined) data.name = trimmedName;
  if (patch.modelCheckpoint !== undefined) {
    data.modelCheckpoint = patch.modelCheckpoint?.trim() || null;
  }
  if (patch.description !== undefined) {
    data.description = patch.description?.trim() || null;
  }
  if (Object.keys(data).length === 0) {
    return { status: "ok" };
  }

  const exists = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true },
  });
  if (!exists) {
    return { status: "error", message: "Package not found" };
  }

  await prisma.evaluationPackage.update({
    where: { id: packageId },
    data,
  });
  return { status: "ok" };
}

/**
 * Soft-delete a package: sets deletedAt and hides it from list views.
 * A 30s undo window is enforced client-side (see PackageDetailPanel).
 * Per-annotator items are left intact so undo is a clean restore.
 */
export async function softDeletePackage(
  packageId: string,
): Promise<
  | { status: "ok"; deletedAt: string }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  const now = new Date();
  const pkg = await prisma.evaluationPackage.update({
    where: { id: packageId },
    data: { deletedAt: now },
    select: { deletedAt: true },
  });

  return { status: "ok", deletedAt: pkg.deletedAt!.toISOString() };
}

/**
 * Undo soft-delete. Server enforces the 30s window so a stale client
 * can't resurrect an older deletion. Beyond 30s the package is
 * considered committed-deleted and requires a separate restore path.
 */
export async function undoDeletePackage(
  packageId: string,
): Promise<
  | { status: "ok" }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { deletedAt: true },
  });
  if (!pkg || !pkg.deletedAt) {
    return { status: "error", message: "Package is not deleted" };
  }

  const elapsedMs = Date.now() - pkg.deletedAt.getTime();
  if (elapsedMs > 30_000) {
    return { status: "error", message: "Undo window expired (30s)" };
  }

  await prisma.evaluationPackage.update({
    where: { id: packageId },
    data: { deletedAt: null },
  });

  return { status: "ok" };
}

// ------------------------------------------------------------------
// Removal from a package (re-export from assignment-action for co-location)
// ------------------------------------------------------------------
// The existing implementation in `annotators/assignment-action.ts` already
// handles the COMPLETED-preservation semantics; nothing new to add here.
// Kept separate so samples pages don't have to reach across module
// boundaries when the removal is triggered from within a package context.
