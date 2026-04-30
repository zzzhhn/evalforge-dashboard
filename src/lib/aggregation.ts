import { prisma } from "@/lib/db";
import { invalidatePattern } from "@/lib/cache";

export interface AggregationResult {
  itemCount: number;
  dimensionCount: number;
  modelCount: number;
  aggregatedRows: number;
  calculatedAt: string;
}

/**
 * Calculate score aggregations and persist to AggregatedScore table.
 * Groups by (modelId, dimensionId) and upserts avg/count/stdDev for today's date.
 * Only uses VALID scores for trusted statistics.
 */
export async function calculateAggregations(): Promise<AggregationResult> {
  const validScores = await prisma.score.findMany({
    where: { validity: "VALID" },
    include: {
      dimension: { select: { id: true, code: true, parentId: true } },
      evaluationItem: {
        include: {
          videoAsset: {
            include: { model: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  // ─── Item-level aggregation (in-memory stats) ───
  const itemScores = new Map<string, number[]>();
  for (const s of validScores) {
    const key = s.evaluationItemId;
    const existing = itemScores.get(key);
    if (existing) {
      existing.push(s.value);
    } else {
      itemScores.set(key, [s.value]);
    }
  }

  // ─── Model × Dimension aggregation ───
  const modelDimGroups = new Map<string, { modelId: string; dimensionId: string; values: number[] }>();
  for (const s of validScores) {
    const modelId = s.evaluationItem.videoAsset.model.id;
    const dimensionId = s.dimension.id;
    const key = `${modelId}|${dimensionId}`;
    const existing = modelDimGroups.get(key);
    if (existing) {
      existing.values.push(s.value);
    } else {
      modelDimGroups.set(key, { modelId, dimensionId, values: [s.value] });
    }
  }

  // ─── Persist to AggregatedScore ───
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let aggregatedRows = 0;
  const groups = [...modelDimGroups.values()];

  // Batch upserts (50 at a time) to avoid connection pool exhaustion
  for (let i = 0; i < groups.length; i += 50) {
    const batch = groups.slice(i, i + 50);
    await Promise.all(
      batch.map((g) => {
        const n = g.values.length;
        const avg = g.values.reduce((a, b) => a + b, 0) / n;
        const stdDev = n > 1
          ? Math.sqrt(g.values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (n - 1))
          : 0;
        const rounded = {
          avgScore: Math.round(avg * 100) / 100,
          count: n,
          stdDev: Math.round(stdDev * 100) / 100,
        };

        return prisma.aggregatedScore.upsert({
          where: {
            date_modelId_dimensionId: {
              date: today,
              modelId: g.modelId,
              dimensionId: g.dimensionId,
            },
          },
          update: rounded,
          create: {
            date: today,
            modelId: g.modelId,
            dimensionId: g.dimensionId,
            ...rounded,
          },
        });
      })
    );
    aggregatedRows += batch.length;
  }

  // ─── Dimension-level stats (for logging) ───
  const dimCodes = new Set<string>();
  for (const s of validScores) {
    dimCodes.add(s.dimension.code);
  }

  // ─── Model-level stats (for logging) ───
  const modelNames = new Set<string>();
  for (const s of validScores) {
    modelNames.add(s.evaluationItem.videoAsset.model.name);
  }

  // Bust analytics cache so next page load sees fresh data
  const busted = await invalidatePattern("analytics:*");

  console.log(`[Aggregation] ${new Date().toISOString()}`);
  console.log(`  Items: ${itemScores.size}`);
  console.log(`  Dimensions: ${dimCodes.size}`);
  console.log(`  Models: ${modelNames.size}`);
  console.log(`  Aggregated rows upserted: ${aggregatedRows}`);
  console.log(`  Cache keys invalidated: ${busted}`);

  return {
    itemCount: itemScores.size,
    dimensionCount: dimCodes.size,
    modelCount: modelNames.size,
    aggregatedRows,
    calculatedAt: new Date().toISOString(),
  };
}
