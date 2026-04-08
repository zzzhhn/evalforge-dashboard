"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  readonly metric: string;
  readonly value: number;
}

interface MiniRadarChartProps {
  readonly data: readonly DataPoint[];
  readonly color?: string;
}

export default function MiniRadarChart({
  data,
  color = "#06b6d4",
}: MiniRadarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <RadarChart data={[...data]} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="#374151" />
        <PolarAngleAxis dataKey="metric" tick={false} />
        <Radar
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.2}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
