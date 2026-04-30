import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AnalyticsDashboard } from "@/components/admin/analytics-dashboard";
import { CalculateButton } from "@/components/admin/calculate-button";
import { PackageFilter } from "@/components/admin/package-filter";
import { getLocale, t } from "@/lib/i18n/server";

// ── Types for the analytics data ──

interface DimNode {
  code: string;
  nameZh: string;
  nameEn: string;
  children: DimNode[];
}

interface ScoreEntry {
  modelName: string;
  dimCode: string;
  value: number;
}

interface Props {
  searchParams: Promise<{ pkg?: string }>;
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session || !["ADMIN", "RESEARCHER", "REVIEWER"].includes(session.role)) {
    redirect("/tasks");
  }
  const locale = await getLocale();
  const { pkg: selectedPkgId } = await searchParams;

  // Load packages for filter
  const packages = await prisma.evaluationPackage.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true },
  });

  // 1. Load full dimension tree
  const allDims = await prisma.dimension.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, nameZh: true, nameEn: true, parentId: true },
  });

  const dimById = new Map(allDims.map((d) => [d.id, d]));
  const childrenMap = new Map<string | null, typeof allDims>();
  for (const d of allDims) {
    const key = d.parentId;
    if (!childrenMap.has(key)) childrenMap.set(key, []);
    childrenMap.get(key)!.push(d);
  }

  function buildTree(parentId: string | null): DimNode[] {
    const kids = childrenMap.get(parentId) ?? [];
    return kids.map((d) => ({
      code: d.code,
      nameZh: d.nameZh,
      nameEn: d.nameEn,
      children: buildTree(d.id),
    }));
  }

  const dimensionTree = buildTree(null);

  // 2. Load valid scores, optionally scoped to a package.
  // EvaluationItem.packageId is authoritative for Dataset-first architecture.
  const packageWhere = selectedPkgId
    ? { evaluationItem: { packageId: selectedPkgId } }
    : {};

  const scores = await prisma.score.findMany({
    where: { validity: "VALID", ...packageWhere },
    select: {
      value: true,
      dimension: { select: { id: true, code: true } },
      evaluationItem: {
        select: {
          videoAsset: {
            select: { model: { select: { name: true } } },
          },
        },
      },
    },
  });

  // Build code->ancestors mapping for roll-up
  function getAncestorCodes(dimId: string): string[] {
    const codes: string[] = [];
    const seen = new Set<string>();
    let current = dimById.get(dimId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      codes.push(current.code);
      current = current.parentId ? dimById.get(current.parentId) : undefined;
    }
    return codes;
  }

  // Build score entries: each raw score contributes to its own dim AND all ancestors
  const scoreEntries: ScoreEntry[] = [];
  const models = new Set<string>();

  for (const s of scores) {
    const modelName = s.evaluationItem.videoAsset.model.name;
    models.add(modelName);
    const ancestorCodes = getAncestorCodes(s.dimension.id);
    for (const code of ancestorCodes) {
      scoreEntries.push({ modelName, dimCode: code, value: s.value });
    }
  }

  // 3. Aggregate: dimCode -> modelName -> { sum, count, values }
  const aggMap = new Map<string, Map<string, { sum: number; count: number; values: number[] }>>();
  for (const e of scoreEntries) {
    if (!aggMap.has(e.dimCode)) aggMap.set(e.dimCode, new Map());
    const modelMap = aggMap.get(e.dimCode)!;
    if (!modelMap.has(e.modelName)) modelMap.set(e.modelName, { sum: 0, count: 0, values: [] });
    const bucket = modelMap.get(e.modelName)!;
    bucket.sum += e.value;
    bucket.count += 1;
    bucket.values.push(e.value);
  }

  // Serialize to JSON-safe structure
  type AggData = Record<string, Record<string, { avg: number; count: number; sd: number; dist: number[] }>>;
  const aggregated: AggData = {};

  for (const [dimCode, modelMap] of aggMap) {
    aggregated[dimCode] = {};
    for (const [modelName, bucket] of modelMap) {
      const avg = bucket.sum / bucket.count;
      const variance = bucket.count > 1
        ? bucket.values.reduce((s, v) => s + (v - avg) ** 2, 0) / (bucket.count - 1)
        : 0;
      // Score distribution [count_of_1, count_of_2, ..., count_of_5]
      const dist = [0, 0, 0, 0, 0];
      for (const v of bucket.values) {
        if (v >= 1 && v <= 5) dist[v - 1]++;
      }
      aggregated[dimCode][modelName] = {
        avg: Math.round(avg * 100) / 100,
        count: bucket.count,
        sd: Math.round(Math.sqrt(variance) * 100) / 100,
        dist,
      };
    }
  }

  // 4. Summary stats
  const modelList = [...models].sort();
  const totalScores = scores.length;
  const totalCompleted = await prisma.evaluationItem.count({
    where: {
      status: "COMPLETED",
      ...(selectedPkgId ? { packageId: selectedPkgId } : {}),
    },
  });

  return (
    <div className="h-full space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t(locale, "admin.analytics.title")}</h1>
        <CalculateButton />
      </div>

      <PackageFilter packages={packages} selectedPkgId={selectedPkgId ?? null} />

      <AnalyticsDashboard
        dimensionTree={dimensionTree}
        aggregated={aggregated}
        models={modelList}
        totalScores={totalScores}
        totalCompleted={totalCompleted}
      />
    </div>
  );
}
