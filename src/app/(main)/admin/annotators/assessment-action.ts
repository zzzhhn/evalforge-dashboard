"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { runAssessmentForPackage, type AssessmentResult } from "@/lib/capability-scoring";
import { getAdminScope } from "@/lib/admin-scope";

type ActionResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

// Read-only gate. Allows SYSTEM (ADMIN/RESEARCHER) AND Group Admins — the
// latter need to see their own members' calibration progress / batch
// list even though they can't mutate anything.
async function requireReadScope() {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") {
    return { ok: false as const, message: "Unauthorized" };
  }
  return { ok: true as const, scope };
}

async function requireAdminOrResearcher() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { ok: false as const, message: "Unauthorized" };
  }
  return { ok: true as const, userId: session.userId, role: session.role };
}

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { ok: false as const, message: "Unauthorized" };
  }
  return { ok: true as const, userId: session.userId };
}

// ─── Ground truth management ─────────────────────────

export interface GroundTruthInput {
  videoAssetId: string;
  dimensionId: string;
  score: number; // 1-5
  failureTagIds?: string[];
  notes?: string | null;
}

/**
 * Mark an existing EvaluationPackage as a calibration batch. Toggling off is
 * permitted only if no CapabilityAssessment has consumed it yet.
 */
export async function markAsCalibrationBatch(
  packageId: string,
  isCalibrationBatch: boolean
): Promise<ActionResult<{ id: string; isCalibrationBatch: boolean }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    const pkg = await prisma.evaluationPackage.update({
      where: { id: packageId },
      data: { isCalibrationBatch },
      select: { id: true, isCalibrationBatch: true },
    });
    revalidatePath("/admin/annotators");
    revalidatePath("/admin/samples");
    return { status: "ok", data: pkg };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Package not found" };
    }
    throw err;
  }
}

/**
 * Upsert multiple ground-truth rows in a single transaction. Callers should
 * pass every (video, dimension) pair present in the calibration package; rows
 * not touched here are left unchanged.
 */
export async function setGroundTruthBulk(
  packageId: string,
  inputs: GroundTruthInput[]
): Promise<ActionResult<{ upserted: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };
  if (inputs.length === 0) {
    return { status: "error", message: "No ground truth rows provided" };
  }

  const invalid = inputs.find((i) => i.score < 1 || i.score > 5 || !Number.isInteger(i.score));
  if (invalid) {
    return { status: "error", message: `Score must be an integer 1-5 (got ${invalid.score})` };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, isCalibrationBatch: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };
  if (!pkg.isCalibrationBatch) {
    return { status: "error", message: "Package is not marked as a calibration batch" };
  }

  await prisma.$transaction(
    inputs.map((i) =>
      prisma.calibrationGroundTruth.upsert({
        where: {
          packageId_videoAssetId_dimensionId: {
            packageId,
            videoAssetId: i.videoAssetId,
            dimensionId: i.dimensionId,
          },
        },
        create: {
          packageId,
          videoAssetId: i.videoAssetId,
          dimensionId: i.dimensionId,
          score: i.score,
          failureTagIds: i.failureTagIds ?? [],
          notes: i.notes ?? null,
        },
        update: {
          score: i.score,
          failureTagIds: i.failureTagIds ?? [],
          notes: i.notes ?? null,
        },
      })
    )
  );

  revalidatePath("/admin/annotators");
  return { status: "ok", data: { upserted: inputs.length } };
}

/**
 * Parse user-supplied JSON and upsert ground truth. Payload shape:
 *   [{ videoExternalId, dimensionCode, score, failureTags? }]
 * Looks up video/dimension IDs by their stable external identifiers rather
 * than UUIDs, so admins can author ground truth in a spreadsheet.
 */
