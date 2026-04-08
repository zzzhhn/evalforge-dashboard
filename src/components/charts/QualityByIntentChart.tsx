"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface IntentQuality {
  readonly intent: string;
  readonly coverage: number;
  readonly relevance: number;
  readonly executability: number;
  readonly practicality: number;
}

interface QualityByIntentChartProps {
  readonly data: readonly IntentQuality[];
}

const DIMENSION_COLORS = {
  coverage: "#06b6d4",
  relevance: "#8b5cf6",
  executability: "#34d399",
  practicality: "#fbbf24",
} as const;

export default function QualityByIntentChart({
  data,
}: QualityByIntentChartProps) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={[...data]}
        margin={{ left: 10, right: 10, top: 10, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="intent"
          tick={{ fill: "#9ca3af", fontSize: 10 }}
          axisLine={{ stroke: "#374151" }}
          angle={-30}
          textAnchor="end"
          height={70}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#9ca3af", fontSize: 12 }}
          axisLine={{ stroke: "#374151" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: "#e5e7eb",
          }}
          formatter={(value) => `${Number(value).toFixed(1)}%`}
        />
        <Legend wrapperStyle={{ color: "#d1d5db", fontSize: 12 }} />
        {Object.entries(DIMENSION_COLORS).map(([key, color]) => (
          <Bar key={key} dataKey={key} fill={color} radius={[2, 2, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
