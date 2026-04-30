"use client";

interface Props {
  /**
   * Real posterior bin probabilities, length = N (total annotators).
   * bins[r] = P(user holds rank r+1). Produced by
   * `bootstrapRankPosterior()` in capability-metrics.ts.
   * When null, falls back to the gaussian approximation keyed on
   * rankPercentile so sparse / unassessed rows still render something.
   */
  bins?: number[] | null;
  rankPercentile: number | null;
  total: number;
  /** Tint class, e.g. "bg-emerald-400/70". Defaults to primary. */
  tintClass?: string;
}

/**
 * Rankogram: horizontal bar strip where bar i is the posterior
 * probability that the user occupies rank i+1 (rank 1 = best).
 */
export function RankogramStrip({
  bins,
  rankPercentile,
  total,
  tintClass = "bg-primary/70",
}: Props) {
  if (rankPercentile == null || total <= 1) {
    return (
      <div className="h-4 w-full rounded-sm border bg-muted/30" aria-hidden />
    );
  }
  // Prefer real bootstrap bins. Fall back to gaussian approximation.
  const mass =
    bins && bins.length > 0
      ? bins
      : fallbackGaussian(rankPercentile, Math.min(total, 20));
  const peak = Math.max(...mass, 1e-9);

  return (
    <div
      className="flex h-4 w-full items-end gap-px rounded-sm border bg-muted/20 p-px"
      role="img"
      aria-label={`Rank posterior, percentile ${rankPercentile.toFixed(0)}`}
      title={`Rank posterior · pct ${rankPercentile.toFixed(0)}`}
    >
      {mass.map((p, i) => (
        <div
          key={i}
          className={`flex-1 rounded-[1px] ${tintClass}`}
          style={{ height: `${(p / peak) * 100}%`, minHeight: 1 }}
        />
      ))}
    </div>
  );
}

function fallbackGaussian(centerPct: number, bins: number): number[] {
  // Remaining fallback for rows where bootstrap wasn't run (no α posterior).
  // Not a pretend MCMC — just a best-effort visual when data is missing.
  const center = (centerPct / 100) * (bins - 1);
  const sigma = Math.max(1, bins * 0.18);
  const out: number[] = new Array(bins);
  let sum = 0;
  for (let i = 0; i < bins; i++) {
    const d = i - center;
    const v = Math.exp(-(d * d) / (2 * sigma * sigma));
    out[i] = v;
    sum += v;
  }
  return out.map((v) => v / sum);
}