export async function importGroundTruthFromJson(
  packageId: string,
  jsonPayload: string
): Promise<ActionResult<{ upserted: number; skipped: { reason: string; row: unknown }[] }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  interface JsonRow {
    videoExternalId?: string;
    dimensionCode?: string;
    score?: number;
    failureTags?: string[];
    notes?: string;
  }

  let parsed: JsonRow[];
  try {
    const raw = JSON.parse(jsonPayload);
    if (!Array.isArray(raw)) {
      return { status: "error", message: "JSON must be an array of rows" };
    }
    parsed = raw as JsonRow[];
  } catch (err) {
    return { status: "error", message: `Invalid JSON: ${(err as Error).message}` };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, isCalibrationBatch: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };
  if (!pkg.isCalibrationBatch) {
    return { status: "error", message: "Package is not a calibration batch" };
  }

  // Resolve IDs. Video assets are per-package; dimensions are global.
  const videos = await prisma.videoAsset.findMany({
    where: {
      evaluationItems: { some: { packageId } },
    },
    select: {
      id: true,
      prompt: { select: { externalId: true } },
    },
  });
  const videoByExternalId = new Map(videos.map((v) => [v.prompt.externalId, v.id]));

  const dimensions = await prisma.dimension.findMany({ select: { id: true, code: true } });
  const dimensionByCode = new Map(dimensions.map((d) => [d.code, d.id]));

  const resolved: GroundTruthInput[] = [];
  const skipped: { reason: string; row: unknown }[] = [];

  for (const row of parsed) {
    if (!row.videoExternalId || !row.dimensionCode || typeof row.score !== "number") {
      skipped.push({ reason: "missing_required_field", row });
      continue;
    }
    const videoAssetId = videoByExternalId.get(row.videoExternalId);
    const dimensionId = dimensionByCode.get(row.dimensionCode);
    if (!videoAssetId) {
      skipped.push({ reason: "video_not_in_package", row });
      continue;
    }
    if (!dimensionId) {
      skipped.push({ reason: "dimension_not_found", row });
      continue;
    }
    if (!Number.isInteger(row.score) || row.score < 1 || row.score > 5) {
      skipped.push({ reason: "score_out_of_range", row });
      continue;
    }
    resolved.push({
      videoAssetId,
      dimensionId,
      score: row.score,
      failureTagIds: Array.isArray(row.failureTags) ? row.failureTags : [],
      notes: row.notes ?? null,
    });
  }

  if (resolved.length === 0) {
    return {
      status: "error",
      message: `No valid ground truth rows (${skipped.length} skipped)`,
    };
  }

  const result = await setGroundTruthBulk(packageId, resolved);
  if (result.status === "error") return result;

  return {
    status: "ok",
    data: { upserted: result.data.upserted, skipped },
  };
}

// ─── Assessment execution ────────────────────────────

export async function runCalibrationAssessment(
  packageId: string
): Promise<ActionResult<{ packageId: string; results: AssessmentResult[]; assessedAt: string }>> {
  const auth = await requireAdminOrResearcher();
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    const result = await runAssessmentForPackage(packageId);
    revalidatePath("/admin/annotators");
    return { status: "ok", data: result };
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }
}

// ─── Listing for UI ──────────────────────────────────

export interface CalibrationBatchSummary {
  id: string;
  name: string;
  taskType: string;
  status: string;
  videoCount: number;
  annotatorCount: number;
  groundTruthCount: number;
  completedItemCount: number;
  totalItemCount: number;
  lastAssessmentAt: string | null;
  createdAt: string;
  /**
   * Latest-per-annotator tier distribution for this package. Each annotator is
   * counted exactly once (their most recent assessment on this package).
   * Missing assessments don't contribute to any bucket.
   */
  tierDistribution: {
    TIER_1: number;
    TIER_2: number;
    TIER_3: number;
    TIER_4: number;
    unassessed: number;
  };
}

export async function listCalibrationBatches(): Promise<
  ActionResult<CalibrationBatchSummary[]>
