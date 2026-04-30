import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { AnnotatorDetailClient } from "@/components/admin/annotator-detail-client";
import { AnnotatorBoldHero } from "@/components/admin/annotator-bold-hero";
import { AnnotatorPersonalInfoEditor } from "@/components/admin/annotator-personal-info-editor";
import { BackLinkRefresh } from "@/components/admin/back-link-refresh";
import { PackageFilter } from "@/components/admin/package-filter";
import { calculateIntegrity } from "@/lib/integrity";
import { getAdminScope, canManageUser } from "@/lib/admin-scope";

interface Props {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

function parsePageParams(raw: Record<string, string | string[] | undefined>) {
  const page = Math.max(1, Number(String(raw.page ?? "1")) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(String(raw.limit ?? DEFAULT_LIMIT)) || DEFAULT_LIMIT));
  const tab = String(raw.tab ?? "scores") === "events" ? "events" as const : "scores" as const;
  return { page, limit, tab };
}

export default async function AnnotatorDetailPage({ params, searchParams }: Props) {
  const { userId } = await params;
  const rawParams = await searchParams;
  const { page, limit, tab } = parsePageParams(rawParams);
  const selectedPkgId = rawParams.pkg ? String(rawParams.pkg) : undefined;
  const fromTabRaw = rawParams.from ? String(rawParams.from) : undefined;
  const fromTab =
    fromTabRaw === "people" || fromTabRaw === "groups" || fromTabRaw === "calibration"
      ? fromTabRaw
      : "assignment";

  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") redirect("/tasks");
  // Group Admins can only view their own group members' profiles.
  if (!(await canManageUser(scope, userId))) redirect("/admin/annotators");
  const locale = await getLocale();

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) notFound();

  // Published packages for filter
  const publishedPackages = await prisma.evaluationPackage.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, status: true },
  });

  // Package scope conditions — EvaluationItem.packageId is authoritative.
  // videoAsset.packageId is a legacy 1:1 FK that breaks for Dataset reuse.
  const scorePackageWhere = selectedPkgId
    ? { evaluationItem: { packageId: selectedPkgId } }
    : {};
  const eventPackageWhere = selectedPkgId
    ? { evaluationItem: { packageId: selectedPkgId } }
    : {};

  // Integrity counts — scoped by package
  const [totalScores, suspiciousCount, invalidCount, totalEvents, criticalEvents, warningEvents] =
    await Promise.all([
      prisma.score.count({ where: { userId, ...scorePackageWhere } }),
      prisma.score.count({ where: { userId, validity: "SUSPICIOUS", ...scorePackageWhere } }),
      prisma.score.count({ where: { userId, validity: "INVALID", ...scorePackageWhere } }),
      prisma.antiCheatEvent.count({ where: { userId, ...eventPackageWhere } }),
      prisma.antiCheatEvent.count({ where: { userId, severity: "CRITICAL", ...eventPackageWhere } }),
      prisma.antiCheatEvent.count({ where: { userId, severity: "WARNING", ...eventPackageWhere } }),
    ]);

  const integrityResult = calculateIntegrity({
    totalScores,
    suspiciousCount,
    invalidCount,
    criticalEvents,
    warningEvents,
  });

  // Bold hero metrics
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const trendStart = new Date(todayStart.getTime() - 13 * MS_PER_DAY);
  const sevenDaysAgo = new Date(todayStart.getTime() - 6 * MS_PER_DAY);

  const [itemAgg, scoreStats, scoreDist, dailyRows, recentCritical] = await Promise.all([
    prisma.evaluationItem.groupBy({
      by: ["status"],
      where: {
        assignedToId: userId,
        ...(selectedPkgId ? { packageId: selectedPkgId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.score.aggregate({
      where: { userId, validity: "VALID", ...scorePackageWhere },
      _avg: { value: true },
      _count: { _all: true },
    }),
    prisma.score.groupBy({
      by: ["value"],
      where: { userId, validity: "VALID", ...scorePackageWhere },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT DATE_TRUNC('day', completed_at) AS day, COUNT(*)::bigint AS count
      FROM evaluation_items
      WHERE assigned_to_id = ${userId}
        AND status = 'COMPLETED'
        AND completed_at >= ${trendStart}
      GROUP BY DATE_TRUNC('day', completed_at)
    `,
    prisma.antiCheatEvent.count({
      where: {
        userId,
        severity: "CRITICAL",
        createdAt: { gte: sevenDaysAgo },
        ...eventPackageWhere,
      },
    }),
  ]);

  const completedCount =
    itemAgg.find((r) => r.status === "COMPLETED")?._count._all ?? 0;
  const totalCount = itemAgg.reduce((acc, r) => acc + r._count._all, 0);
  const avgScore = scoreStats._avg.value ?? null;

  // Stddev (population) from distribution
  const distBuckets = [0, 0, 0, 0, 0] as number[];
  let sumSq = 0;
  let sumN = 0;
  for (const row of scoreDist) {
    const v = row.value;
    const n = row._count._all;
    if (v >= 1 && v <= 5) distBuckets[v - 1] = n;
    sumN += n;
    if (avgScore != null) sumSq += n * (v - avgScore) ** 2;
  }
  const stddev = sumN > 0 && avgScore != null ? Math.sqrt(sumSq / sumN) : null;

  const trend14: number[] = Array(14).fill(0);
  for (const row of dailyRows) {
    const d = new Date(row.day);
    d.setHours(0, 0, 0, 0);
    const idx = Math.round((d.getTime() - trendStart.getTime()) / MS_PER_DAY);
    if (idx >= 0 && idx < 14) trend14[idx] = Number(row.count);
  }

  // Paginated scores — scoped by package
  const skip = (page - 1) * limit;
  const scores = await prisma.score.findMany({
    where: { userId, ...scorePackageWhere },
    include: {
      dimension: {
        select: {
          code: true, nameZh: true, nameEn: true,
          parent: {
            select: {
              code: true, nameZh: true, nameEn: true,
              parent: { select: { code: true, nameZh: true, nameEn: true } },
            },
          },
        },
      },
      evaluationItem: {
        include: {
          videoAsset: {
            include: {
              prompt: { select: { externalId: true, textZh: true, textEn: true } },
              model: { select: { name: true, taskType: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: tab === "scores" ? skip : 0,
    take: tab === "scores" ? limit : 0,
  });

  // Paginated events — scoped by package
  const events = await prisma.antiCheatEvent.findMany({
    where: { userId, ...eventPackageWhere },
    orderBy: { createdAt: "desc" },
    skip: tab === "events" ? skip : 0,
    take: tab === "events" ? limit : 0,
    include: {
      evaluationItem: {
        include: {
          videoAsset: {
            include: {
              prompt: { select: { externalId: true } },
            },
          },
        },
      },
    },
  });

  // Build failure tag lookup for current page's scores
  const allTagIds = [...new Set(scores.flatMap((s) => s.failureTags))];
  const tagRecords = allTagIds.length > 0
    ? await prisma.failureTag.findMany({
        where: { id: { in: allTagIds } },
        select: { id: true, labelZh: true, labelEn: true },
      })
    : [];
  const tagMap = new Map(tagRecords.map((t) => [t.id, t]));

  const serializedScores = scores.map((s) => {
    const l3 = s.dimension;
    const l2 = l3.parent;
    const l1 = l2?.parent;
    return {
      id: s.id,
      value: s.value,
      validity: s.validity,
      failureTagsZh: s.failureTags.map((id) => tagMap.get(id)?.labelZh ?? id),
      failureTagsEn: s.failureTags.map((id) => tagMap.get(id)?.labelEn ?? id),
      comment: s.comment,
      createdAt: s.createdAt.toISOString(),
      dimensionCode: l3.code,
      dimensionNameZh: l3.nameZh,
      dimensionNameEn: l3.nameEn,
      l1Code: l1?.code ?? l2?.code ?? l3.code,
      l1NameZh: l1?.nameZh ?? l2?.nameZh ?? l3.nameZh,
      l1NameEn: l1?.nameEn ?? l2?.nameEn ?? l3.nameEn,
      l2Code: l1 ? (l2?.code ?? null) : null,
      l2NameZh: l1 ? (l2?.nameZh ?? null) : null,
      l2NameEn: l1 ? (l2?.nameEn ?? null) : null,
      l3Code: l3.code,
      l3NameZh: l3.nameZh,
      l3NameEn: l3.nameEn,
      videoExternalId: s.evaluationItem.videoAsset.prompt.externalId,
      promptZh: s.evaluationItem.videoAsset.prompt.textZh,
      promptEn: s.evaluationItem.videoAsset.prompt.textEn,
      modelName: s.evaluationItem.videoAsset.model.name,
      taskType: s.evaluationItem.videoAsset.model.taskType,
    };
  });

  const serializedEvents = events.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    severity: e.severity,
    payload: e.payload as Record<string, unknown>,
    watchRatio: e.watchRatio,
    dwellTimeMs: e.dwellTimeMs,
    videoExternalId: e.evaluationItem?.videoAsset.prompt.externalId ?? null,
    createdAt: e.createdAt.toISOString(),
  }));

  const activeTotal = tab === "scores" ? totalScores : totalEvents;
  const totalPages = Math.max(1, Math.ceil(activeTotal / limit));

  const pagination = {
    page: Math.min(page, totalPages),
    limit,
    total: activeTotal,
    totalPages,
    totalScores,
    totalEvents,
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto pr-1 pb-8">
      <div>
        <BackLinkRefresh
          href={`/admin/annotators?tab=${fromTab}${selectedPkgId ? `&pkg=${selectedPkgId}` : ""}`}
          label={t(locale, "admin.annotators.title")}
        />
      </div>

      <AnnotatorBoldHero
        name={user.name}
        email={user.email}
        accountType={user.accountType}
        riskLevel={user.riskLevel}
        createdAt={user.createdAt.toISOString()}
        integrityScore={integrityResult.score}
        completed={completedCount}
        total={totalCount}
        avgScore={avgScore}
        stddev={stddev}
        totalScores={totalScores}
        suspiciousCount={suspiciousCount}
        criticalLast7Days={recentCritical}
        distribution={distBuckets}
        trend14={trend14}
      />

      <AnnotatorPersonalInfoEditor
        userId={user.id}
        gender={user.gender}
        ageRange={user.ageRange}
        city={user.city}
        education={user.education}
      />

      <PackageFilter packages={publishedPackages} selectedPkgId={selectedPkgId ?? null} />

      <AnnotatorDetailClient
        userId={userId}
        userName={user.name}
        scores={serializedScores}
        antiCheatEvents={serializedEvents}
        pagination={pagination}
        activeTab={tab}
      />
    </div>
  );
}
