import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLocale, t } from "@/lib/i18n/server";
import { AnnotatorDetailClient } from "@/components/admin/annotator-detail-client";

interface Props {
  params: Promise<{ userId: string }>;
}

export default async function AnnotatorDetailPage({ params }: Props) {
  const { userId } = await params;
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) notFound();

  const scores = await prisma.score.findMany({
    where: { userId },
    include: {
      dimension: { select: { code: true, nameZh: true, nameEn: true } },
      evaluationItem: {
        include: {
          videoAsset: {
            include: {
              prompt: { select: { id: true, externalId: true, textZh: true, textEn: true } },
              model: { select: { name: true, taskType: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const antiCheatEvents = await prisma.antiCheatEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      evaluationItem: {
        include: {
          videoAsset: {
            include: {
              prompt: { select: { id: true, externalId: true } },
            },
          },
        },
      },
    },
  });

  const allTagIds = [...new Set(scores.flatMap((s) => s.failureTags))];
  const tagRecords = allTagIds.length > 0
    ? await prisma.failureTag.findMany({
        where: { id: { in: allTagIds } },
        select: { id: true, labelZh: true, labelEn: true },
      })
    : [];
  const tagMap = new Map(tagRecords.map((t) => [t.id, t]));

  const totalScores = scores.length;
  const suspiciousCount = scores.filter((s) => s.validity === "SUSPICIOUS").length;
  const invalidCount = scores.filter((s) => s.validity === "INVALID").length;
  const suspiciousRate = totalScores > 0 ? suspiciousCount / totalScores : 0;

  const criticalEvents = antiCheatEvents.filter((e) => e.severity === "CRITICAL").length;
  const warningEvents = antiCheatEvents.filter((e) => e.severity === "WARNING").length;

  const integrityScore = Math.max(0, Math.round(
    100
    - suspiciousRate * 30
    - (invalidCount / Math.max(totalScores, 1)) * 50
    - criticalEvents * 10
    - warningEvents * 2
  ));

  const serializedScores = scores.map((s) => ({
    id: s.id,
    value: s.value,
    validity: s.validity,
    failureTagsZh: s.failureTags.map((id) => tagMap.get(id)?.labelZh ?? id),
    failureTagsEn: s.failureTags.map((id) => tagMap.get(id)?.labelEn ?? id),
    comment: s.comment,
    createdAt: s.createdAt.toISOString(),
    dimensionCode: s.dimension.code,
    dimensionNameZh: s.dimension.nameZh,
    dimensionNameEn: s.dimension.nameEn,
    videoExternalId: s.evaluationItem.videoAsset.prompt.externalId,
    promptZh: s.evaluationItem.videoAsset.prompt.textZh,
    promptEn: s.evaluationItem.videoAsset.prompt.textEn,
    modelName: s.evaluationItem.videoAsset.model.name,
    taskType: s.evaluationItem.videoAsset.model.taskType,
  }));

  const serializedEvents = antiCheatEvents
    .filter((e) => e.evaluationItem !== null)
    .map((e) => ({
      id: e.id,
      eventType: e.eventType,
      severity: e.severity,
      payload: e.payload as Record<string, unknown>,
      watchRatio: e.watchRatio,
      dwellTimeMs: e.dwellTimeMs,
      videoExternalId: e.evaluationItem!.videoAsset.prompt.externalId,
      createdAt: e.createdAt.toISOString(),
    }));

  const integrity = {
    score: integrityScore,
    totalScores,
    suspiciousCount,
    invalidCount,
    criticalEvents,
    warningEvents,
    riskLevel: user.riskLevel,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/annotators">
          <Button variant="ghost" size="sm">
            ← {t(locale, "admin.annotators.title")}
          </Button>
        </Link>
        <span className="text-lg font-semibold">{user.name}</span>
        <Badge variant={user.role !== "VENDOR_ANNOTATOR" ? "default" : "secondary"}>
          {user.role !== "VENDOR_ANNOTATOR"
            ? t(locale, "admin.annotators.internal")
            : t(locale, "admin.annotators.vendor")}
        </Badge>
        <span className="text-sm text-muted-foreground">{user.email}</span>
      </div>

      <AnnotatorDetailClient
        userName={user.name}
        scores={serializedScores}
        antiCheatEvents={serializedEvents}
        integrity={integrity}
      />
    </div>
  );
}
