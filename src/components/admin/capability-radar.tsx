"use client";

import { useLocale } from "@/lib/i18n/context";

interface CapabilityScores {
  accuracy: number;
  consistency: number;
  coverage: number;
  detailOriented: number;
  speed: number;
  compositeScore: number;
}

/**
 * Optional posterior summary from Phase 5 IRT-lite. When provided, we draw a
 * faint CI ring on top of the composite score so viewers can see uncertainty
 * at a glance. If `alphaStd` is large relative to the mean (>1), the ring is
 * highlighted to flag low-confidence assessments.
 */
export interface PosteriorBand {
  alphaMean: number;
  alphaStd: number;
  alphaCILow: number;
  alphaCIHigh: number;
}

export type CapabilityTier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";

interface Props {
  scores: CapabilityScores | null;
  size?: "sm" | "md";
  posterior?: PosteriorBand | null;
  tier?: CapabilityTier | null;
  rankPercentile?: number | null;
}

const DIMENSIONS = [
  { key: "accuracy", labelZh: "准确", labelEn: "Acc" },
  { key: "consistency", labelZh: "一致", labelEn: "Cons" },
  { key: "coverage", labelZh: "覆盖", labelEn: "Cov" },
  { key: "detailOriented", labelZh: "细致", labelEn: "Detail" },
  { key: "speed", labelZh: "速度", labelEn: "Speed" },
] as const;

/**
 * Lightweight SVG radar chart — no external deps.
 * Pure presentational: pass scores 0-10 or null for the "not assessed" state.
 */
/**
 * Logistic transform: α ∈ ℝ → [0, 1] → 0-10 scale. Used to map the
 * bootstrap CI (which lives in logit-space) onto the 0-10 radar so the CI
 * band is visually comparable to compositeScore.
 */
function alphaToScore(alpha: number): number {
  const p = 1 / (1 + Math.exp(-alpha));
  return p * 10;
}

const TIER_STYLES: Record<CapabilityTier, { zh: string; en: string; cls: string }> = {
  TIER_1: { zh: "T1 优秀", en: "T1 Top", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
  TIER_2: { zh: "T2 稳健", en: "T2 Solid", cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
  TIER_3: { zh: "T3 待进", en: "T3 Needs Work", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  TIER_4: { zh: "T4 低信度", en: "T4 Low Conf.", cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" },
};

export function CapabilityRadar({ scores, size = "md", posterior, tier, rankPercentile }: Props) {
  const { locale } = useLocale();
  const dim = size === "sm" ? 80 : 120;
  const cx = dim / 2;
  const cy = dim / 2;
  const radius = dim / 2 - 14;

  if (!scores) {
    return (
      <div
        className="flex items-center justify-center text-[10px] text-muted-foreground"
        style={{ width: dim, height: dim }}
      >
        {locale === "zh" ? "尚未评估" : "N/A"}
      </div>
    );
  }

  const angleStep = (2 * Math.PI) / DIMENSIONS.length;

  const axisPoints = DIMENSIONS.map((_, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      labelAngle: angle,
    };
  });

  const dataPoints = DIMENSIONS.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const val = scores[d.key as keyof CapabilityScores] ?? 0;
    const r = (val / 10) * radius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  const pathD = dataPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ") + " Z";

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg
        width={dim}
        height={dim}
        viewBox={`0 0 ${dim} ${dim}`}
        className="text-muted-foreground"
      >
        {/* CI band (behind data polygon): annulus between CI_low and CI_high on composite axis */}
        {posterior && (() => {
          const loRadius = (alphaToScore(posterior.alphaCILow) / 10) * radius;
          const hiRadius = (alphaToScore(posterior.alphaCIHigh) / 10) * radius;
          // Flag wide CI (std > 1 in logit space ≈ highly uncertain)
          const wide = posterior.alphaStd > 1;
          return (
            <g>
              <circle
                cx={cx}
                cy={cy}
                r={hiRadius}
                fill="currentColor"
                className={wide ? "text-amber-500/15" : "text-primary/10"}
                stroke="none"
              />
              <circle
                cx={cx}
                cy={cy}
                r={loRadius}
                fill="var(--background, #fff)"
                stroke="none"
              />
            </g>
          );
        })()}
        {/* Concentric rings */}
        {[0.25, 0.5, 0.75, 1].map((pct) => (
          <circle
            key={pct}
            cx={cx}
            cy={cy}
            r={radius * pct}
            fill="none"
            stroke="currentColor"
            strokeWidth={0.5}
            opacity={0.25}
          />
        ))}
        {/* Axes */}
        {axisPoints.map((p, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="currentColor"
            strokeWidth={0.5}
            opacity={0.3}
          />
        ))}
        {/* Data polygon */}
        <path
          d={pathD}
          fill="currentColor"
          className="text-primary/30"
          stroke="currentColor"
          strokeWidth={1.2}
        />
        {/* Labels (only md) */}
        {size === "md" &&
          DIMENSIONS.map((d, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            const lx = cx + (radius + 10) * Math.cos(angle);
            const ly = cy + (radius + 10) * Math.sin(angle);
            return (
              <text
                key={d.key}
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                fill="currentColor"
                className="text-foreground/70"
              >
                {locale === "zh" ? d.labelZh : d.labelEn}
              </text>
            );
          })}
      </svg>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-mono tabular-nums">
          {scores.compositeScore.toFixed(1)}
        </span>
        {tier && size === "md" && (
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${TIER_STYLES[tier].cls}`}
          >
            {locale === "zh" ? TIER_STYLES[tier].zh : TIER_STYLES[tier].en}
          </span>
        )}
      </div>
      {rankPercentile != null && size === "md" && (
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {locale === "zh" ? "分位" : "Rank"} {rankPercentile.toFixed(0)}%
        </span>
      )}
    </div>
  );
}
