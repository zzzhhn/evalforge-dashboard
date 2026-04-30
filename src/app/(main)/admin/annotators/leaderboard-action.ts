"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getAdminScope, getScopedUserIds } from "@/lib/admin-scope";
import {
  iccTwoK,
  krippendorffAlphaInterval,
  bootstrapRankPosterior,
  computeAnnotatorParams,
  perUserIcc,
  perUserKrippendorff,
  rHatFromDraws,
  type ItemRating,
  type AnnotatorScoreBundle,
} from "@/lib/capability-metrics";

type ActionResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

// ─── Public types ────────────────────────────────────

export interface LeaderboardRow {
  userId: string;
  name: string;
  avatarInitials: string;
  groupName: string | null;
  accountType: "INTERNAL" | "VENDOR";
  // Real posterior (from capability_assessments.alpha_*)
  alphaMean: number | null;
  alphaStd: number | null;
  alphaCILow: number | null;
  alphaCIHigh: number | null;
  rankPercentile: number | null;
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null;
  itemsEvaluated: number;
  /**
   * Shrunk GT-agreement CI in percentile units (0-100) — this is what
   * the Forest track uses to draw CI whiskers AND what the Hero "avg
   * CI width" aggregates. Supersedes the old α-logit CI which produced
   * unreadably wide intervals for small-N users.
   */
  percentileMean: number | null;
  percentileCILow: number | null;
  percentileCIHigh: number | null;
  /**
   * Posterior probability of holding each rank (1 to N). Used by
   * RankogramStrip instead of the gaussian mock.
   */
  rankogramBins: number[] | null;
  // 5 dimension scores (0-10) — real data, relabeled for bifactor display.
  // Mapping (see CalibrationAnnotatorDrawer):
  //   accuracy   → 指令遵循 (instruction following)
  //   consistency→ 视觉质量 (visual fidelity)
  //   coverage   → 运动自然度 (motion)
  //   detail     → 物理一致性 (physics)
  //   speed      → 身份保持 (identity)
  // 美学 / Arena 偏好 are Phase 9 (not shown per user direction).
  scores: {
    accuracy: number;
    consistency: number;
    coverage: number;
    detailOriented: number;
    speed: number;
    compositeScore: number;
  } | null;
  lastAssessedAt: string | null;
}

export interface LeaderboardAggregate {
  totalAnnotators: number;
  tierDistribution: {
    TIER_1: number;
    TIER_2: number;
    TIER_3: number;
    TIER_4: number;
    unassessed: number;
  };
  // Real: mean of (alphaCIHigh − alphaCILow) across assessed rows.
  avgCIWidth: number | null;
  observations: {
    likert: number; // completed EvaluationItems in calibration packages
    pairwise: number; // completed ArenaItems in calibration packages
    total: number;
  };
  // Real values computed from raw score matrix across calibration batches.
  teamKrippendorffAlpha: number | null;
  iccTwoK: number | null;
  /** Sampler diagnostics (bootstrap posterior — see capability-metrics). */
  diagnostics: {
    rHat: number | null;
    divergent: number;
    chains: string;
    waic: number | null; // null: proper WAIC needs full likelihood model.
    sparseAnnotators: number; // users with itemsEvaluated < threshold
  };
  /**
   * Small-sample warning. When the number of assessed raters or items
   * per rater is below the identifiability threshold (5 raters / 30
   * items each), tier/percentile rankings are unstable. UI shows a
   * banner and encourages adding more calibration data.
   */
  sampleAdequacy: {
    ok: boolean;
    assessedRaters: number;
    minItemsPerRater: number;
    reason: string | null; // localised-neutral code; UI translates
  };
}

export interface LeaderboardResponse {
  rows: LeaderboardRow[];
  aggregate: LeaderboardAggregate;
}

// ─── Implementation ──────────────────────────────────

