import { prisma } from "@/lib/db";

export interface AggregationResult {
  itemCount: number;
  dimensionCount: number;
  modelCount: number;
  calculatedAt: string;
}

/**
 * Calculate score aggregations: item-level, dimension-level, and model-level.
 * Only uses VALID scores for trusted statistics.
 * Results are logged and can be extended to write to aggregate tables.
 */
export async function calculateAggregations(): Promise<AggregationResult> {
  const validScores = await prisma.score.findMany({
    where: { validity: "VALID" },
    include: {
      dimension: { select: { code: true, parentId: true } },
      evaluationItem: {
        include: {
          videoAsset: {
            include: { model: { select: { name: true } } },
          },
        },
      },
    },
  });

  // ─── Item-level aggregation ───
  const itemScores = new Map<string, number[]>();
  for (const s of validScores) {
    const key = s.evaluationItemId;
    if (!itemScores.has(key)) itemScores.set(key, []);
    itemScores.get(key)!.push(s.value);
  }

  const itemAggregates = [...itemScores.entries()].map(([itemId, values]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return { itemId, mean, stddev: Math.sqrt(variance), count: values.length };
  });

  // ─── Dimension-level aggregation ───
  const dimScores = new Map<string, number[]>();
  for (const s of validScores) {
    const code = s.dimension.code;
    if (!dimScores.has(code)) dimScores.set(code, []);
    dimScores.get(code)!.push(s.value);
  }

  const dimensionAggregates = [...dimScores.entries()].map(([code, values]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { code, mean: Math.round(mean * 100) / 100, count: values.length };
  });

  // ─── Model-level aggregation ───
  const modelScores = new Map<string, Map<string, number[]>>();
  for (const s of validScores) {
    const model = s.evaluationItem.videoAsset.model.name;
    if (!modelScores.has(model)) modelScores.set(model, new Map());
    const dimMap = modelScores.get(model)!;
    const code = s.dimension.code;
    if (!dimMap.has(code)) dimMap.set(code, []);
    dimMap.get(code)!.push(s.value);
  }

  const modelAggregates = [...modelScores.entries()].map(([model, dimMap]) => {
    const allValues = [...dimMap.values()].flat();
    const overall = allValues.reduce((a, b) => a + b, 0) / allValues.length;
    const dimMeans = [...dimMap.entries()].map(([code, vals]) => ({
      code,
      mean: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100,
    }));
    return {
      model,
      overall: Math.round(overall * 100) / 100,
      dimensions: dimMeans,
      totalScores: allValues.length,
    };
  });

  console.log(`[Aggregation] ${new Date().toISOString()}`);
  console.log(`  Items: ${itemAggregates.length}`);
  console.log(`  Dimensions: ${dimensionAggregates.length}`);
  console.log(`  Models: ${modelAggregates.map((m) => `${m.model}=${m.overall}`).join(", ")}`);

  return {
    itemCount: itemAggregates.length,
    dimensionCount: dimensionAggregates.length,
    modelCount: modelAggregates.length,
    calculatedAt: new Date().toISOString(),
  };
}
