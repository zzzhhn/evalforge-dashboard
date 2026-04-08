"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface Slice {
  readonly name: string;
  readonly value: number;
}

interface MiniPieChartProps {
  readonly data: readonly Slice[];
  readonly colors?: readonly string[];
}

const DEFAULT_COLORS = [
  "#8b5cf6",
  "#a78bfa",
  "#c4b5fd",
  "#7c3aed",
  "#6d28d9",
  "#5b21b6",
  "#ddd6fe",
];

export default function MiniPieChart({
  data,
  colors = DEFAULT_COLORS,
}: MiniPieChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie
          data={[...data]}
          cx="50%"
          cy="50%"
          innerRadius={30}
          outerRadius={55}
          dataKey="value"
          stroke="none"
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
