import { prisma } from "@/lib/db";
import {
  fitBayesianIRT,
  BayesianIRTError,
  type IRTInput,
  type IRTResult,
  type IRTRaterPosterior,
} from "@/lib/bayesian-irt";

/**
 * Capability scoring for Phase 5 calibration batches.
 *
 * Six dimensions, all scaled to 0-10:
 *   accuracy        — 1 - mae/4  (how close to ground truth on average)
 *   consistency     — 1 - stddev/4  (how stable error is across items)
 *   coverage        — mean(watchRatio)  (how much of each video is watched)
 *   detailOriented  — jaccard(pred tags, gt tags)  (only counted on low-score items)
 *   speed           — completionsPerHour / batchMedian  (group-relative, cap 10)
 *   compositeScore  — weighted mean
 *
 * All functions are pure + side-effect free except runAssessmentForPackage
 * which persists CapabilityAssessment rows.
 */

export const WEIGHTS = {
  accuracy: 0.35,
  consistency: 0.25,
  coverage: 0.15,
  detailOriented: 0.15,
  speed: 0.1,
} as const;

export interface CapabilityScores {
  accuracy: number;
  consistency: number;
  coverage: number;
  detailOriented: number;
  speed: number;
  compositeScore: number;
}

/**
 * Posterior-like summaries derived from bootstrap resampling of annotation
 * records. Phase 5 MVP: not a full Bayesian IRT, but produces honest CIs.
 * We transform compositeScore into a logit-scale ability:
 *   alpha = logit(composite / 10), clipped to [-4, +4]
 * then bootstrap N times to estimate std + 95% CI.
 */
export interface PosteriorSummary {
  alphaMean: number;
  alphaStd: number;
  alphaCILow: number;
  alphaCIHigh: number;
}

export type CapabilityTier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";

export interface AssessmentResult {
  userId: string;
  userName: string;
  itemsEvaluated: number;
  scores: CapabilityScores | null;
  posterior: PosteriorSummary | null;
  rankPercentile: number | null;
  tier: CapabilityTier | null;
  reason?: string;
}

// ─── Math helpers ────────────────────────────────────

const clamp = (v: number, lo = 0, hi = 10): number => Math.max(lo, Math.min(hi, v));

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1; // both agree on "no issues"
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─── Bootstrap helpers for posterior summaries ─────────

const BOOTSTRAP_ITERATIONS = 500;
const ALPHA_CLIP = 4; // ±4 logits covers ~98.2% calibration range

/**
 * Deterministic PRNG (mulberry32). We seed per-user so reruns are reproducible,
 * which matters for CI that researchers will cite in reports.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function percentile(sortedXs: number[], p: number): number {
  if (sortedXs.length === 0) return 0;
  const idx = Math.min(sortedXs.length - 1, Math.max(0, Math.floor((p / 100) * sortedXs.length)));
  return sortedXs[idx];
}

/**
 * Logit transform of composite score with clipping.
 *   composite ∈ [0, 10] → alpha ∈ [-4, +4]
 * Rationale: composite close to 10 → very capable (high α);
 * composite close to 0 → very weak (low α); clip to avoid infinities.
 */
function compositeToAlpha(composite: number): number {
  const p = Math.max(0.01, Math.min(0.99, composite / 10));
  const logit = Math.log(p / (1 - p));
  return Math.max(-ALPHA_CLIP, Math.min(ALPHA_CLIP, logit));
}

/**
 * Bootstrap resample annotations, recompute compositeScore per sample, and
 * return (α mean, α std, 95% CI). Requires ≥5 annotations for meaningful CIs —
 * below that returns a wide-CI placeholder that the UI can flag as "low
 * confidence, needs more data".
 */
