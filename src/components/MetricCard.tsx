interface MetricData {
  readonly mean: number;
  readonly std: number;
  readonly baseline: number;
  readonly delta: number;
}

interface MetricCardProps {
  readonly name: string;
  readonly data: MetricData;
  readonly formatLabel?: (key: string) => string;
}

function getDeltaClass(delta: number): string {
  if (delta > 0.005) return "delta-positive";
  if (delta < -0.005) return "delta-negative";
  return "delta-neutral";
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${(delta * 100).toFixed(1)}%`;
}

function defaultFormatLabel(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ScoreBar({ score }: { readonly score: number }) {
  const percentage = Math.min(score * 100, 100);
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-white/5">
      <div
        className="h-full rounded-full bg-accent-blue/60 transition-all duration-500"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function MetricCard({ name, data, formatLabel }: MetricCardProps) {
  const label = (formatLabel ?? defaultFormatLabel)(name);
  const deltaClass = getDeltaClass(data.delta);

  return (
    <div className="glass-card p-4 transition-all duration-200 hover:bg-bg-card-hover">
      <div className="flex items-start justify-between">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className={`text-xs font-mono ${deltaClass}`}>
          {formatDelta(data.delta)}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="score-display text-2xl font-bold text-text-primary">
          {(data.mean * 100).toFixed(1)}
        </span>
        <span className="text-xs text-text-muted">
          / 100
        </span>
      </div>

      <div className="mt-1 text-xs text-text-muted">
        baseline {(data.baseline * 100).toFixed(1)} | std {(data.std * 100).toFixed(1)}
      </div>

      <ScoreBar score={data.mean} />
    </div>
  );
}
