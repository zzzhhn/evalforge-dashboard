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
        <PolarGrid stroke="#374151" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fill: "#9ca3af", fontSize: 11 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[60, 100]}
          tick={{ fill: "#6b7280", fontSize: 10 }}
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
        <Legend
          wrapperStyle={{ color: "#d1d5db", fontSize: 12, paddingTop: 12 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: "#e5e7eb",
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