> {
  const auth = await requireReadScope();
  if (!auth.ok) return { status: "error", message: auth.message };

  const packages = await prisma.evaluationPackage.findMany({
    where: { isCalibrationBatch: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      taskType: true,
      status: true,
      videoCount: true,
      annotatorCount: true,
      createdAt: true,
      _count: { select: { groundTruths: true } },
    },
  });

  const pkgIds = packages.map((p) => p.id);
  const itemCounts = await prisma.evaluationItem.groupBy({
    by: ["packageId", "status"],
    where: { packageId: { in: pkgIds } },
    _count: { _all: true },
  });
  const byPackage = new Map<string, { completed: number; total: number }>();
  for (const row of itemCounts) {
    if (!row.packageId) continue;
    const bucket = byPackage.get(row.packageId) ?? { completed: 0, total: 0 };
    bucket.total += row._count._all;
    if (row.status === "COMPLETED") bucket.completed += row._count._all;
    byPackage.set(row.packageId, bucket);
  }

  // Fetch every assessment tied to these calibration packages. We dedupe to
  // latest-per-(packageId, userId) in JS because Prisma's metadata is Json
  // and there's no index-friendly way to do distinct-on via ORM here.
  // For a 50-annotator × 10-batch platform this is O(500) rows — trivial.
  const allAssessments = await prisma.capabilityAssessment.findMany({
    orderBy: { assessmentDate: "desc" },
    select: {
      userId: true,
      assessmentDate: true,
      tier: true,
      metadata: true,
    },
  });
  const latestByPkg = new Map<string, Date>();
  // key: `${packageId}|${userId}` → { date, tier }
  const latestPerUserPerPkg = new Map<string, { date: Date; tier: string | null }>();
  for (const a of allAssessments) {
    const meta = a.metadata as { packageId?: string } | null;
    if (!meta?.packageId) continue;
    if (!pkgIds.includes(meta.packageId)) continue;
    const key = `${meta.packageId}|${a.userId}`;
    if (!latestPerUserPerPkg.has(key)) {
      latestPerUserPerPkg.set(key, { date: a.assessmentDate, tier: a.tier });
    }
    if (!latestByPkg.has(meta.packageId)) {
      latestByPkg.set(meta.packageId, a.assessmentDate);
    }
  }

  // Aggregate tier distribution per package
  const tierDistByPkg = new Map<
    string,
    { TIER_1: number; TIER_2: number; TIER_3: number; TIER_4: number }
  >();
  for (const [key, { tier }] of latestPerUserPerPkg.entries()) {
    const packageId = key.split("|")[0]!;
    const bucket = tierDistByPkg.get(packageId) ?? {
      TIER_1: 0,
      TIER_2: 0,
      TIER_3: 0,
      TIER_4: 0,
    };
    if (tier === "TIER_1" || tier === "TIER_2" || tier === "TIER_3" || tier === "TIER_4") {
      bucket[tier]++;
    }
    tierDistByPkg.set(packageId, bucket);
  }

  const summaries: CalibrationBatchSummary[] = packages.map((p) => {
    const counts = byPackage.get(p.id) ?? { completed: 0, total: 0 };
    const tiers = tierDistByPkg.get(p.id) ?? {
      TIER_1: 0,
      TIER_2: 0,
      TIER_3: 0,
      TIER_4: 0,
    };
    const assessed = tiers.TIER_1 + tiers.TIER_2 + tiers.TIER_3 + tiers.TIER_4;
    const unassessed = Math.max(0, p.annotatorCount - assessed);
    return {
      id: p.id,
      name: p.name,
      taskType: p.taskType,
      status: p.status,
      videoCount: p.videoCount,
      annotatorCount: p.annotatorCount,
      groundTruthCount: p._count.groundTruths,
      completedItemCount: counts.completed,
      totalItemCount: counts.total,
      lastAssessmentAt: latestByPkg.get(p.id)?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      tierDistribution: { ...tiers, unassessed },
    };
  });

  return { status: "ok", data: summaries };
}

export async function listEligiblePackages(): Promise<
  ActionResult<{ id: string; name: string; taskType: string }[]>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const packages = await prisma.evaluationPackage.findMany({
    where: {
      isCalibrationBatch: false,
      deletedAt: null,
      evaluationMode: "SCORING",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, taskType: true },
    take: 50,
  });

  return { status: "ok", data: packages };
}

