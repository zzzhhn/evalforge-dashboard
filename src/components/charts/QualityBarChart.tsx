"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface QualityBarChartProps {
  readonly data: readonly {
    readonly dimension: string;
    readonly score: number;
  }[];
}

export default function QualityBarChart({ data }: QualityBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={[...data]}
        layout="vertical"
        margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fill: "#9ca3af", fontSize: 12 }}
          axisLine={{ stroke: "#374151" }}
        />
        <YAxis
          type="category"
          dataKey="dimension"
          tick={{ fill: "#9ca3af", fontSize: 12 }}
          axisLine={{ stroke: "#374151" }}
          width={100}
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
        <Bar dataKey="score" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
