"use client";

import MiniPieChart from "@/components/charts/MiniPieChart";

interface Slice {
  readonly name: string;
  readonly value: number;
}

export default function MiniPiePreview({
  data,
}: {
  readonly data: readonly Slice[];
}) {
  return <MiniPieChart data={data} />;
}
