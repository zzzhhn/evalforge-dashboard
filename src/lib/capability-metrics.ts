/**
 * Closed-form statistics for the calibration dashboard.
 *
 * These functions land the metrics that previously rendered as "Phase 9"
 * stubs. They are NOT full MCMC Bayesian inference — they are principled
 * frequentist equivalents that share the units (α, ICC, Kα, percentile)
 * so the UI is honest. When a real PyMC/Stan sampler lands we can swap
 * the call-sites without changing the UI contract.
 *
 * All functions are pure; no DB access. Callers pass ratings matrices
 * already pulled by server actions.
 */

// ─── Types ───────────────────────────────────────────

/** One item = one (video × dimension) cell. Ratings keyed by userId. */
export interface ItemRating {
  key: string; // "<videoAssetId>:<dimensionId>"
  ratings: Record<string, number>; // userId → score (1-5)
  groundTruth?: number | null;
}

// ─── Two-way random ANOVA + ICC(2,k) ─────────────────

/**
 * Intraclass Correlation Coefficient, two-way random effects, average of
 * k raters. Follows Shrout & Fleiss (1979) ICC(2,k).
 *
 * Only items rated by at least 2 raters contribute. Returns null if the
 * matrix is too sparse (<3 items with ≥2 raters).
 *
 * Implementation detail: we use the "balanced-design" two-way ANOVA. For
 * unbalanced raters (different raters per item) we project to the common
 * rater set per item-pair. A cleaner generalised linear model is out of
 * scope here; the projection is a standard approximation.
 */
export function iccTwoK(items: ItemRating[]): number | null {
  // Find common raters across items with ≥2 ratings.
  const multiRated = items.filter((it) => Object.keys(it.ratings).length >= 2);
  if (multiRated.length < 3) return null;

  const raterSet = new Set<string>();
  for (const it of multiRated) {
    for (const uid of Object.keys(it.ratings)) raterSet.add(uid);
  }
  const raters = [...raterSet];
  const k = raters.length;
  if (k < 2) return null;

  // Build dense matrix; missing cells filled with item mean (minimal
  // imputation). This is a practical compromise for unbalanced designs.
  const rows: number[][] = [];
  const itemMeans: number[] = [];
  for (const it of multiRated) {
    const vals = Object.values(it.ratings);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    itemMeans.push(mean);
    const row = raters.map((uid) =>
      it.ratings[uid] != null ? it.ratings[uid] : mean,
    );
    rows.push(row);
  }
  const n = rows.length;

  // ANOVA sums of squares.
  const grandMean =
    rows.reduce((s, r) => s + r.reduce((ss, v) => ss + v, 0), 0) / (n * k);
  const raterMeans = raters.map((_, j) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += rows[i][j];
    return s / n;
  });
  let ssBetweenItems = 0;
  for (let i = 0; i < n; i++) {
    const d = itemMeans[i] - grandMean;
    ssBetweenItems += d * d;
  }
  ssBetweenItems *= k;
  let ssBetweenRaters = 0;
  for (let j = 0; j < k; j++) {
    const d = raterMeans[j] - grandMean;
    ssBetweenRaters += d * d;
  }
  ssBetweenRaters *= n;
  let ssTotal = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      const d = rows[i][j] - grandMean;
      ssTotal += d * d;
    }
  }
  const ssResidual = Math.max(0, ssTotal - ssBetweenItems - ssBetweenRaters);
  const msItems = ssBetweenItems / (n - 1);
  const msRaters = ssBetweenRaters / Math.max(k - 1, 1);
  const msResidual = ssResidual / Math.max((n - 1) * (k - 1), 1);

  // ICC(2,k) — average-of-k-raters, two-way random.
  const denom = msItems + (msRaters - msResidual) / n;
  if (denom <= 0) return 0;
  const icc = (msItems - msResidual) / denom;
  return Math.max(0, Math.min(1, icc));
}

// ─── Krippendorff's α (interval) ─────────────────────

/**
 * Krippendorff's α for interval data. Follows Krippendorff (2011):
 *   α = 1 − D_o / D_e
 *
 * D_o (observed disagreement) averages squared pairwise differences
 * across coders within each item, normalised by (n_item − 1).
 * D_e (expected disagreement) is 2 * pooled variance.
 *
 * Returns null if fewer than 2 items have ≥2 coders.
 */
