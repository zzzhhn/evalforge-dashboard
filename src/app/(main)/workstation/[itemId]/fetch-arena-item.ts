"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { signAssetUrls } from "@/lib/oss";
import { loadAntiCheatConfig } from "@/lib/anti-cheat-config";
import type { ArenaVerdict } from "@prisma/client";

export interface ArenaVideoSide {
  assetId: string;
  videoUrl: string;
  durationSec: number | null;
  modelName: string;
  modelMeta: string;
}

export interface ArenaItemData {
  item: {
    id: string;
    status: string;
    externalId: string;
    promptZh: string;
    promptEn: string;
    taskType: string;
    sourceImage: string | null;
    videoA: ArenaVideoSide;
    videoB: ArenaVideoSide;
    verdict: ArenaVerdict | null;
  };
  dimension: {
    id: string;
    nameZh: string;
    nameEn: string;
  };
  dimensionHierarchy: {
    l1Label: string;
    l2Label: string | null;
    l3Label: string;
  };
  progress: { current: number; total: number; completed: number };
  serverWatchProgressA: number[] | null;
  serverWatchProgressB: number[] | null;
  itemVersion: number;
  antiCheatMinWatchRatio: number;
  hideModel: boolean;
  arenaList: ArenaListItem[];
  nextPairUrls: { a: string; b: string } | null;
}

