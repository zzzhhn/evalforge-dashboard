import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AnalyticsCharts } from "@/components/admin/analytics-charts";
import { CalculateButton } from "@/components/admin/calculate-button";
import { getLocale, t } from "@/lib/i18n/server";

export default async function AnalyticsPage() {
  const session = await getSession();
  if (
    !session ||
    !["ADMIN", "RESEARCHER", "REVIEWER"].includes(session.role)
  ) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const scores = await prisma.score.findMany({
    where: { validity: "VALID" },
    include: {
      dimension: { select: { code: true, nameZh: true, nameEn: true } },
      evaluationItem: {
        include: {
          videoAsset: {
            include: { model: { select: { name: true } } },
          },
        },
      },
    },
  });

  const modelDimScores: Record<string, Record<string, number[]>> = {};
  for (const score of scores) {
    const modelName = score.evaluationItem.videoAsset.model.name;
    const dimCode = score.dimension.code;

    if (!modelDimScores[modelName]) modelDimScores[modelName] = {};
    if (!modelDimScores[modelName][dimCode]) modelDimScores[modelName][dimCode] = [];
    modelDimScores[modelName][dimCode].push(score.value);
  }

  const models = Object.keys(modelDimScores);
  const dimensions = await prisma.dimension.findMany({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: { code: true, nameZh: true, nameEn: true },
  });

  const chartData = dimensions.map((dim) => {
    const entry: Record<string, string | number> = {
      dimension: dim.code,
      name: locale === "zh" ? dim.nameZh : (dim.nameEn || dim.code),
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

  const modelOverall = models.map((model) => {
    const allValues = Object.values(modelDimScores[model]).flat();
    const avg =
      allValues.length > 0
        ? Math.round((allValues.reduce((a, b) => a + b, 0) / allValues.length) * 100) / 100
        : 0;
    return { model, avg, count: allValues.length };
  });

  const totalScores = scores.length;
  const totalItems = await prisma.evaluationItem.count({
    where: { status: "COMPLETED" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t(locale, "admin.analytics.title")}</h1>
        <CalculateButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t(locale, "admin.analytics.totalScores")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalScores}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t(locale, "admin.analytics.completedEvals")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t(locale, "admin.analytics.models")}
            </CardTitle>
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
        locale={locale}
      />
    </div>
  );
}
