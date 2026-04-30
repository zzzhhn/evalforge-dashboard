"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { signAssetUrls } from "@/lib/oss";
import { loadAntiCheatConfig } from "@/lib/anti-cheat-config";

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export interface ClientItemData {
  item: {
    id: string;
    status: string;
    externalId: string;
    videoUrl: string;
    videoDuration: number | null;
    promptZh: string;
    promptEn: string;
    modelName: string;
    taskType: string;
    sourceImage: string | null;
    modelMeta: string;
  };
  dimension: {
    id: string;
    code: string;
    nameZh: string;
    nameEn: string;
    anchor: string | null;
    parentNameZh: string | null;
    parentNameEn: string | null;
    parentCode: string | null;
    failureTags: { id: string; labelZh: string; labelEn: string }[];
  };
  dimensionHierarchy: {
    l1Label: string;
    l2Label: string | null;
    l3Label: string;
  };
  progress: { current: number; total: number; completed: number };
  existingScore: { value: number; failureTags: string[]; comment: string } | null;
  serverWatchProgress: number[] | null;
  itemVersion: number;
  antiCheatMinWatchRatio: number;
}

/**
 * Fetch a single item's data for SPA-style client navigation.
 * Returns null if unauthorized or not found.
 */
export async function fetchWorkstationItem(
  itemId: string,
  packageId?: string | null
): Promise<ClientItemData | null> {
  const session = await getSession();
  if (!session) return null;

  const item = await prisma.evaluationItem.findUnique({
    where: { id: itemId },
    include: {
      videoAsset: {
        include: { prompt: true, model: true },
      },
      dimension: {
        include: {
          parent: { include: { parent: true } },
          failureTags: true,
        },
      },
    },
  });

  if (!item || item.assignedToId !== session.userId) return null;

  // ─── Parallel reads ─────────────────────────────────
  // Everything below is independent of everything else once we have
  // `item`, so do it concurrently. Cuts navigation latency from ~4
  // serial roundtrips to 1 (the slowest one). loadAntiCheatConfig
  // is now memoised module-side so it's typically a no-op.
  const scopePackageId = packageId ?? item.packageId ?? null;
  const [pkgStatus, allItemStatuses, existingScore, acConfig] = await Promise.all([
    item.packageId
      ? prisma.evaluationPackage.findUnique({
          where: { id: item.packageId },
          select: { status: true, deletedAt: true },
        })
      : prisma.evaluationPackage.findFirst({
          where: { videoAssets: { some: { id: item.videoAssetId } } },
          select: { status: true, deletedAt: true },
        }),
    prisma.evaluationItem.findMany({
      where: {
        assignedToId: session.userId,
        package: { status: "PUBLISHED", deletedAt: null },
        ...(scopePackageId ? { packageId: scopePackageId } : {}),
      },
      select: { id: true, status: true },
      orderBy: [
        { videoAsset: { prompt: { externalId: "asc" } } },
        { id: "asc" },
      ],
    }),
    prisma.score.findUnique({
      where: {
        evaluationItemId_dimensionId_userId: {
          evaluationItemId: item.id,
          dimensionId: item.dimension.id,
          userId: session.userId,
        },
      },
      select: { value: true, failureTags: true, comment: true },
    }),
    loadAntiCheatConfig(),
  ]);
  if (pkgStatus && (pkgStatus.status !== "PUBLISHED" || pkgStatus.deletedAt)) return null;

  const totalItems = allItemStatuses.length;
  const completedItems = allItemStatuses.filter((i) => i.status === "COMPLETED").length;
  const currentIndex = allItemStatuses.findIndex((i) => i.id === itemId);

  // Sign URLs
  const isI2V = item.videoAsset.model.taskType === "I2V";
  const rawSourceImage = isI2V ? item.videoAsset.prompt.sourceImage : null;
  const signed = signAssetUrls(item.videoAsset.url, rawSourceImage);

  // Model meta
  const va = item.videoAsset;
  const durationStr = va.durationSec ? `${va.durationSec}s` : null;
  const resStr = va.width && va.height ? `${va.height}p` : null;
  const aspectStr =
    va.width && va.height
      ? (() => {
          const g = gcd(va.width, va.height);
          return `${va.width / g}:${va.height / g}`;
        })()
      : null;
  const fpsStr = va.fps ? `${va.fps}fps` : null;
  const modelMeta = [durationStr, resStr, aspectStr, fpsStr].filter(Boolean).join(" · ");

  // Dimension hierarchy
  const dim = item.dimension;
  const dimL2 = dim.parent;
  const dimL1 = dim.parent?.parent ?? dim.parent;

  return {
    item: {
      id: item.id,
      status: item.status,
      externalId: item.videoAsset.prompt.externalId,
      videoUrl: signed.videoUrl,
      videoDuration: item.videoAsset.durationSec,
      promptZh: item.videoAsset.prompt.textZh,
      promptEn: item.videoAsset.prompt.textEn,
      modelName: item.videoAsset.model.name,
      taskType: item.videoAsset.model.taskType,
      sourceImage: signed.sourceImage,
      modelMeta,
    },
    dimension: {
      id: item.dimension.id,
      code: item.dimension.code,
      nameZh: item.dimension.nameZh,
      nameEn: item.dimension.nameEn,
      anchor: item.dimension.anchor,
      parentNameZh: item.dimension.parent?.nameZh ?? null,
      parentNameEn: item.dimension.parent?.nameEn ?? null,
      parentCode: item.dimension.parent?.code ?? null,
      failureTags: item.dimension.failureTags.map((t) => ({
        id: t.id,
        labelZh: t.labelZh,
        labelEn: t.labelEn,
      })),
    },
    dimensionHierarchy: {
      l1Label: dimL1?.nameZh ?? dim.nameZh,
      l2Label: dim.anchor ?? null,
      l3Label: dim.nameZh,
    },
    progress: {
      current: currentIndex + 1,
      total: totalItems,
      completed: completedItems,
    },
    existingScore: existingScore
      ? { value: existingScore.value, failureTags: existingScore.failureTags, comment: existingScore.comment ?? "" }
      : null,
    serverWatchProgress: item.watchProgress as number[] | null,
    itemVersion: item.version,
    antiCheatMinWatchRatio: acConfig.minWatchRatio,
  };
}