function bootstrapPosterior(
  annotations: RawAnnotation[],
  completionsPerHour: number,
  batchMedianCompletionsPerHour: number,
  seed: number,
): PosteriorSummary {
  if (annotations.length === 0) {
    return { alphaMean: 0, alphaStd: ALPHA_CLIP, alphaCILow: -ALPHA_CLIP, alphaCIHigh: ALPHA_CLIP };
  }

  const rng = mulberry32(seed);
  const alphas: number[] = [];

  for (let iter = 0; iter < BOOTSTRAP_ITERATIONS; iter++) {
    const sample: RawAnnotation[] = new Array(annotations.length);
    for (let i = 0; i < annotations.length; i++) {
      const idx = Math.floor(rng() * annotations.length);
      sample[i] = annotations[idx];
    }
    const s = scoreAnnotations({
      annotations: sample,
      completionsPerHour,
      batchMedianCompletionsPerHour,
    });
    if (!s) continue;
    alphas.push(compositeToAlpha(s.compositeScore));
  }

  if (alphas.length === 0) {
    return { alphaMean: 0, alphaStd: ALPHA_CLIP, alphaCILow: -ALPHA_CLIP, alphaCIHigh: ALPHA_CLIP };
  }

  const alphaMean = mean(alphas);
  const alphaStd = stddev(alphas);
  const sorted = [...alphas].sort((a, b) => a - b);
  const alphaCILow = percentile(sorted, 2.5);
  const alphaCIHigh = percentile(sorted, 97.5);

  return { alphaMean, alphaStd, alphaCILow, alphaCIHigh };
}

function tierFromRank(rankPercentile: number): CapabilityTier {
  if (rankPercentile >= 80) return "TIER_1";
  if (rankPercentile >= 40) return "TIER_2";
  if (rankPercentile >= 10) return "TIER_3";
  return "TIER_4";
}

// ─── Pure scorer (exposed for unit tests) ────────────

export interface RawAnnotation {
  score: number; // 1-5 submitted
  groundTruthScore: number; // 1-5 expected
  predictedTagIds: string[];
  groundTruthTagIds: string[];
  watchRatio: number; // 0-1, clamped
}

export interface ScoringInput {
  annotations: RawAnnotation[];
  completionsPerHour: number;
  batchMedianCompletionsPerHour: number;
}

/**
 * Compute 6-dimension capability scores from raw annotation records + speed stats.
 * Returns null if there are no annotations.
 */
export function scoreAnnotations(input: ScoringInput): CapabilityScores | null {
  const { annotations } = input;
  if (annotations.length === 0) return null;

  const errors = annotations.map((a) => Math.abs(a.score - a.groundTruthScore));
  const mae = mean(errors);
  const errStd = stddev(errors);

  // 1-5 Likert → max error is 4 points; so mae/4 ∈ [0, 1]
  const accuracy = clamp((1 - mae / 4) * 10);
  const consistency = clamp((1 - errStd / 4) * 10);

  const coverage = clamp(mean(annotations.map((a) => Math.max(0, Math.min(1, a.watchRatio)))) * 10);

  // detail-oriented: only counted on items where ground truth is a "low" score (<=3),
  // because high-score items often have no failure tags (empty ground truth).
  const lowScoreItems = annotations.filter((a) => a.groundTruthScore <= 3);
  const detailOriented = lowScoreItems.length === 0
    ? 5.0 // neutral if no low-score items to judge against
    : clamp(
        mean(
          lowScoreItems.map((a) =>
            jaccard(new Set(a.predictedTagIds), new Set(a.groundTruthTagIds))
          )
        ) * 10
      );

  const { completionsPerHour, batchMedianCompletionsPerHour } = input;
  const speedRatio = batchMedianCompletionsPerHour === 0 ? 1 : completionsPerHour / batchMedianCompletionsPerHour;
  const speed = clamp(speedRatio * 5); // at median → 5, 2x median → 10, 0.2x median → 1

  const compositeScore = clamp(
    accuracy * WEIGHTS.accuracy +
      consistency * WEIGHTS.consistency +
      coverage * WEIGHTS.coverage +
      detailOriented * WEIGHTS.detailOriented +
      speed * WEIGHTS.speed
  );

  return { accuracy, consistency, coverage, detailOriented, speed, compositeScore };
}

// ─── Watch ratio normalization ───────────────────────

/**
 * Extract a single watch ratio (0-1) from the free-form JSON in EvaluationItem.watchProgress.
 * Supports multiple historical shapes defensively:
 *   { watchedSec: number, durationSec: number }
 *   { ratio: number }
 *   [watchedSeconds, watchedSeconds, ...] → we take max
 *   number (treat as ratio)
 */
