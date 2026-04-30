"use client";

interface Props {
  mean: number;
  ciLow: number;
  ciHigh: number;
  // Shared axis bounds so every row aligns visually across the table.
  axisMin: number;
  axisMax: number;
  tone?: "default" | "emerald" | "sky" | "amber" | "rose";
}

/**
 * Single-row horizontal forest plot: draws the 95% CI as a horizontal line
 * with a filled dot at the point estimate. All rows in a table should share
 * the same axisMin/axisMax so widths are visually comparable.
 */
export function ForestPlotRow({
  mean,
  ciLow,
  ciHigh,
  axisMin,
  axisMax,
  tone = "default",
}: Props) {
  // Graceful degradation: if CI collapses to a point, still show the dot.
  const range = Math.max(axisMax - axisMin, 1e-6);
  const pct = (v: number) => ((v - axisMin) / range) * 100;
  const lowPct = Math.max(0, Math.min(100, pct(ciLow)));
  const highPct = Math.max(0, Math.min(100, pct(ciHigh)));
  const meanPct = Math.max(0, Math.min(100, pct(mean)));

  const toneClass = {
    default: "stroke-primary fill-primary",
    emerald: "stroke-emerald-500 fill-emerald-500",
    sky: "stroke-sky-500 fill-sky-500",
    amber: "stroke-amber-500 fill-amber-500",
    rose: "stroke-rose-500 fill-rose-500",
  }[tone];

  return (
    <div className="flex items-center gap-2">
      <svg
        viewBox="0 0 100 12"
        preserveAspectRatio="none"
        className="h-4 flex-1"
        role="img"
        aria-label={`CI [${ciLow.toFixed(2)}, ${ciHigh.toFixed(2)}], mean ${mean.toFixed(2)}`}
      >
        {/* axis baseline */}
        <line
          x1="0"
          y1="6"
          x2="100"
          y2="6"
          className="stroke-border"
          strokeWidth="0.5"
        />
        {/* CI interval */}
        <line
          x1={lowPct}
          y1="6"
          x2={highPct}
          y2="6"
          className={toneClass}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* CI whiskers */}
        <line
          x1={lowPct}
          y1="3"
          x2={lowPct}
          y2="9"
          className={toneClass}
          strokeWidth="0.8"
        />
        <line
          x1={highPct}
          y1="3"
          x2={highPct}
          y2="9"
          className={toneClass}
          strokeWidth="0.8"
        />
        {/* point estimate */}
        <circle cx={meanPct} cy="6" r="1.8" className={toneClass} />
      </svg>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        [{ciLow.toFixed(2)}, {ciHigh.toFixed(2)}]
      </span>
    </div>
  );
}