export interface ArenaListItem {
  id: string;
  index: number;
  externalId: string;
  promptPreview: string;
  l1Code: string;
  l1Label: string;
  status: string;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function buildModelMeta(va: {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}): string {
  const duration = va.durationSec ? `${va.durationSec}s` : null;
  const res = va.width && va.height ? `${va.height}p` : null;
  const aspect =
    va.width && va.height
      ? (() => {
          const g = gcd(va.width, va.height);
          return `${va.width / g}:${va.height / g}`;
        })()
      : null;
  const fps = va.fps ? `${va.fps}fps` : null;
  return [duration, res, aspect, fps].filter(Boolean).join(" · ");
}

/**
 * Fetch a single ArenaItem for dual-video PK evaluation.
 * Returns null if unauthorized, not found, or the package is not active.
 */
export async function fetchArenaItem(
  itemId: string,
  packageId?: string | null,
): Promise<ArenaItemData | null> {
  const session = await getSession();
  if (!session) return null;

  const item = await prisma.arenaItem.findUnique({
    where: { id: itemId },
    include: {
      package: { select: { id: true, status: true, deletedAt: true } },
      prompt: true,
      dimension: {
        include: { parent: { include: { parent: true } } },
      },
      videoAssetA: { include: { model: true } },
      videoAssetB: { include: { model: true } },
    },
  });

  if (!item || item.assignedToId !== session.userId) return null;
  if (item.package.status !== "PUBLISHED" || item.package.deletedAt) return null;

  const currentPkgId = packageId ?? item.packageId;

  // Progress: arena items for this user, scoped to this package
  const allItems = await prisma.arenaItem.findMany({
    where: {
      assignedToId: session.userId,
      packageId: currentPkgId,
      package: { status: "PUBLISHED", deletedAt: null },
    },
    orderBy: { prompt: { externalId: "asc" } },
    select: {
      id: true,
      status: true,
      prompt: { select: { externalId: true, textEn: true } },
      dimension: {
        select: {
          code: true,
          nameZh: true,
          parent: {
            select: {
              code: true,
              nameZh: true,
              parent: { select: { code: true, nameZh: true } },
            },
          },
        },
      },
    },
  });

  const total = allItems.length;
  const completed = allItems.filter((i) => i.status === "COMPLETED").length;
  const currentIndex = allItems.findIndex((i) => i.id === itemId);

  // Build sidebar list
  const arenaList: ArenaListItem[] = allItems.map((ai, idx) => {
    const l1Code =
      ai.dimension.parent?.parent?.code ??
      ai.dimension.parent?.code ??
      ai.dimension.code;
    const l1Label =
      ai.dimension.parent?.parent?.nameZh ??
      ai.dimension.parent?.nameZh ??
      ai.dimension.nameZh;
    return {
      id: ai.id,
      index: idx + 1,
      externalId: ai.prompt.externalId,
      promptPreview:
        ai.prompt.textEn.length > 60
          ? ai.prompt.textEn.slice(0, 60) + "..."
          : ai.prompt.textEn,
      l1Code,
      l1Label,
      status: ai.status,
    };
  });

  // Sign URLs for both sides
  const isI2V = item.videoAssetA.model.taskType === "I2V";
  const rawSourceImage = isI2V ? item.prompt.sourceImage : null;
  const signedA = signAssetUrls(item.videoAssetA.url, rawSourceImage);
  const signedB = signAssetUrls(item.videoAssetB.url, null);

  // Prefetch the next pending item's signed URLs so the browser can warm up
  // the cache while the user is still watching the current pair.
  const nextItem = await prisma.arenaItem.findFirst({
    where: {
      assignedToId: session.userId,
      packageId: currentPkgId,
      package: { status: "PUBLISHED", deletedAt: null },
      status: { in: ["PENDING", "IN_PROGRESS"] },
      id: { not: itemId },
    },
    orderBy: { prompt: { externalId: "asc" } },
    select: {
      videoAssetA: { select: { url: true } },
      videoAssetB: { select: { url: true } },
    },
  });
  const nextPairUrls = nextItem
    ? {
        a: signAssetUrls(nextItem.videoAssetA.url, null).videoUrl,
        b: signAssetUrls(nextItem.videoAssetB.url, null).videoUrl,
      }
    : null;

  // Load anti-cheat + model visibility
  const acConfig = await loadAntiCheatConfig();
  const hideModelRows = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: [
          "display.hide_model_for_internal",
          "display.hide_model_for_vendor",
        ],
      },
    },
  });
  const hideModelMap = Object.fromEntries(
    hideModelRows.map((r) => [r.key, r.value]),
  );
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { accountType: true },
  });
  // Arena ALWAYS hides model names during evaluation (to prevent bias).
  // Fall back to system config only for internal safety; default hide.
  const systemHide =
    user?.accountType === "VENDOR"
      ? Boolean(hideModelMap["display.hide_model_for_vendor"])
      : Boolean(hideModelMap["display.hide_model_for_internal"]);
  const hideModel = true || systemHide;

  const dim = item.dimension;
  const dimL1 = dim.parent?.parent ?? dim.parent;

  return {
    item: {
      id: item.id,
      status: item.status,
      externalId: item.prompt.externalId,
      promptZh: item.prompt.textZh,
      promptEn: item.prompt.textEn,
      taskType: item.videoAssetA.model.taskType,
      sourceImage: signedA.sourceImage,
      videoA: {
        assetId: item.videoAssetAId,
        videoUrl: signedA.videoUrl,
        durationSec: item.videoAssetA.durationSec,
        modelName: item.videoAssetA.model.name,
        modelMeta: buildModelMeta(item.videoAssetA),
      },
      videoB: {
        assetId: item.videoAssetBId,
        videoUrl: signedB.videoUrl,
        durationSec: item.videoAssetB.durationSec,
        modelName: item.videoAssetB.model.name,
        modelMeta: buildModelMeta(item.videoAssetB),
      },
      verdict: item.verdict,
    },
    dimension: {
      id: dim.id,
      nameZh: dim.nameZh,
      nameEn: dim.nameEn,
    },
    dimensionHierarchy: {
      l1Label: dimL1?.nameZh ?? dim.nameZh,
      l2Label: dim.anchor ?? null,
      l3Label: dim.nameZh,
    },
    progress: {
      current: currentIndex + 1,
      total,
      completed,
    },
    serverWatchProgressA: item.watchProgressA as number[] | null,
    serverWatchProgressB: item.watchProgressB as number[] | null,
    itemVersion: item.version,
    antiCheatMinWatchRatio: acConfig.minWatchRatio,
    hideModel,
    arenaList,
    nextPairUrls,
  };
}