function extractWatchRatio(raw: unknown, fallbackDurationSec: number | null): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return Math.max(0, Math.min(1, raw));

  if (Array.isArray(raw)) {
    const nums = raw.filter((x): x is number => typeof x === "number");
    if (nums.length === 0 || !fallbackDurationSec) return 0;
    const maxWatched = Math.max(...nums);
    return Math.max(0, Math.min(1, maxWatched / fallbackDurationSec));
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.ratio === "number") return Math.max(0, Math.min(1, obj.ratio));
    if (typeof obj.watchedSec === "number" && typeof obj.durationSec === "number" && obj.durationSec > 0) {
      return Math.max(0, Math.min(1, obj.watchedSec / obj.durationSec));
    }
    if (typeof obj.watchedSec === "number" && fallbackDurationSec) {
      return Math.max(0, Math.min(1, obj.watchedSec / fallbackDurationSec));
    }
  }
  return 0;
}

// ─── DB-backed runner ────────────────────────────────

/**
 * Compute per-annotator capability for every user who has completed items in
 * the given calibration package. Persists one CapabilityAssessment row per
 * user. Returns a summary for UI display.
 *
 * Caller must enforce auth (ADMIN or RESEARCHER only) before invoking.
 */
export async function runAssessmentForPackage(packageId: string): Promise<{
  packageId: string;
  results: AssessmentResult[];
  assessedAt: string;
}> {
  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { id: true, isCalibrationBatch: true, name: true },
  });
  if (!pkg) throw new Error(`Package ${packageId} not found`);
  if (!pkg.isCalibrationBatch) throw new Error(`Package ${pkg.name} is not a calibration batch`);

  // Ground truth lookup: (videoAssetId, dimensionId) → { score, tagIds }
  const groundTruths = await prisma.calibrationGroundTruth.findMany({
    where: { packageId },
    select: {
      videoAssetId: true,
      dimensionId: true,
      score: true,
      failureTagIds: true,
    },
  });
  const gtMap = new Map<string, { score: number; failureTagIds: string[] }>();
  for (const gt of groundTruths) {
    gtMap.set(`${gt.videoAssetId}|${gt.dimensionId}`, {
      score: gt.score,
      failureTagIds: gt.failureTagIds,
    });
  }

  if (gtMap.size === 0) {
    throw new Error(`No ground truth defined for package ${pkg.name}`);
  }

  // All completed items in this package with their score + video duration
  const items = await prisma.evaluationItem.findMany({
    where: { packageId, status: "COMPLETED" },
    select: {
      id: true,
      assignedToId: true,
      videoAssetId: true,
      dimensionId: true,
      completedAt: true,
      assignedAt: true,
      watchProgress: true,
      videoAsset: { select: { durationSec: true } },
      scores: {
        where: { validity: "VALID" },
        select: { value: true, failureTags: true },
        take: 1,
      },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (items.length === 0) {
    return { packageId, results: [], assessedAt: new Date().toISOString() };
  }

  // Group items by user + compute per-user speed
  interface UserBucket {
    user: { id: string; name: string };
    annotations: RawAnnotation[];
    durationSumSec: number; // span between first assignedAt and last completedAt
  }
  const byUser = new Map<string, UserBucket>();

  for (const item of items) {
    const gtKey = `${item.videoAssetId}|${item.dimensionId}`;
    const gt = gtMap.get(gtKey);
    if (!gt) continue; // no ground truth for this item's (video, dim) — skip
    if (item.scores.length === 0) continue; // no valid score submitted

    const bucket = byUser.get(item.assignedToId) ?? {
      user: item.assignedTo,
      annotations: [],
      durationSumSec: 0,
    };

    const watchRatio = extractWatchRatio(item.watchProgress, item.videoAsset.durationSec ?? null);

    bucket.annotations.push({
      score: item.scores[0].value,
      groundTruthScore: gt.score,
      predictedTagIds: item.scores[0].failureTags ?? [],
      groundTruthTagIds: gt.failureTagIds ?? [],
      watchRatio,
    });

    byUser.set(item.assignedToId, bucket);
  }

  // Compute speed per user (items per hour based on assigned→completed span)
  // Use each user's (maxCompletedAt - minAssignedAt) in hours.
  const userTimings = new Map<string, { firstAssigned: Date | null; lastCompleted: Date | null }>();
  for (const item of items) {
    const timing = userTimings.get(item.assignedToId) ?? { firstAssigned: null, lastCompleted: null };
    if (item.assignedAt && (!timing.firstAssigned || item.assignedAt < timing.firstAssigned)) {
      timing.firstAssigned = item.assignedAt;
    }
    if (item.completedAt && (!timing.lastCompleted || item.completedAt > timing.lastCompleted)) {
      timing.lastCompleted = item.completedAt;
    }
    userTimings.set(item.assignedToId, timing);
  }

  const userCompletionsPerHour = new Map<string, number>();
  for (const [userId, bucket] of byUser.entries()) {
    const t = userTimings.get(userId);
    if (!t || !t.firstAssigned || !t.lastCompleted) {
      userCompletionsPerHour.set(userId, 0);
      continue;
    }
    const hours = Math.max(0.01, (t.lastCompleted.getTime() - t.firstAssigned.getTime()) / 3_600_000);
    userCompletionsPerHour.set(userId, bucket.annotations.length / hours);
  }
  const batchMedianCompletionsPerHour = median(
    Array.from(userCompletionsPerHour.values()).filter((v) => v > 0)
  );

  // ─── Pass 0: Bayesian IRT via Python subprocess ──────
  // Fits joint GRM (Likert) + Davidson-BT (Arena) via NumPyro NUTS. On
  // success, the per-user posteriors replace the bootstrap heuristic for
  // α / CI / rankogram. On any failure (missing pip install, timeout,
  // sampler divergence, bad data) we fall through to the bootstrap path
  // so the feature never hard-breaks.
  const irtPosteriors = new Map<string, IRTRaterPosterior>();
  let irtGlobal: IRTResult["globalDiagnostics"] | null = null;
  let irtError: string | null = null;
  try {
    const raters = [...byUser.keys()];
    const itemKeys = new Set<string>();
    const likertObs: IRTInput["likertObs"] = [];
    for (const item of items) {
      if (item.scores.length === 0) continue;
      const gt = gtMap.get(`${item.videoAssetId}|${item.dimensionId}`);
      if (!gt) continue;
      const key = `${item.videoAssetId}:${item.dimensionId}`;
      itemKeys.add(key);
    }
    // Build item index map in a stable order.
    const itemsArr = [...itemKeys];
    const itemIdx = new Map(itemsArr.map((k, i) => [k, i]));
    const raterIdx = new Map(raters.map((u, i) => [u, i]));
    for (const item of items) {
      if (item.scores.length === 0) continue;
      if (!gtMap.has(`${item.videoAssetId}|${item.dimensionId}`)) continue;
      const rIdx = raterIdx.get(item.assignedToId);
      const iIdx = itemIdx.get(`${item.videoAssetId}:${item.dimensionId}`);
      if (rIdx == null || iIdx == null) continue;
      likertObs.push({
        raterIdx: rIdx,
        itemIdx: iIdx,
        score: item.scores[0].value,
      });
    }

    // Arena items for the same calibration package — participate in the
    // joint model via Davidson-BT.
    const arenaItems = await prisma.arenaItem.findMany({
      where: { packageId, status: "COMPLETED", verdict: { not: null } },
      select: {
        assignedToId: true,
        videoAssetAId: true,
        videoAssetBId: true,
        dimensionId: true,
        verdict: true,
      },
    });
    const pairwiseObs: IRTInput["pairwiseObs"] = [];
    for (const a of arenaItems) {
      const aKey = `${a.videoAssetAId}:${a.dimensionId}`;
      const bKey = `${a.videoAssetBId}:${a.dimensionId}`;
      // Arena items reference videos that may not be in the Likert set;
      // extend the item index on the fly so q_i is shared.
      if (!itemIdx.has(aKey)) {
        itemIdx.set(aKey, itemsArr.length);
        itemsArr.push(aKey);
      }
      if (!itemIdx.has(bKey)) {
        itemIdx.set(bKey, itemsArr.length);
        itemsArr.push(bKey);
      }
      const rIdx = raterIdx.get(a.assignedToId);
      if (rIdx == null || !a.verdict) continue;
      pairwiseObs.push({
        raterIdx: rIdx,
        itemAIdx: itemIdx.get(aKey) as number,
        itemBIdx: itemIdx.get(bKey) as number,
        verdict: a.verdict as
          | "LEFT_WINS"
          | "RIGHT_WINS"
          | "BOTH_GOOD"
          | "BOTH_BAD",
      });
    }

    // Build per-item GT map so the sampler can anchor q_{i,d}. We key
    // by the same "<videoAssetId>:<dimensionId>" string used for
    // itemsArr, then convert to itemIdx.
    const groundTruthByIdx: Record<number, number> = {};
    for (const key of itemsArr) {
      const [vid, dim] = key.split(":");
      const gt = gtMap.get(`${vid}|${dim}`);
      if (gt) {
        const idx = itemIdx.get(key);
        if (idx != null) groundTruthByIdx[idx] = gt.score;
      }
    }

    // Guardrails: NUTS needs non-trivial data to converge. Skip if the
    // matrix is too sparse — the bootstrap heuristic will take over.
    const totalObs = likertObs.length + pairwiseObs.length;
    if (raters.length >= 2 && itemsArr.length >= 2 && totalObs >= 20) {
      const result = await fitBayesianIRT({
        raters,
        items: itemsArr,
        likertObs,
        pairwiseObs,
        groundTruth: groundTruthByIdx,
        numCategories: 5,
      });
      for (const r of result.raters) {
        irtPosteriors.set(r.userId, r);
      }
      irtGlobal = result.globalDiagnostics;
    } else {
      irtError = `insufficient-data: ${raters.length} raters, ${itemsArr.length} items, ${totalObs} obs`;
    }
  } catch (e) {
    irtError =
      e instanceof BayesianIRTError
        ? `${e.reason}: ${e.message}${e.detail ? " | " + e.detail.slice(0, 200) : ""}`
        : e instanceof Error
          ? e.message
          : String(e);
    // Log but don't throw — bootstrap fallback runs next.
    console.warn(`[capability-scoring] Bayesian IRT failed, falling back to bootstrap: ${irtError}`);
  }

  // Pass 1: compute scores + posterior per user (in memory, so we can rank)
  interface StagedRow {
    userId: string;
    userName: string;
    itemsEvaluated: number;
    scores: CapabilityScores | null;
    posterior: PosteriorSummary | null;
    irt: IRTRaterPosterior | null;
    /**
     * Absolute GT agreement score, 0-100, with Bayesian shrinkage.
     * See Pass 1 for the exact formula. Two users whose per-item
     * accuracy is similar will get similar scores regardless of batch
     * size or IRT ranking noise. Small-N users are shrunk toward the
     * random-baseline 0.5 so "5 items all correct" won't hit 100.
     */
    gtAgreement: number | null;
    /** Bootstrap 95% CI on the shrunk agreement, in percentile units. */
    gtAgreementCILow: number | null;
    gtAgreementCIHigh: number | null;
    reason?: string;
  }
  const staged: StagedRow[] = [];
  const assessedAt = new Date();

  for (const [userId, bucket] of byUser.entries()) {
    if (bucket.annotations.length === 0) {
      staged.push({
        userId,
        userName: bucket.user.name,
        itemsEvaluated: 0,
        scores: null,
        posterior: null,
        irt: null,
        gtAgreement: null,
        gtAgreementCILow: null,
        gtAgreementCIHigh: null,
        reason: "no_valid_items",
      });
      continue;
    }

    const scores = scoreAnnotations({
      annotations: bucket.annotations,
      completionsPerHour: userCompletionsPerHour.get(userId) ?? 0,
      batchMedianCompletionsPerHour,
    });

    if (!scores) {
      staged.push({
        userId,
        userName: bucket.user.name,
        itemsEvaluated: bucket.annotations.length,
        scores: null,
        posterior: null,
        irt: null,
        gtAgreement: null,
        gtAgreementCILow: null,
        gtAgreementCIHigh: null,
        reason: "score_computation_failed",
      });
      continue;
    }

    const irt = irtPosteriors.get(userId) ?? null;
    // Prefer the Bayesian posterior. Bootstrap acts as the fallback
    // both when the Python subprocess failed globally AND when a
    // specific user is missing from the IRT result.
    const posterior: PosteriorSummary = irt
      ? {
          alphaMean: irt.alphaMean,
          alphaStd: irt.alphaStd,
          alphaCILow: irt.alphaCILow,
          alphaCIHigh: irt.alphaCIHigh,
        }
      : bootstrapPosterior(
          bucket.annotations,
          userCompletionsPerHour.get(userId) ?? 0,
          batchMedianCompletionsPerHour,
          hashStringToSeed(`${packageId}|${userId}`),
        );

    // Shrunk GT agreement with Bayesian-style prior (Beta-like mean
    // shrinkage) + bootstrap CI. Defends against the small-N trap where
    // a user who scored 5 items perfectly would otherwise display 100%.
    //
    //   per_item_agreement = 1 - |score - GT| / 4     ∈ [0, 1]
    //   shrunk_mean = (Σ agreement + w·μ₀) / (n + w)
    //
    // with prior_weight w = 4 and prior mean μ₀ = 0.5. Bootstrap 2000
    // resamples (applying the same shrinkage inside each replicate)
    // gives a sample-size-aware 95% CI in percentile units.
    const SHRINK_WEIGHT = 4;
    const SHRINK_PRIOR_MEAN = 0.5;
    const perItem = bucket.annotations.map(
      (a) => 1 - Math.abs(a.score - a.groundTruthScore) / 4,
    );
    let gtAgreement: number | null = null;
    let gtAgreementCILow: number | null = null;
    let gtAgreementCIHigh: number | null = null;
    if (perItem.length > 0) {
      const n = perItem.length;
      const shrunk = (sumPerItem: number) =>
        (sumPerItem + SHRINK_WEIGHT * SHRINK_PRIOR_MEAN) /
        (n + SHRINK_WEIGHT);
      gtAgreement = 100 * shrunk(perItem.reduce((s, v) => s + v, 0));

      // Bootstrap CI — deterministic RNG keyed by (packageId, userId)
      // so repeated refreshes show identical numbers.
      const B = 2000;
      const rng = mulberry32(
        hashStringToSeed(`${packageId}|${userId}|gtBoot`),
      );
      const bootMeans: number[] = new Array(B);
      for (let b = 0; b < B; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          s += perItem[Math.floor(rng() * n)];
        }
        bootMeans[b] = shrunk(s);
      }
      bootMeans.sort((a, b) => a - b);
      gtAgreementCILow = 100 * bootMeans[Math.floor(B * 0.025)];
      gtAgreementCIHigh = 100 * bootMeans[Math.floor(B * 0.975)];
    }

    staged.push({
      userId,
      userName: bucket.user.name,
      itemsEvaluated: bucket.annotations.length,
      scores,
      posterior,
      irt,
      gtAgreement,
      gtAgreementCILow,
      gtAgreementCIHigh,
    });
  }

  // Pass 2: percentile + tier derivation.
  //
  // PRIMARY: absolute GT-agreement score (0-100). Scale-invariant, so
  // two raters with similar per-item accuracy land on similar numbers
  // regardless of batch size or how many other raters participated.
  // This is what the UI shows as the user's "capability percentile".
  //
  // SECONDARY (stored in metadata only): IRT rankogram gives an
  // overlap-aware relative percentile — useful for CI visualisation
  // but not the headline number, since small-N ranking is unstable.
  const ranked = staged.filter((s) => s.posterior !== null);
  const rankMap = new Map<string, number>();
  const irtRankMap = new Map<string, number>();
  const n = ranked.length;

  // IRT-based percentile (kept for UI CI width + rankogram visuals).
  const haveRealBins = ranked.every((s) => {
    const bins = s.irt?.rankogramBins;
    return Array.isArray(bins) && bins.length === n;
  });
  if (haveRealBins && n > 1) {
    for (const s of ranked) {
      const bins = s.irt!.rankogramBins as number[];
      let pct = 0;
      for (let k = 0; k < n; k++) {
        pct += bins[k] * ((n - 1 - k) / (n - 1)) * 100;
      }
      irtRankMap.set(s.userId, pct);
    }
  } else {
    const sortedByAlpha = [...ranked].sort(
      (a, b) => a.posterior!.alphaMean - b.posterior!.alphaMean,
    );
    for (let i = 0; i < n; i++) {
      const pct = n === 1 ? 50 : (i / (n - 1)) * 100;
      irtRankMap.set(sortedByAlpha[i].userId, pct);
    }
  }

  // Primary percentile ← GT agreement. Users with no GT coverage fall
  // back to the IRT percentile so unassessed-vs-GT batches still rank.
  for (const s of ranked) {
    if (s.gtAgreement != null) {
      rankMap.set(s.userId, s.gtAgreement);
    } else {
      rankMap.set(s.userId, irtRankMap.get(s.userId) ?? 50);
    }
  }

  // Pass 3: persist + assemble result.
  // Minimum-items guard: users with < MIN_ITEMS_FOR_TIER completed
  // calibration items don't receive a tier or percentile — their data
  // is too sparse to trust even after Bayesian shrinkage. UI shows
  // them as "unassessed" with a reason tag.
  const MIN_ITEMS_FOR_TIER = 5;
  const results: AssessmentResult[] = [];
  for (const s of staged) {
    const eligible = s.itemsEvaluated >= MIN_ITEMS_FOR_TIER;
    const rankPercentile = eligible ? rankMap.get(s.userId) ?? null : null;
    const tier = rankPercentile != null ? tierFromRank(rankPercentile) : null;

    if (s.scores) {
      await prisma.capabilityAssessment.create({
        data: {
          userId: s.userId,
          assessmentDate: assessedAt,
          accuracy: s.scores.accuracy,
          consistency: s.scores.consistency,
          coverage: s.scores.coverage,
          detailOriented: s.scores.detailOriented,
          speed: s.scores.speed,
          compositeScore: s.scores.compositeScore,
          alphaMean: s.posterior?.alphaMean ?? null,
          alphaStd: s.posterior?.alphaStd ?? null,
          alphaCILow: s.posterior?.alphaCILow ?? null,
          alphaCIHigh: s.posterior?.alphaCIHigh ?? null,
          rankPercentile,
          tier,
          metadata: {
            packageId,
            packageName: pkg.name,
            itemsEvaluated: s.itemsEvaluated,
            batchMedianCompletionsPerHour,
            completionsPerHour: userCompletionsPerHour.get(s.userId) ?? 0,
            batchRaterCount: n,
            // Provenance of the posterior: "bayesian_irt" when NumPyro
            // NUTS succeeded for this user, otherwise "bootstrap".
            posteriorSource: s.irt ? "bayesian_irt" : "bootstrap",
            bootstrapIterations: BOOTSTRAP_ITERATIONS,
            // Per-user diagnostics from the fitted Bayesian model.
            irt: s.irt
              ? {
                  rHat: s.irt.rHat,
                  ess: s.irt.ess,
                  rankogramBins: s.irt.rankogramBins,
                }
              : null,
            // Shrunk GT agreement + bootstrap CI (percentile units).
            // These drive the Hero "avg CI width" card and the Forest
            // track's CI whisker endpoints.
            gtAgreement: s.gtAgreement,
            gtAgreementCILow: s.gtAgreementCILow,
            gtAgreementCIHigh: s.gtAgreementCIHigh,
            irtPercentile: irtRankMap.get(s.userId) ?? null,
            // Global fit diagnostics (shared across all users in this batch).
            irtGlobal,
            irtError,
          },
        },
      });
    }

    results.push({
      userId: s.userId,
      userName: s.userName,
      itemsEvaluated: s.itemsEvaluated,
      scores: s.scores,
      posterior: s.posterior,
      rankPercentile,
      tier,
      reason: s.reason,
    });
  }

  return {
    packageId,
    results: results.sort((a, b) =>
      (b.scores?.compositeScore ?? -1) - (a.scores?.compositeScore ?? -1)
    ),
    assessedAt: assessedAt.toISOString(),
  };
}
