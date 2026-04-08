"use client";

import MiniRadarChart from "@/components/charts/MiniRadarChart";

interface DataPoint {
  readonly metric: string;
  readonly value: number;
}

export default function MiniRadarPreview({
  data,
}: {
  readonly data: readonly DataPoint[];
}) {
  return <MiniRadarChart data={data} color="#22d3ee" />;
}
