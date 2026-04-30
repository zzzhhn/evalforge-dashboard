import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getLocale, t } from "@/lib/i18n/server";
import { signAssetUrls, signOssUrl } from "@/lib/oss";
import { ViewerFeedClient } from "@/components/viewer/viewer-feed-client";
import { ViewerPackageScroller } from "@/components/viewer/viewer-package-scroller";

interface Props {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<{ pkg?: string }>;
}

export default async function ViewerSamplePage({ params, searchParams }: Props) {
  const { assetId } = await params;
  const { pkg: pkgHint } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "VIEWER" && session.role !== "ADMIN") {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const asset = await prisma.videoAsset.findUnique({
    where: { id: assetId },
    include: {
      model: true,
      prompt: true,
    },
  });
  if (!asset) notFound();

  // Determine scope package: query hint (faster), else the asset's own
  // packageId (can be null for orphaned assets).
  const scopePackageId = pkgHint ?? asset.packageId ?? null;
  if (!scopePackageId) notFound();

  // Authorize: VIEWER must have assignment for scope package; ADMIN sees all.
  if (session.role === "VIEWER") {
    const assignment = await prisma.viewerAssignment.findUnique({
      where: {
        viewerId_packageId: { viewerId: session.userId, packageId: scopePackageId },
      },
      select: { id: true },
    });
    if (!assignment) notFound();
  }

  const isI2V = asset.model.taskType === "I2V";
  const primaryPrompt = locale === "zh" ? asset.prompt.textZh : asset.prompt.textEn;
  const secondaryPrompt = locale === "zh" ? asset.prompt.textEn : asset.prompt.textZh;

  const signed = signAssetUrls(asset.url, isI2V ? asset.prompt.sourceImage : null);

  // Sibling navigation within scope package, ordered by prompt.externalId.
  const siblings = await prisma.videoAsset.findMany({
    where: { packageId: scopePackageId },
    orderBy: { prompt: { externalId: "asc" } },
    select: {
      id: true,
      url: true,
      prompt: { select: { id: true, externalId: true, textEn: true, textZh: true } },
      model: { select: { name: true, taskType: true } },
    },
  });
  const currentIndex = siblings.findIndex((s) => s.id === asset.id);
  if (currentIndex === -1) notFound();

  const prevId = currentIndex > 0 ? siblings[currentIndex - 1].id : null;
  const nextId =
    currentIndex < siblings.length - 1 ? siblings[currentIndex + 1].id : null;

  // Pre-sign neighbor video URLs so <link rel=preload> matches the next
  // navigation's <video src>, enabling browser to warm its HTTP cache.
  const prevSignedUrl =
    prevId != null ? signOssUrl(siblings[currentIndex - 1].url) : null;
  const nextSignedUrl =
    nextId != null ? signOssUrl(siblings[currentIndex + 1].url) : null;

  const packageMeta = await prisma.evaluationPackage.findUnique({
    where: { id: scopePackageId },
    select: { name: true, promptSuiteId: true },
  });

  // Build promptId → L1 dimension label so sidebar matches workstation.
  // Two sources, in priority order:
  //   1. EvaluationItem for this package (ground truth: actual task
  //      assignment records carry dimensionId directly). Covers ALL
  //      packages regardless of whether a PromptSuite is bound.
  //   2. PromptSuiteEntry (fallback for packages with assets but no
  //      items yet — typically viewer-only packages).
  // Note: `nameZh` already encodes the code prefix (e.g. "D1 指令…"),
  // so we use it verbatim to match the workstation sidebar exactly.
  const promptDimensionMap = new Map<string, string>();
  const dimSelect = {
    code: true,
    nameZh: true,
    nameEn: true,
    parent: {
      select: {
        code: true,
        nameZh: true,
        nameEn: true,
        parent: {
          select: { code: true, nameZh: true, nameEn: true },
        },
      },
    },
  } as const;
  const l1Name = (d: {
    nameZh: string;
    nameEn: string;
    parent: { nameZh: string; nameEn: string; parent: { nameZh: string; nameEn: string } | null } | null;
  }) => {
    const zh = d.parent?.parent?.nameZh ?? d.parent?.nameZh ?? d.nameZh;
    const en = d.parent?.parent?.nameEn ?? d.parent?.nameEn ?? d.nameEn;
    return locale === "zh" ? zh : en;
  };

  const itemsForMap = await prisma.evaluationItem.findMany({
    where: { packageId: scopePackageId },
    select: {
      videoAsset: { select: { promptId: true } },
      dimension: { select: dimSelect },
    },
  });
  for (const it of itemsForMap) {
    const pid = it.videoAsset.promptId;
    if (!promptDimensionMap.has(pid)) {
      promptDimensionMap.set(pid, l1Name(it.dimension));
    }
  }

  if (packageMeta?.promptSuiteId) {
    const entries = await prisma.promptSuiteEntry.findMany({
      where: { promptSuiteId: packageMeta.promptSuiteId },
      select: { promptId: true, dimension: { select: dimSelect } },
    });
    for (const e of entries) {
      if (!promptDimensionMap.has(e.promptId)) {
        promptDimensionMap.set(e.promptId, l1Name(e.dimension));
      }
    }
  }

  const videoList = siblings.map((s, idx) => {
    const text = locale === "zh" ? s.prompt.textZh : s.prompt.textEn;
    return {
      id: s.id,
      index: idx + 1,
      externalId: s.prompt.externalId,
      promptPreview: text.length > 60 ? text.slice(0, 60) + "…" : text,
      modelName: s.model.name,
      taskType: s.model.taskType,
      l1Label: promptDimensionMap.get(s.prompt.id) ?? "",
    };
  });

  // Build the topbar package picker list: every package this viewer can
  // access, ordered by createdAt so the latest (usually the active eval
  // batch) sits on the left.
  const accessiblePackages =
    session.role === "ADMIN"
      ? await prisma.evaluationPackage.findMany({
          where: { deletedAt: null, videoAssets: { some: {} } },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            taskType: true,
            _count: { select: { videoAssets: true } },
          },
        })
      : (
          await prisma.viewerAssignment.findMany({
            where: { viewerId: session.userId },
            orderBy: { assignedAt: "desc" },
            select: {
              package: {
                select: {
                  id: true,
                  name: true,
                  taskType: true,
                  deletedAt: true,
                  _count: { select: { videoAssets: true } },
                },
              },
            },
          })
        )
          .map((a) => a.package)
          .filter((p) => p.deletedAt === null && p._count.videoAssets > 0);

  const packageScrollerEntries = accessiblePackages.map((p) => ({
    id: p.id,
    name: p.name,
    taskType: p.taskType,
    videoCount: p._count.videoAssets,
  }));

  return (
    <div className="h-full overflow-y-auto">
      <ViewerPackageScroller
        packages={packageScrollerEntries}
        activePackageId={scopePackageId}
      />
      <div className="space-y-5 p-6 pb-12">
        {/* Back link */}
        <Link href="/viewer">
          <Button variant="ghost" size="sm">
            ← {t(locale, "viewer.back")}
          </Button>
        </Link>

        {/* Header: prompt + model + progress */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {packageMeta && (
              <span className="text-xs text-muted-foreground">
                {packageMeta.name}
              </span>
            )}
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {currentIndex + 1} / {siblings.length}
            </span>
          </div>
          <p className="text-lg font-medium">{primaryPrompt}</p>
          <p className="text-sm text-muted-foreground">{secondaryPrompt}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge variant="secondary">{asset.model.name}</Badge>
            <Badge
              variant="outline"
              className={
                asset.model.taskType === "T2V"
                  ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                  : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
              }
            >
              {asset.model.taskType}
            </Badge>
            {asset.durationSec && (
              <Badge variant="outline">{asset.durationSec}s</Badge>
            )}
            {asset.width && asset.height && (
              <Badge variant="outline">
                {asset.width}×{asset.height}
              </Badge>
            )}
          </div>
        </div>

        {/* Video + nav + source image (client component) */}
        <ViewerFeedClient
          assetId={asset.id}
          videoUrl={signed.videoUrl}
          sourceImage={signed.sourceImage}
          prevId={prevId}
          nextId={nextId}
          prevPreloadUrl={prevSignedUrl}
          nextPreloadUrl={nextSignedUrl}
          packageId={scopePackageId}
          videoList={videoList}
          currentIndex={currentIndex}
        />
      </div>
    </div>
  );
}
