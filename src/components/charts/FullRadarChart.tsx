"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

interface MetricData {
  readonly mean: number;
  readonly std: number;
  readonly baseline: number;
  readonly delta: number;
}

interface Model {
  readonly name: string;
  readonly metrics: Record<string, MetricData>;
}

interface FullRadarChartProps {
  readonly models: readonly Model[];
  readonly metrics: readonly string[];
}

const MODEL_COLORS = ["#06b6d4", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444"];

const CHART_STYLES = {
  tooltip: {
    backgroundColor: "var(--color-surface-elevated)",
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 8,
    color: "var(--color-text-primary)",
    fontSize: 12,
  },
  grid:   { stroke: "var(--color-border-subtle)" },
  axis:   { fill: "var(--color-text-secondary)", fontSize: 11 },
  radius: { fill: "var(--color-text-tertiary)",  fontSize: 10 },
  legend: { color: "var(--color-text-secondary)", fontSize: 12, paddingTop: 12 },
} as const;

function formatMetricLabel(metric: string): string {
  return metric
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function FullRadarChart({ models, metrics }: FullRadarChartProps) {
  const chartData = metrics.map((metric) => {
    const point: Record<string, string | number> = {
      metric: formatMetricLabel(metric),
    };
    models.forEach((model) => {
      const metricData = model.metrics[metric];
      point[model.name] = metricData ? +(metricData.mean * 100).toFixed(1) : 0;
    });
    return point;
  });

  return (
    <ResponsiveContainer width="100%" height={450}>
      <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="65%">
        <PolarGrid stroke={CHART_STYLES.grid.stroke} />
        <PolarAngleAxis
          dataKey="metric"
          tick={CHART_STYLES.axis}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[60, 100]}
          tick={CHART_STYLES.radius}
          axisLine={false}
        />
        {models.map((model, i) => (
          <Radar
            key={model.name}
            name={model.name}
            dataKey={model.name}
            stroke={MODEL_COLORS[i % MODEL_COLORS.length]}
            fill={MODEL_COLORS[i % MODEL_COLORS.length]}
            fillOpacity={0.08}
            strokeWidth={2}
          />
        ))}
        <Legend wrapperStyle={CHART_STYLES.legend} />
        <Tooltip contentStyle={CHART_STYLES.tooltip} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