export async function getBatchDetail(packageId: string): Promise<
  ActionResult<{
    id: string;
    name: string;
    videos: { id: string; externalId: string; textZh: string; textEn: string }[];
    dimensions: { id: string; code: string; nameZh: string; nameEn: string }[];
    groundTruths: {
      videoAssetId: string;
      dimensionId: string;
      score: number;
      failureTagIds: string[];
      notes: string | null;
    }[];
  }>
> {
  const auth = await requireReadScope();
  if (!auth.ok) return { status: "error", message: auth.message };

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, name: true, isCalibrationBatch: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };
  if (!pkg.isCalibrationBatch) {
    return { status: "error", message: "Package is not a calibration batch" };
  }

  const items = await prisma.evaluationItem.findMany({
    where: { packageId },
    select: {
      videoAssetId: true,
      dimensionId: true,
      videoAsset: {
        select: {
          id: true,
          prompt: { select: { externalId: true, textZh: true, textEn: true } },
        },
      },
      dimension: { select: { id: true, code: true, nameZh: true, nameEn: true } },
    },
  });

  const videoMap = new Map<
    string,
    { id: string; externalId: string; textZh: string; textEn: string }
  >();
  const dimMap = new Map<
    string,
    { id: string; code: string; nameZh: string; nameEn: string }
  >();
  for (const it of items) {
    videoMap.set(it.videoAsset.id, {
      id: it.videoAsset.id,
      externalId: it.videoAsset.prompt.externalId,
      textZh: it.videoAsset.prompt.textZh,
      textEn: it.videoAsset.prompt.textEn,
    });
    dimMap.set(it.dimension.id, it.dimension);
  }

  const groundTruths = await prisma.calibrationGroundTruth.findMany({
    where: { packageId },
    select: {
      videoAssetId: true,
      dimensionId: true,
      score: true,
      failureTagIds: true,
      notes: true,
    },
  });

  return {
    status: "ok",
    data: {
      id: pkg.id,
      name: pkg.name,
      videos: Array.from(videoMap.values()).sort((a, b) =>
        a.externalId.localeCompare(b.externalId, undefined, { numeric: true })
      ),
      dimensions: Array.from(dimMap.values()).sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true })
      ),
      groundTruths,
    },
  };
}

// ─── Derive ground truth from annotator votes (Phase B) ─────
//
// Instead of forcing admins to hand-author a JSON ground-truth file, allow
// them to pick a subset of annotators who already scored this package and
// synthesize a consensus ground truth via simple aggregation:
//   - Likert score (1–5): median of selected annotators (robust to outliers)
//   - failureTags (string[]): majority vote — a tag is kept only if it was
//     selected by ≥ ceil(n/2) of the annotators who actually scored that
//     (videoAssetId, dimensionId) pair. The denominator is the number of
//     annotators who actually submitted a VALID score, NOT the number
//     initially selected (some selected annotators may not have completed
//     that item).
//
// The derived rows go through setGroundTruthBulk, so:
//   - Existing ground truth rows are overwritten by upsert (stay in schema)
//   - Composite unique constraint (packageId, videoAssetId, dimensionId)
//     dedupes naturally.
//
// Why not use weighted Dawid-Skene or IRT here? This is the MVP: median +
// majority vote is interpretable, has no hidden priors, and matches what a
// mentor would eyeball. We can layer a weighting pass on top in a future
// iteration once CapabilityAssessment coverage is high enough to trust.

export interface PackageAnnotatorSummary {
  userId: string;
  userName: string;
  email: string | null;
  completedItemCount: number;
  totalItemCount: number;
  // Optional — null if this user has never been assessed on this package.
  compositeScore: number | null;
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null;
}