export function krippendorffAlphaInterval(items: ItemRating[]): number | null {
  const multi = items.filter((it) => Object.keys(it.ratings).length >= 2);
  if (multi.length < 2) return null;

  // Observed disagreement.
  let observedNum = 0; // Σ_i (Σ_pairs (x-y)²) / (n_i − 1)
  let observedDen = 0; // Σ_i n_i  (total pairable observations)
  const pooled: number[] = [];
  for (const it of multi) {
    const vals = Object.values(it.ratings);
    const n = vals.length;
    if (n < 2) continue;
    let pairSum = 0;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const d = vals[a] - vals[b];
        pairSum += d * d;
      }
    }
    // Canonical Krippendorff normalises by (n_i - 1), NOT n_i * (n_i - 1) / 2.
    observedNum += (2 * pairSum) / (n - 1);
    observedDen += n;
    for (const v of vals) pooled.push(v);
  }
  if (observedDen === 0) return null;
  const D_o = observedNum / observedDen;

  // Expected disagreement = 2 * pooled variance (interval metric).
  const mean = pooled.reduce((s, v) => s + v, 0) / pooled.length;
  const variance =
    pooled.reduce((s, v) => s + (v - mean) * (v - mean), 0) / pooled.length;
  const D_e = 2 * variance;
  if (D_e <= 1e-9) return 1; // everyone agreed — α is trivially 1.
  const alpha = 1 - D_o / D_e;
  return Math.max(-1, Math.min(1, alpha));
}

// ─── Bootstrap rank posterior ────────────────────────

export interface AnnotatorPosterior {
  userId: string;
  alphaMean: number;
  alphaStd: number;
}

export interface PosteriorRankResult {
  userId: string;
  percentileMean: number;
  percentileCILow: number;
  percentileCIHigh: number;
  rankogramBins: number[]; // probability of occupying each rank (length N)
}

/**
 * Bootstrap the rank posterior from Gaussian-approximated α posteriors.
 * For each Monte Carlo draw, sample α_user ~ N(mean_user, std_user), then
 * rank all users by that draw. Aggregate across draws gives each user:
 *   - percentile mean and 95% CI
 *   - rankogram = probability of holding rank r for r = 1..N
 *
 * Rank 1 = best (highest α). Percentile is expressed as (N − rank) / (N−1) × 100
 * so the top user sits at 100 and the bottom at 0.
 */