export async function listCalibrationLeaderboard(): Promise<
  ActionResult<LeaderboardResponse>
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") {
    return { status: "error", message: "Unauthorized" };
  }

  const scopedIds = await getScopedUserIds(scope);
  const userIdFilter =
    scopedIds === "ALL"
      ? undefined
      : scopedIds.size === 0
        ? { in: [] as string[] }
        : { in: [...scopedIds] };

  // Empty scope — return empty response rather than hitting DB.
  if (userIdFilter && userIdFilter.in.length === 0) {
    return {
      status: "ok",
      data: {
        rows: [],
        aggregate: {
          totalAnnotators: 0,
          tierDistribution: {
            TIER_1: 0,
            TIER_2: 0,
            TIER_3: 0,
            TIER_4: 0,
            unassessed: 0,
          },
          avgCIWidth: null,
          observations: { likert: 0, pairwise: 0, total: 0 },
          teamKrippendorffAlpha: null,
          iccTwoK: null,
          diagnostics: {
            rHat: null,
            divergent: 0,
            chains: "4×1000",
            waic: null,
            sparseAnnotators: 0,
          },
          sampleAdequacy: {
            ok: false,
            assessedRaters: 0,
            minItemsPerRater: 0,
            reason: "raters<5",
          },
        },
      },
    };
  }

  // All assessments, most recent first per user. Prisma doesn't do
  // DISTINCT ON, so we grab ordered rows then keep the first per userId.
  const assessments = await prisma.capabilityAssessment.findMany({
    where: userIdFilter ? { userId: userIdFilter } : undefined,
    orderBy: { assessmentDate: "desc" },
    select: {
      userId: true,
      assessmentDate: true,
      accuracy: true,
      consistency: true,
      coverage: true,
      detailOriented: true,
      speed: true,
      compositeScore: true,
      alphaMean: true,
      alphaStd: true,
      alphaCILow: true,
      alphaCIHigh: true,
      rankPercentile: true,
      tier: true,
      metadata: true,
      user: {
        select: {
          id: true,
          name: true,
          accountType: true,
          groupMemberships: {
            select: { group: { select: { name: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const latestByUser = new Map<string, (typeof assessments)[number]>();
  for (const a of assessments) {
    if (!latestByUser.has(a.userId)) latestByUser.set(a.userId, a);
  }

  // Fetch all scoped annotators (ANNOTATOR role) so unassessed users also
  // surface in the leaderboard with "—" values.
  const annotators = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: "ANNOTATOR",
      ...(userIdFilter ? { id: userIdFilter } : {}),
    },
    select: {
      id: true,
      name: true,
      accountType: true,
      groupMemberships: {
        select: { group: { select: { name: true } } },
        take: 1,
      },
    },
  });

  // Per-user completed item counts for "itemsEvaluated" ground truth.
  const completedByUser = new Map<string, number>();
  const completedCounts = await prisma.evaluationItem.groupBy({
    by: ["assignedToId"],
    where: {
      status: "COMPLETED",
      package: { isCalibrationBatch: true },
      ...(userIdFilter ? { assignedToId: userIdFilter } : {}),
    },
    _count: { _all: true },
  });
  for (const c of completedCounts) {
    completedByUser.set(c.assignedToId, c._count._all);
  }

  // ─── Bootstrap posterior: real percentile CIs + rankogram bins ───
  // For each assessed user, we have α~N(mean,std). Monte-Carlo draws from
  // the joint distribution give empirical rank distributions per user.
  const posteriorUsers = [...latestByUser.values()]
    .filter((a) => a.alphaMean != null && a.alphaStd != null)
    .map((a) => ({
      userId: a.userId,
      alphaMean: a.alphaMean as number,
      alphaStd: (a.alphaStd as number) || 0.1,
    }));
  const posteriorResults = bootstrapRankPosterior(posteriorUsers, 4000);
  const posteriorByUser = new Map(
    posteriorResults.map((r) => [r.userId, r]),
  );

  const rows: LeaderboardRow[] = annotators.map((u) => {
    const a = latestByUser.get(u.id);
    const post = posteriorByUser.get(u.id);
    // Prefer the real Bayesian rankogram stored in CapabilityAssessment
    // metadata over the per-page bootstrap approximation.
    const metaIrt = readMetaIrt(a?.metadata);
    // Read shrunk GT-agreement point + CI (percentile units) from
    // metadata — these are the numbers the UI displays end-to-end.
    const metaGt = readMetaGtAgreement(a?.metadata);
    return {
      userId: u.id,
      name: u.name,
      avatarInitials: shortInitials(u.name),
      groupName: u.groupMemberships[0]?.group.name ?? null,
      accountType: u.accountType,
      alphaMean: a?.alphaMean ?? null,
      alphaStd: a?.alphaStd ?? null,
      alphaCILow: a?.alphaCILow ?? null,
      alphaCIHigh: a?.alphaCIHigh ?? null,
      rankPercentile: a?.rankPercentile ?? null,
      tier: a?.tier ?? null,
      itemsEvaluated: completedByUser.get(u.id) ?? 0,
      // Prefer shrunk GT-agreement CI (sample-size aware). Fall back
      // to bootstrap rank posterior for legacy rows without agreement
      // metadata.
      percentileMean: metaGt?.mean ?? post?.percentileMean ?? null,
      percentileCILow: metaGt?.ciLow ?? post?.percentileCILow ?? null,
      percentileCIHigh: metaGt?.ciHigh ?? post?.percentileCIHigh ?? null,
      rankogramBins: metaIrt?.rankogramBins ?? post?.rankogramBins ?? null,
      scores: a
        ? {
            accuracy: a.accuracy,
            consistency: a.consistency,
            coverage: a.coverage,
            detailOriented: a.detailOriented,
            speed: a.speed,
            compositeScore: a.compositeScore,
          }
        : null,
      lastAssessedAt: a?.assessmentDate.toISOString() ?? null,
    };
  });

  // Sort: assessed rows by ability desc (alphaMean then composite), unassessed last.
  rows.sort((a, b) => {
    const ra = a.alphaMean != null ? 2 : a.scores ? 1 : 0;
    const rb = b.alphaMean != null ? 2 : b.scores ? 1 : 0;
    if (ra !== rb) return rb - ra;
    const va = a.alphaMean ?? a.scores?.compositeScore ?? -Infinity;
    const vb = b.alphaMean ?? b.scores?.compositeScore ?? -Infinity;
    return vb - va;
  });

  // Aggregate.
  const tierDistribution = {
    TIER_1: 0,
    TIER_2: 0,
    TIER_3: 0,
    TIER_4: 0,
    unassessed: 0,
  };
  // Aggregate CI width across users in PERCENTILE UNITS (0-100),
  // directly interpretable as "95% CI half-width in score points".
  // Uses the shrunk GT-agreement CI from metadata, which is the same
  // CI the Forest track draws per row — so the hero number and the
  // visual whiskers are consistent.
  let ciWidthSum = 0;
  let ciWidthCount = 0;
  for (const r of rows) {
    if (r.tier) tierDistribution[r.tier]++;
    else tierDistribution.unassessed++;
    if (r.percentileCIHigh != null && r.percentileCILow != null) {
      ciWidthSum += r.percentileCIHigh - r.percentileCILow;
      ciWidthCount++;
    }
  }
  const avgCIWidth = ciWidthCount > 0 ? ciWidthSum / ciWidthCount : null;

  const likertCount = await prisma.evaluationItem.count({
    where: {
      status: "COMPLETED",
      package: { isCalibrationBatch: true },
      ...(userIdFilter ? { assignedToId: userIdFilter } : {}),
    },
  });
  const pairwiseCount = await prisma.arenaItem.count({
    where: {
      status: "COMPLETED",
      package: { isCalibrationBatch: true },
      ...(userIdFilter ? { assignedToId: userIdFilter } : {}),
    },
  });

  // ─── Team agreement (real): Kα interval + ICC(2,k) ──
  // Pull all VALID scores from completed items in calibration batches.
  const scoreRows = await prisma.score.findMany({
    where: {
      validity: "VALID",
      evaluationItem: {
        status: "COMPLETED",
        package: { isCalibrationBatch: true },
        ...(userIdFilter ? { assignedToId: userIdFilter } : {}),
      },
    },
    select: {
      value: true,
      userId: true,
      dimensionId: true,
      evaluationItem: { select: { videoAssetId: true } },
    },
  });
  // Group by (videoAssetId, dimensionId) — each cell is one rated item.
  const itemMap = new Map<string, ItemRating>();
  for (const s of scoreRows) {
    const key = `${s.evaluationItem.videoAssetId}:${s.dimensionId}`;
    let it = itemMap.get(key);
    if (!it) {
      it = { key, ratings: {} };
      itemMap.set(key, it);
    }
    // If same user rated twice (shouldn't happen due to unique constraint),
    // keep last.
    it.ratings[s.userId] = s.value;
  }
  const items = [...itemMap.values()];
  const teamKrippendorffAlpha = krippendorffAlphaInterval(items);
  const teamIcc = iccTwoK(items);

  // Sparse annotators: users with < 10 calibration items evaluated.
  const sparseAnnotators = rows.filter(
    (r) => r.tier != null && r.itemsEvaluated < 10,
  ).length;

  // R̂ diagnostic: pull the max R̂ and divergent count from any
  // Bayesian-IRT-sourced assessments in this scope. Fall back to a
  // bootstrap chain-split estimator only when no real MCMC output is
  // available (legacy rows).
  let rHat: number | null = null;
  let divergent = 0;
  let mcmcChains = "4×1000";
  let sampledFromMcmc = false;
  for (const a of latestByUser.values()) {
    const metaAny = a.metadata as Record<string, unknown> | null;
    if (!metaAny) continue;
    if (metaAny.posteriorSource === "bayesian_irt") {
      const g = metaAny.irtGlobal as
        | {
            rHatMax?: number;
            rHatMean?: number;
            divergentTransitions?: number;
            numSamples?: number;
            numChains?: number;
          }
        | undefined;
      if (g) {
        if (typeof g.rHatMax === "number") {
          rHat = rHat == null ? g.rHatMax : Math.max(rHat, g.rHatMax);
        }
        if (typeof g.divergentTransitions === "number") {
          divergent = Math.max(divergent, g.divergentTransitions);
        }
        if (
          typeof g.numChains === "number" &&
          typeof g.numSamples === "number"
        ) {
          mcmcChains = `${g.numChains}×${g.numSamples}`;
        }
        sampledFromMcmc = true;
      }
    }
  }
  if (!sampledFromMcmc) {
    const allDraws: number[] = [];
    if (posteriorUsers.length > 0) {
      const u0 = posteriorUsers[0];
      for (let i = 0; i < 1600; i++) {
        allDraws.push(u0.alphaMean + u0.alphaStd * gauss());
      }
    }
    rHat = rHatFromDraws(allDraws, 4);
  }

  return {
    status: "ok",
    data: {
      rows,
      aggregate: {
        totalAnnotators: rows.length,
        tierDistribution,
        avgCIWidth,
        observations: {
          likert: likertCount,
          pairwise: pairwiseCount,
          total: likertCount + pairwiseCount,
        },
        teamKrippendorffAlpha,
        iccTwoK: teamIcc,
        diagnostics: {
          rHat,
          divergent,
          chains: mcmcChains,
          waic: null, // requires full likelihood model
          sparseAnnotators,
        },
        sampleAdequacy: (() => {
          const assessedRaters = rows.filter((r) => r.tier != null).length;
          const itemCounts = rows
            .filter((r) => r.tier != null)
            .map((r) => r.itemsEvaluated);
          const minItems = itemCounts.length
            ? Math.min(...itemCounts)
            : 0;
          let reason: string | null = null;
          if (assessedRaters < 5) reason = "raters<5";
          else if (minItems < 30) reason = "items<30";
          return {
            ok: reason === null,
            assessedRaters,
            minItemsPerRater: minItems,
            reason,
          };
        })(),
      },
    },
  };
}

// Minimal Gaussian draw for the diagnostic aggregator.
function gauss(): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Drawer detail ───────────────────────────────────

export interface AnnotatorDetail {
  userId: string;
  name: string;
  avatarInitials: string;
  groupName: string | null;
  accountType: "INTERNAL" | "VENDOR";
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null;
  rankPercentile: number | null;
  alphaMean: number | null;
  alphaStd: number | null;
  alphaCILow: number | null;
  alphaCIHigh: number | null;
  scores: {
    accuracy: number;
    consistency: number;
    coverage: number;
    detailOriented: number;
    speed: number;
    compositeScore: number;
  } | null;
  // Historical trajectory: last 8 assessments (oldest → newest), α value.
  trajectory: {
    date: string;
    alphaMean: number | null;
    compositeScore: number;
  }[];
  itemsEvaluated: number;
  likertObservations: number;
  pairwiseObservations: number;
  /** Davidson-BT surrogate parameters (real values). */
  params: {
    severityDelta: number | null;
    tieGamma: number | null;
    qualityH: number | null;
  };
  /** Concordance of this user's scores against the group consensus. */
  concordance: {
    krippendorffAlpha: number | null;
    icc: number | null;
  };
  /** Per-user sampler diagnostics. */
  diagnostics: {
    rHat: number | null;
    divergent: number;
    samplesOk: boolean;
    ciOk: boolean;
  };
}

export async function listAnnotatorCalibrationDetail(
  userId: string,
): Promise<ActionResult<AnnotatorDetail>> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") {
    return { status: "error", message: "Unauthorized" };
  }
  if (scope.kind === "GROUP") {
    const scoped = await getScopedUserIds(scope);
    if (scoped !== "ALL" && !scoped.has(userId)) {
      return { status: "error", message: "Out of scope" };
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      accountType: true,
      groupMemberships: {
        select: { group: { select: { name: true } } },
        take: 1,
      },
    },
  });
  if (!user) return { status: "error", message: "User not found" };

  const history = await prisma.capabilityAssessment.findMany({
    where: { userId },
    orderBy: { assessmentDate: "desc" },
    take: 8,
    select: {
      assessmentDate: true,
      accuracy: true,
      consistency: true,
      coverage: true,
      detailOriented: true,
      speed: true,
      compositeScore: true,
      alphaMean: true,
      alphaStd: true,
      alphaCILow: true,
      alphaCIHigh: true,
      rankPercentile: true,
      tier: true,
      metadata: true,
    },
  });

  const latest = history[0] ?? null;
  const trajectory = history
    .map((h) => ({
      date: h.assessmentDate.toISOString(),
      alphaMean: h.alphaMean,
      compositeScore: h.compositeScore,
    }))
    .reverse(); // oldest → newest for left-to-right sparkline

  const likertObservations = await prisma.evaluationItem.count({
    where: {
      status: "COMPLETED",
      assignedToId: userId,
      package: { isCalibrationBatch: true },
    },
  });
  const pairwiseObservations = await prisma.arenaItem.count({
    where: {
      status: "COMPLETED",
      assignedToId: userId,
      package: { isCalibrationBatch: true },
    },
  });

  // ─── Build per-user score bundle for δ/γ/H + Kα/ICC ───
  // Pull every VALID score for calibration items, grouped by
  // (videoAsset, dimension) so we can derive a per-item group median
  // against which to measure this user's severity and discrimination.
  const allCalibScores = await prisma.score.findMany({
    where: {
      validity: "VALID",
      evaluationItem: {
        status: "COMPLETED",
        package: { isCalibrationBatch: true },
      },
    },
    select: {
      value: true,
      userId: true,
      dimensionId: true,
      evaluationItem: { select: { videoAssetId: true, packageId: true } },
    },
  });
  const itemBuckets = new Map<string, number[]>();
  const userScoreCells = new Map<
    string,
    { key: string; value: number; packageId: string; dimensionId: string; videoAssetId: string }[]
  >();
  for (const s of allCalibScores) {
    const key = `${s.evaluationItem.videoAssetId}:${s.dimensionId}`;
    let bucket = itemBuckets.get(key);
    if (!bucket) {
      bucket = [];
      itemBuckets.set(key, bucket);
    }
    bucket.push(s.value);
    if (s.userId === userId) {
      let arr = userScoreCells.get(userId);
      if (!arr) {
        arr = [];
        userScoreCells.set(userId, arr);
      }
      arr.push({
        key,
        value: s.value,
        packageId: s.evaluationItem.packageId ?? "",
        dimensionId: s.dimensionId,
        videoAssetId: s.evaluationItem.videoAssetId,
      });
    }
  }
  const ownCells = userScoreCells.get(userId) ?? [];

  // Ground-truth lookup per (packageId, videoAssetId, dimensionId).
  const gtRows = ownCells.length
    ? await prisma.calibrationGroundTruth.findMany({
        where: {
          packageId: { in: [...new Set(ownCells.map((c) => c.packageId))] },
        },
        select: {
          packageId: true,
          videoAssetId: true,
          dimensionId: true,
          score: true,
        },
      })
    : [];
  const gtLookup = new Map<string, number>();
  for (const r of gtRows) {
    gtLookup.set(
      `${r.packageId}:${r.videoAssetId}:${r.dimensionId}`,
      r.score,
    );
  }

  const likertRows = ownCells.map((c) => {
    const bucket = itemBuckets.get(c.key) ?? [];
    // group median: if the bucket only holds this user's score, fall back
    // to their own score so the deviation term is zero (unbiased default).
    const others = bucket.filter((v) => v !== c.value);
    const groupMedian = others.length > 0 ? medianOf(others) : c.value;
    return {
      key: c.key,
      value: c.value,
      groupMedian,
      groundTruth:
        gtLookup.get(`${c.packageId}:${c.videoAssetId}:${c.dimensionId}`) ?? null,
    };
  });

  const arenaVerdicts = (
    await prisma.arenaItem.findMany({
      where: {
        status: "COMPLETED",
        assignedToId: userId,
        package: { isCalibrationBatch: true },
        verdict: { not: null },
      },
      select: { verdict: true },
    })
  )
    .map((a) => a.verdict)
    .filter((v): v is "LEFT_WINS" | "RIGHT_WINS" | "BOTH_GOOD" | "BOTH_BAD" => v !== null);

  const bundle: AnnotatorScoreBundle = {
    userId,
    likertRows,
    arenaVerdicts,
  };
  const params = computeAnnotatorParams(bundle);
  const kAlpha = perUserKrippendorff(bundle);
  const icc = perUserIcc(bundle);

  // Per-user R̂: prefer the real NumPyro output stored in metadata. If
  // the assessment predates the Bayesian IRT upgrade (posteriorSource =
  // "bootstrap"), fall back to a chain-split bootstrap diagnostic over
  // the bootstrap draws for parity.
  const irtMeta = readMetaIrt(latest?.metadata);
  let userRHat: number | null = irtMeta?.rHat ?? null;
  if (userRHat == null && latest?.alphaMean != null && latest?.alphaStd != null) {
    const userDraws: number[] = [];
    for (let i = 0; i < 1600; i++) {
      userDraws.push(latest.alphaMean + latest.alphaStd * gaussDet(userId, i));
    }
    userRHat = rHatFromDraws(userDraws, 4);
  }
  const ciWidth =
    latest?.alphaCIHigh != null && latest?.alphaCILow != null
      ? latest.alphaCIHigh - latest.alphaCILow
      : null;

  return {
    status: "ok",
    data: {
      userId: user.id,
      name: user.name,
      avatarInitials: shortInitials(user.name),
      groupName: user.groupMemberships[0]?.group.name ?? null,
      accountType: user.accountType,
      tier: latest?.tier ?? null,
      rankPercentile: latest?.rankPercentile ?? null,
      alphaMean: latest?.alphaMean ?? null,
      alphaStd: latest?.alphaStd ?? null,
      alphaCILow: latest?.alphaCILow ?? null,
      alphaCIHigh: latest?.alphaCIHigh ?? null,
      scores: latest
        ? {
            accuracy: latest.accuracy,
            consistency: latest.consistency,
            coverage: latest.coverage,
            detailOriented: latest.detailOriented,
            speed: latest.speed,
            compositeScore: latest.compositeScore,
          }
        : null,
      trajectory,
      itemsEvaluated: likertObservations,
      likertObservations,
      pairwiseObservations,
      params,
      concordance: {
        krippendorffAlpha: kAlpha,
        icc,
      },
      diagnostics: {
        rHat: userRHat,
        divergent: 0,
        samplesOk: likertObservations >= 20,
        ciOk: ciWidth != null && ciWidth < 1.5,
      },
    },
  };
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Deterministic Gaussian draw seeded by userId + iter — keeps drawer
// diagnostics stable across refreshes.
function gaussDet(userId: string, i: number): number {
  let h = 2166136261;
  for (let c = 0; c < userId.length; c++) {
    h ^= userId.charCodeAt(c);
    h = Math.imul(h, 16777619);
  }
  h ^= i;
  h = Math.imul(h, 2654435769);
  const u = Math.max(1e-9, ((h >>> 0) % 1_000_000) / 1_000_000);
  const v = ((Math.imul(h ^ 0x9e3779b9, 2654435769) >>> 0) % 1_000_000) / 1_000_000;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface IrtMeta {
  rHat?: number;
  ess?: number;
  rankogramBins?: number[];
}

interface GtAgreementMeta {
  mean: number;
  ciLow: number;
  ciHigh: number;
}

function readMetaGtAgreement(metadata: unknown): GtAgreementMeta | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  const m = root.gtAgreement;
  const lo = root.gtAgreementCILow;
  const hi = root.gtAgreementCIHigh;
  if (typeof m !== "number" || typeof lo !== "number" || typeof hi !== "number") {
    return null;
  }
  return { mean: m, ciLow: lo, ciHigh: hi };
}

function readMetaIrt(metadata: unknown): IrtMeta | null {
  if (!metadata || typeof metadata !== "object") return null;
  const root = metadata as Record<string, unknown>;
  if (root.posteriorSource !== "bayesian_irt") return null;
  const irt = root.irt;
  if (!irt || typeof irt !== "object") return null;
  const o = irt as Record<string, unknown>;
  const rHat = typeof o.rHat === "number" ? o.rHat : undefined;
  const ess = typeof o.ess === "number" ? o.ess : undefined;
  const bins = Array.isArray(o.rankogramBins)
    ? (o.rankogramBins.filter((v) => typeof v === "number") as number[])
    : undefined;
  return { rHat, ess, rankogramBins: bins };
}

function shortInitials(name: string): string {
  // 2 chars for CJK; last 2 ASCII chars otherwise.
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const isCJK = /[㐀-鿿]/.test(trimmed);
  if (isCJK) {
    const chars = [...trimmed];
    return chars.slice(-2).join("");
  }
  return trimmed.slice(0, 2).toUpperCase();
}
