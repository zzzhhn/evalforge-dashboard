import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalyticsCharts } from "@/components/admin/analytics-charts";

export default async function AnalyticsPage() {
  const session = await getSession();
  if (
    !session ||
    !["ADMIN", "RESEARCHER", "REVIEWER"].includes(session.role)
  ) {
    redirect("/tasks");
  }

  // Aggregate scores by model × dimension
  const scores = await prisma.score.findMany({
    where: { validity: "VALID" },
    include: {
      dimension: { select: { code: true, nameZh: true } },
      evaluationItem: {
        include: {
          videoAsset: {
            include: { model: { select: { name: true } } },
          },
        },
      },
    },
  });

  // Build model → dimension → values map
  const modelDimScores: Record<string, Record<string, number[]>> = {};
  for (const score of scores) {
    const modelName = score.evaluationItem.videoAsset.model.name;
    const dimCode = score.dimension.code;

    if (!modelDimScores[modelName]) modelDimScores[modelName] = {};
    if (!modelDimScores[modelName][dimCode]) modelDimScores[modelName][dimCode] = [];
    modelDimScores[modelName][dimCode].push(score.value);
  }

  // Compute averages
  const models = Object.keys(modelDimScores);
  const dimensions = await prisma.dimension.findMany({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: { code: true, nameZh: true },
  });

  const chartData = dimensions.map((dim) => {
    const entry: Record<string, string | number> = {
      dimension: dim.code,
      name: dim.nameZh,
    };
    for (const model of models) {
      const values = modelDimScores[model]?.[dim.code] ?? [];
      entry[model] =
        values.length > 0
          ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
          : 0;
    }
    return entry;
  });

  // Overall model averages
  const modelOverall = models.map((model) => {
    const allValues = Object.values(modelDimScores[model]).flat();
    const avg =
      allValues.length > 0
        ? Math.round((allValues.reduce((a, b) => a + b, 0) / allValues.length) * 100) / 100
        : 0;
    return { model, avg, count: allValues.length };
  });

  // Summary stats
  const totalScores = scores.length;
  const totalItems = await prisma.evaluationItem.count({
    where: { status: "COMPLETED" },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">数据分析</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">总评分数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalScores}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">已完成评测</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">参与模型</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{models.length}</div>
          </CardContent>
        </Card>
      </div>

      <AnalyticsCharts
        chartData={chartData}
        modelOverall={modelOverall}
        models={models}
      />
    </div>
  );
}
