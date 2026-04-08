interface StatCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly subtitle?: string;
  readonly accentColor?: string;
}

export function StatCard({
  label,
  value,
  subtitle,
  accentColor = "text-accent-cyan",
}: StatCardProps) {
  return (
    <div className="glass-card p-5">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className={`mt-1 score-display text-3xl font-bold ${accentColor}`}>
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-xs text-text-muted">{subtitle}</p>
      )}
    </div>
  );
}