export function bootstrapRankPosterior(
  users: AnnotatorPosterior[],
  nDraws = 4000,
  seed = 42,
): PosteriorRankResult[] {
  const N = users.length;
  if (N === 0) return [];

  const ranksPerUser: number[][] = users.map(() => new Array<number>(N).fill(0));

  // Deterministic PRNG so page loads are stable.
  const rng = mulberry32(seed);

  // Precompute once: per-user list of sigma per-draw is cheap.
  for (let d = 0; d < nDraws; d++) {
    const draws = users.map((u) => u.alphaMean + u.alphaStd * boxMuller(rng));
    // Rank: descending α → rank 1 is the best.
    const idx = draws
      .map((v, i) => [v, i] as [number, number])
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i);
    for (let r = 0; r < N; r++) {
      ranksPerUser[idx[r]][r]++;
    }
  }

  return users.map((u, i) => {
    const hist = ranksPerUser[i].map((c) => c / nDraws);
    // Percentile at each rank r (0-indexed): (N-1-r)/(N-1) * 100.
    // Expected percentile = Σ_r hist[r] * (N-1-r)/(N-1) * 100.
    const pctFromRank = (r: number) =>
      N > 1 ? ((N - 1 - r) / (N - 1)) * 100 : 50;
    let pctMean = 0;
    for (let r = 0; r < N; r++) pctMean += hist[r] * pctFromRank(r);
    // 95% CI by cumulative mass on rank distribution.
    let cum = 0;
    let rankHigh = 0;
    let rankLow = N - 1;
    for (let r = 0; r < N; r++) {
      cum += hist[r];
      if (cum >= 0.025 && rankHigh === 0) rankHigh = r; // this r is the upper α-rank → higher pct
      if (cum >= 0.975 && rankLow === N - 1) rankLow = r;
    }
    return {
      userId: u.userId,
      percentileMean: pctMean,
      percentileCILow: pctFromRank(rankLow),
      percentileCIHigh: pctFromRank(rankHigh),
      rankogramBins: hist,
    };
  });
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function boxMuller(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Per-annotator Davidson-BT surrogates ────────────

export interface AnnotatorScoreBundle {
  userId: string;
  // (evaluationItemId, dimensionId, value, groupMedian) rows for Likert
  // severity & sensitivity.
  likertRows: {
    key: string;
    value: number;
    groupMedian: number;
    groundTruth: number | null;
  }[];
  // Arena verdicts from this annotator within calibration packages.
  arenaVerdicts: ("LEFT_WINS" | "RIGHT_WINS" | "BOTH_GOOD" | "BOTH_BAD")[];
}

export interface AnnotatorParams {
  /** Severity δ_R: mean deviation from per-item group median. Negative = strict. */
  severityDelta: number | null;
  /** Tie propensity γ_R: P(BOTH_GOOD ∪ BOTH_BAD) in Arena votes. */
  tieGamma: number | null;
  /** Quality sensitivity H_R: spread of scores between high-GT and low-GT items. */
  qualityH: number | null;
}

export function computeAnnotatorParams(b: AnnotatorScoreBundle): AnnotatorParams {
  // Severity δ_R
  let severity: number | null = null;
  if (b.likertRows.length >= 5) {
    const deltas = b.likertRows.map((r) => r.value - r.groupMedian);
    severity = deltas.reduce((s, v) => s + v, 0) / deltas.length;
  }
  // Tie γ_R
  let tie: number | null = null;
  if (b.arenaVerdicts.length >= 3) {
    const ties = b.arenaVerdicts.filter(
      (v) => v === "BOTH_GOOD" || v === "BOTH_BAD",
    ).length;
    tie = ties / b.arenaVerdicts.length;
  }
  // Quality sensitivity H_R
  let quality: number | null = null;
  const withGT = b.likertRows.filter((r) => r.groundTruth != null);
  if (withGT.length >= 6) {
    const low = withGT.filter((r) => (r.groundTruth as number) <= 2);
    const high = withGT.filter((r) => (r.groundTruth as number) >= 4);
    if (low.length >= 2 && high.length >= 2) {
      const meanLow =
        low.reduce((s, r) => s + r.value, 0) / low.length;
      const meanHigh =
        high.reduce((s, r) => s + r.value, 0) / high.length;
      // H_R = normalised Δmean in [0, ~2]. Clamp to 2 for display.
      quality = Math.max(0, Math.min(2, meanHigh - meanLow));
    }
  }
  return {
    severityDelta: severity,
    tieGamma: tie,
    qualityH: quality,
  };
}

// ─── Per-annotator concordance vs group ──────────────

/**
 * Pearson correlation between a user's ratings and the aggregated group
 * consensus (median of other raters per item). Reported as ICC surrogate.
 */
export function perUserIcc(b: AnnotatorScoreBundle): number | null {
  const pairs = b.likertRows;
  if (pairs.length < 5) return null;
  const xs = pairs.map((p) => p.value);
  const ys = pairs.map((p) => p.groupMedian);
  return pearson(xs, ys);
}

/**
 * Per-user Krippendorff α (interval) between their ratings and the group
 * median. Treats the two streams as two coders on the same items.
 */
export function perUserKrippendorff(b: AnnotatorScoreBundle): number | null {
  const items: ItemRating[] = b.likertRows.map((r, i) => ({
    key: `${i}`,
    ratings: { self: r.value, group: r.groupMedian },
  }));
  return krippendorffAlphaInterval(items);
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  if (den === 0) return null;
  return num / den;
}

// ─── Bootstrap chain diagnostics ────────────────────

/**
 * "Gelman-Rubin-like" convergence stat across bootstrap chain splits.
 * Not a true R̂ — real R̂ requires multiple MCMC chains with burn-in.
 * Here we split the draws into 4 chains and compute between/within
 * variance ratio. Values ≤1.01 indicate excellent stability.
 */
export function rHatFromDraws(draws: number[], nChains = 4): number | null {
  const n = Math.floor(draws.length / nChains);
  if (n < 50) return null;
  const chains: number[][] = [];
  for (let c = 0; c < nChains; c++) {
    chains.push(draws.slice(c * n, c * n + n));
  }
  const chainMeans = chains.map(
    (ch) => ch.reduce((s, v) => s + v, 0) / ch.length,
  );
  const grand = chainMeans.reduce((s, v) => s + v, 0) / nChains;
  const B =
    (n / (nChains - 1)) *
    chainMeans.reduce((s, v) => s + (v - grand) * (v - grand), 0);
  const chainVars = chains.map((ch) => {
    const m = ch.reduce((s, v) => s + v, 0) / ch.length;
    return ch.reduce((s, v) => s + (v - m) * (v - m), 0) / (ch.length - 1);
  });
  const W = chainVars.reduce((s, v) => s + v, 0) / nChains;
  if (W <= 0) return 1;
  const varHat = ((n - 1) / n) * W + B / n;
  return Math.sqrt(varHat / W);
}
