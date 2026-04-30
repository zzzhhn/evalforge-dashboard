import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLocale, t } from "@/lib/i18n/server";
import { PackageDetailClient } from "@/components/admin/package-detail-client";

interface Props {
  params: Promise<{ packageId: string }>;
}

export default async function PackageDetailPage({ params }: Props) {
  const { packageId } = await params;
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  // EvaluationItem.packageId is the single source of truth for what
  // belongs to this package (Dataset-first architecture). We derive the
  // asset list from the items directly — this works for both the legacy
  // 1:1 VideoAsset.packageId FK and for Dataset-reused packages.
  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    include: {
      evaluationItems: {
        where: { packageId },
        select: {
          status: true,
          assignedToId: true,
          videoAssetId: true,
          videoAsset: {
            include: { model: true, prompt: true },
          },
        },
      },
    },
  });

  if (!pkg || pkg.deletedAt) notFound();

  type AssetRow = (typeof pkg.evaluationItems)[number]["videoAsset"];
  const assetMap = new Map<string, AssetRow>();
  for (const item of pkg.evaluationItems) {
    if (!assetMap.has(item.videoAssetId)) {
      assetMap.set(item.videoAssetId, item.videoAsset);
    }
  }
  const allAssets = [...assetMap.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const itemsForPackage = pkg.evaluationItems;

  const annotatorMap = new Map<string, {
    assigned: number;
    completed: number;
    expired: number;
  }>();
  for (const item of itemsForPackage) {
    const uid = item.assignedToId;
    const entry = annotatorMap.get(uid) ?? { assigned: 0, completed: 0, expired: 0 };
    entry.assigned += 1;
    if (item.status === "COMPLETED") entry.completed += 1;
    if (item.status === "EXPIRED") entry.expired += 1;
    annotatorMap.set(uid, entry);
  }

  const annotatorIds = [...annotatorMap.keys()];

  // Fetch user names and score aggregates in parallel
  const [users, scoreAggs, suspiciousStats] = await Promise.all([
    annotatorIds.length > 0
      ? prisma.user.findMany({
          where: { id: { in: annotatorIds } },
          select: {
            id: true,
            name: true,
            accountType: true,
            riskLevel: true,
            groupMemberships: {
              select: {
                isAdmin: true,
                group: { select: { name: true } },
              },
            },
            capabilityAssessments: {
              orderBy: { assessmentDate: "desc" },
              take: 1,
              select: {
                accuracy: true,
                consistency: true,
                coverage: true,
                detailOriented: true,
                speed: true,
                compositeScore: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    annotatorIds.length > 0
      ? prisma.score.groupBy({
          by: ["userId"],
          where: {
            // Prefer explicit packageId on the item; fall back to legacy
            // videoAsset.packageId for rows written before the migration.
            evaluationItem: {
              packageId,
            },
            userId: { in: annotatorIds },
          },
          _avg: { value: true },
          _count: { value: true },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    annotatorIds.length > 0
      ? prisma.score.groupBy({
          by: ["userId"],
          where: {
            evaluationItem: {
              packageId,
            },
            userId: { in: annotatorIds },
            validity: "SUSPICIOUS",
          },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const aggMap = new Map(scoreAggs.map((a) => [a.userId, a]));
  const suspiciousMap = new Map(
    suspiciousStats.map((s) => [s.userId, s._count._all]),
  );

  // Also fetch emails for the credential display
  const userEmails = await prisma.user.findMany({
    where: { id: { in: annotatorIds } },
    select: { id: true, email: true },
  });
  const emailMap = new Map(userEmails.map((u) => [u.id, u.email]));

  const annotatorStats = annotatorIds.map((uid) => {
    const user = userMap.get(uid);
    const counts = annotatorMap.get(uid)!;
    const agg = aggMap.get(uid);
    const primaryMembership = user?.groupMemberships[0];
    return {
      userId: uid,
      name: user?.name ?? uid,
      email: emailMap.get(uid) ?? "",
      accountType: user?.accountType ?? "INTERNAL",
      assigned: counts.assigned,
      completed: counts.completed,
      scoreCount: agg?._count?.value ?? 0,
      avgScore: agg?._avg?.value ?? null,
      lastSubmittedAt: agg?._max?.createdAt?.toISOString() ?? null,
      isSuspended: counts.expired > 0 && counts.completed < counts.assigned,
      riskLevel: user?.riskLevel ?? "LOW_RISK",
      groupName: primaryMembership?.group.name ?? null,
      isGroupAdmin: user?.groupMemberships.some((m) => m.isAdmin) ?? false,
      suspiciousCount: suspiciousMap.get(uid) ?? 0,
      capability: user?.capabilityAssessments[0] ?? null,
    };
  });

  // Group items per VA for progress counts.
  const itemsByVa = new Map<string, { completed: number; total: number }>();
  for (const item of itemsForPackage) {
    const slot = itemsByVa.get(item.videoAssetId) ?? { completed: 0, total: 0 };
    slot.total += 1;
    if (item.status === "COMPLETED") slot.completed += 1;
    itemsByVa.set(item.videoAssetId, slot);
  }

  const assets = allAssets.map((va) => {
    const slot = itemsByVa.get(va.id) ?? { completed: 0, total: 0 };
    return {
      id: va.id,
      promptZh: va.prompt.textZh,
      promptEn: va.prompt.textEn,
      externalId: va.prompt.externalId,
      modelName: va.model.name,
      taskType: va.model.taskType,
      durationSec: va.durationSec,
      completedItems: slot.completed,
      totalItems: slot.total,
    };
  });

  return (
    <div className="h-full space-y-6 overflow-y-auto">
      <div className="flex items-center gap-3">
        <Link href="/admin/samples">
          <Button variant="ghost" size="sm">
            ← {t(locale, "admin.samples.title")}
          </Button>
        </Link>
        <Badge
          variant="outline"
          className={
            pkg.taskType === "T2V"
              ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
              : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
          }
        >
          {pkg.taskType}
        </Badge>
        <span className="text-lg font-semibold">{pkg.name}</span>
      </div>

      <PackageDetailClient
        packageId={packageId}
        packageName={pkg.name}
        deadline={pkg.deadline?.toISOString() ?? null}
        assets={assets}
        annotatorStats={annotatorStats}
      />
    </div>
  );
}