export async function listPackageAnnotators(
  packageId: string
): Promise<ActionResult<PackageAnnotatorSummary[]>> {
  const auth = await requireAdminOrResearcher();
  if (!auth.ok) return { status: "error", message: auth.message };

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, isCalibrationBatch: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };
  if (!pkg.isCalibrationBatch) {
    return { status: "error", message: "Package is not a calibration batch" };
  }

  // Pull every item once; group by user in JS. For 50-annotator × 500-item
  // packages this is 25k rows — still trivial (~1MB) and avoids N round-trips.
  const items = await prisma.evaluationItem.findMany({
    where: { packageId, assignedTo: { deletedAt: null } },
    select: {
      status: true,
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  const perUser = new Map<
    string,
    { name: string; email: string | null; completed: number; total: number }
  >();
  for (const it of items) {
    const u = it.assignedTo;
    const bucket = perUser.get(u.id) ?? {
      name: u.name,
      email: u.email,
      completed: 0,
      total: 0,
    };
    bucket.total += 1;
    if (it.status === "COMPLETED") bucket.completed += 1;
    perUser.set(u.id, bucket);
  }

  // Best-effort enrichment with capability scores (may be absent).
  const userIds = Array.from(perUser.keys());
  const assessments = await prisma.capabilityAssessment.findMany({
    where: { userId: { in: userIds } },
    orderBy: { assessmentDate: "desc" },
    select: { userId: true, compositeScore: true, tier: true, metadata: true },
  });
  // Prefer an assessment tied to this very package, else fall back to the
  // user's most recent assessment anywhere.
  const assessmentByUser = new Map<
    string,
    { compositeScore: number; tier: string | null }
  >();
  for (const a of assessments) {
    const meta = a.metadata as { packageId?: string } | null;
    const isThisPackage = meta?.packageId === packageId;
    const existing = assessmentByUser.get(a.userId);
    if (!existing || isThisPackage) {
      assessmentByUser.set(a.userId, {
        compositeScore: a.compositeScore,
        tier: a.tier,
      });
      if (isThisPackage) continue; // prefer this-package one; don't overwrite later
    }
  }

  const summaries: PackageAnnotatorSummary[] = Array.from(perUser.entries())
    .filter(([, v]) => v.completed > 0) // only users who actually scored
    .map(([userId, v]) => {
      const a = assessmentByUser.get(userId);
      const tier = a?.tier;
      const validTier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null =
        tier === "TIER_1" || tier === "TIER_2" || tier === "TIER_3" || tier === "TIER_4"
          ? tier
          : null;
      return {
        userId,
        userName: v.name,
        email: v.email,
        completedItemCount: v.completed,
        totalItemCount: v.total,
        compositeScore: a?.compositeScore ?? null,
        tier: validTier,
      };
    })
    .sort((a, b) => {
      const ac = a.compositeScore ?? -1;
      const bc = b.compositeScore ?? -1;
      if (ac !== bc) return bc - ac; // higher capability first
      return a.userName.localeCompare(b.userName);
    });

  return { status: "ok", data: summaries };
}

function medianOfInts(values: number[]): number {
  // Integer Likert scores only. Sort ascending; for even counts return
  // floor of the two middle values (ties break conservative-low, so a {3,4}
  // split returns 3 — matches the "no tie-breaking magic" MVP policy).
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 3; // should never happen — caller guarantees n>=1
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export interface DerivePreview {
  videoAssetId: string;
  dimensionId: string;
  videoExternalId: string;
  dimensionCode: string;
  consensusScore: number;
  consensusTags: string[];
  voterCount: number;
  rawScores: number[]; // for admin transparency
}

/**
 * Compute (but don't write) the consensus ground-truth rows derived from the
 * selected annotators. Returned for admin preview before commit.
 */
export async function previewDerivedGroundTruth(
  packageId: string,
  userIds: string[]
): Promise<ActionResult<{ rows: DerivePreview[]; annotatorCount: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };
  if (userIds.length === 0) {
    return { status: "error", message: "Select at least one annotator" };
  }

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, isCalibrationBatch: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };
  if (!pkg.isCalibrationBatch) {
    return { status: "error", message: "Package is not a calibration batch" };
  }

  const scores = await prisma.score.findMany({
    where: {
      userId: { in: userIds },
      validity: "VALID",
      evaluationItem: { packageId, status: "COMPLETED" },
    },
    select: {
      value: true,
      failureTags: true,
      userId: true,
      evaluationItem: {
        select: {
          videoAssetId: true,
          dimensionId: true,
          videoAsset: { select: { prompt: { select: { externalId: true } } } },
          dimension: { select: { code: true } },
        },
      },
    },
  });

  if (scores.length === 0) {
    return {
      status: "error",
      message: "Selected annotators have no VALID scores on this package",
    };
  }

  // Group by (video, dim). Use composite string key.
  const groupKey = (videoAssetId: string, dimensionId: string) =>
    `${videoAssetId}|${dimensionId}`;

  interface Group {
    videoAssetId: string;
    dimensionId: string;
    videoExternalId: string;
    dimensionCode: string;
    values: number[];
    tagVotes: Map<string, number>;
    voters: Set<string>;
  }

  const groups = new Map<string, Group>();
  for (const s of scores) {
    const ei = s.evaluationItem;
    const key = groupKey(ei.videoAssetId, ei.dimensionId);
    let g = groups.get(key);
    if (!g) {
      g = {
        videoAssetId: ei.videoAssetId,
        dimensionId: ei.dimensionId,
        videoExternalId: ei.videoAsset.prompt.externalId,
        dimensionCode: ei.dimension.code,
        values: [],
        tagVotes: new Map(),
        voters: new Set(),
      };
      groups.set(key, g);
    }
    g.values.push(s.value);
    g.voters.add(s.userId);
    for (const t of s.failureTags) {
      g.tagVotes.set(t, (g.tagVotes.get(t) ?? 0) + 1);
    }
  }

  const rows: DerivePreview[] = Array.from(groups.values())
    .map((g) => {
      const voterCount = g.voters.size;
      const threshold = Math.ceil(voterCount / 2);
      const consensusTags = Array.from(g.tagVotes.entries())
        .filter(([, count]) => count >= threshold)
        .map(([tag]) => tag);
      return {
        videoAssetId: g.videoAssetId,
        dimensionId: g.dimensionId,
        videoExternalId: g.videoExternalId,
        dimensionCode: g.dimensionCode,
        consensusScore: medianOfInts(g.values),
        consensusTags,
        voterCount,
        rawScores: [...g.values].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => {
      const v = a.videoExternalId.localeCompare(b.videoExternalId, undefined, {
        numeric: true,
      });
      if (v !== 0) return v;
      return a.dimensionCode.localeCompare(b.dimensionCode, undefined, {
        numeric: true,
      });
    });

  return {
    status: "ok",
    data: { rows, annotatorCount: userIds.length },
  };
}

/**
 * Compute derived ground truth AND commit it. Returns the row count written
 * plus the preview payload for the UI to display post-commit.
 */
export async function deriveGroundTruthFromAnnotators(
  packageId: string,
  userIds: string[]
): Promise<
  ActionResult<{
    upserted: number;
    rows: DerivePreview[];
    annotatorCount: number;
  }>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const preview = await previewDerivedGroundTruth(packageId, userIds);
  if (preview.status === "error") return preview;

  const inputs: GroundTruthInput[] = preview.data.rows.map((r) => ({
    videoAssetId: r.videoAssetId,
    dimensionId: r.dimensionId,
    score: r.consensusScore,
    failureTagIds: r.consensusTags,
    notes: `derived from ${r.voterCount} annotator${r.voterCount === 1 ? "" : "s"} (median + ≥50% tag vote)`,
  }));

  const commit = await setGroundTruthBulk(packageId, inputs);
  if (commit.status === "error") return commit;

  return {
    status: "ok",
    data: {
      upserted: commit.data.upserted,
      rows: preview.data.rows,
      annotatorCount: preview.data.annotatorCount,
    },
  };
}
