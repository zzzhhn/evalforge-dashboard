"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import type { PieLabelRenderProps } from "recharts";

interface IntentSlice {
  readonly name: string;
  readonly count: number;
  readonly percentage: number;
}

interface IntentPieChartProps {
  readonly data: readonly IntentSlice[];
}

const COLORS = [
  "#8b5cf6",
  "#a78bfa",
  "#06b6d4",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#c084fc",
];

export default function IntentPieChart({ data }: IntentPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <PieChart>
        <Pie
          data={[...data]}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={110}
          dataKey="percentage"
          nameKey="name"
          stroke="none"
          label={(props: PieLabelRenderProps) => {
            const name = typeof props.name === "string" ? props.name : "";
            // Recharts passes `percent` as 0-1; `percentage` is our data field
            const pct = typeof props.percent === "number" ? props.percent * 100 : 0;
            return `${name} ${pct.toFixed(1)}%`;
          }}
        >
          {data.map((_, i) => (
            <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: "#e5e7eb",
          }}
          formatter={(value) => `${Number(value).toFixed(1)}%`}
        />
        <Legend
          wrapperStyle={{ color: "#d1d5db", fontSize: 12, paddingTop: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
