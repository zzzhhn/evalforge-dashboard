import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { WorkstationClient } from "@/components/workstation/workstation-client";
import { signAssetUrls } from "@/lib/oss";
import { loadAntiCheatConfig } from "@/lib/anti-cheat-config";

interface Props {
  params: Promise<{ itemId: string }>;
}

export default async function WorkstationPage({ params }: Props) {
  const { itemId } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const item = await prisma.evaluationItem.findUnique({
    where: { id: itemId },
    include: {
      videoAsset: {
        include: {
          prompt: true,
          model: true,
        },
      },
      dimension: {
        include: {
          parent: { include: { parent: true } },
          failureTags: true,
        },
      },
    },
  });

  if (!item || item.assignedToId !== session.userId) {
    notFound();
  }

  const allItems = await prisma.evaluationItem.findMany({
    where: { assignedToId: session.userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      status: true,
      videoAsset: {
        select: {
          prompt: { select: { id: true, externalId: true, textEn: true } },
        },
      },
      dimension: {
        select: {
          code: true,
          nameZh: true,
          nameEn: true,
          parent: {
            select: {
              code: true, nameZh: true, nameEn: true,
              parent: { select: { code: true, nameZh: true, nameEn: true } },
            },
          },
        },
      },
    },
  });

  const currentIndex = allItems.findIndex((i) => i.id === itemId);
  const totalItems = allItems.length;
  const completedItems = allItems.filter((i) => i.status === "COMPLETED").length;
  const prevItemId = currentIndex > 0 ? allItems[currentIndex - 1].id : null;
  const nextItemId = currentIndex < allItems.length - 1 ? allItems[currentIndex + 1].id : null;

  const dimensionCounts = new Map<string, { code: string; label: string; count: number }>();
  for (const ai of allItems) {
    if (!ai.dimension) continue;
    const l1Code = ai.dimension.parent?.parent?.code
      ?? ai.dimension.parent?.code
      ?? ai.dimension.code;
    const l1NameZh = ai.dimension.parent?.parent?.nameZh
      ?? ai.dimension.parent?.nameZh
      ?? ai.dimension.nameZh;

    const existing = dimensionCounts.get(l1Code);
    if (existing) {
      existing.count++;
    } else {
      dimensionCounts.set(l1Code, { code: l1Code, label: l1NameZh, count: 1 });
    }
  }
  const dimensionFilters = [...dimensionCounts.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const videoList = allItems.map((ai, idx) => {
    const l1NameZh = ai.dimension?.parent?.parent?.nameZh ?? ai.dimension?.parent?.nameZh ?? ai.dimension?.nameZh ?? "";
    return {
      id: ai.id,
      index: idx + 1,
      externalId: ai.videoAsset.prompt.externalId,
      promptPreview: ai.videoAsset.prompt.textEn.length > 60
        ? ai.videoAsset.prompt.textEn.slice(0, 60) + "..."
        : ai.videoAsset.prompt.textEn,
      l1Label: l1NameZh,
      status: ai.status,
    };
  });

  const dim = item.dimension;
  const dimL2 = dim?.parent ?? null;
  const dimL1 = dim?.parent?.parent ?? dim?.parent ?? null;

  const isI2V = item.videoAsset.model.taskType === "I2V";
  const rawSourceImage = isI2V ? item.videoAsset.prompt.sourceImage : null;
  const signed = signAssetUrls(item.videoAsset.url, rawSourceImage);

  const acConfig = await loadAntiCheatConfig();

  const hideModelRows = await prisma.systemConfig.findMany({
    where: { key: { in: ["display.hide_model_for_internal", "display.hide_model_for_vendor"] } },
  });
  const hideModelMap = Object.fromEntries(hideModelRows.map((r) => [r.key, r.value]));
  const currentUser = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { accountType: true },
  });
  const hideModel = currentUser?.accountType === "VENDOR"
    ? Boolean(hideModelMap["display.hide_model_for_vendor"])
    : Boolean(hideModelMap["display.hide_model_for_internal"]);

  const va = item.videoAsset;
  const durationStr = va.durationSec ? `${va.durationSec}s` : null;
  const resStr = va.width && va.height ? `${va.height}p` : null;
  function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }
  const aspectStr = va.width && va.height
    ? (() => { const g = gcd(va.width, va.height); return `${va.width / g}:${va.height / g}`; })()
    : null;
  const fpsStr = va.fps ? `${va.fps}fps` : null;
  const modelMeta = [durationStr, resStr, aspectStr, fpsStr].filter(Boolean).join(" · ");

  return (
    <WorkstationClient
      key={item.id}
      antiCheat={{
        minWatchRatio: acConfig.minWatchRatio,
      }}
      item={{
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
      }}
      dimensionHierarchy={{
        l1Label: dimL1?.nameZh ?? dim?.nameZh ?? "",
        l2Label: dim?.anchor ?? null,
        l3Label: dim?.nameZh ?? "",
      }}
      dimension={{
        id: dim?.id ?? "",
        code: dim?.code ?? "",
        nameZh: dim?.nameZh ?? "",
        nameEn: dim?.nameEn ?? "",
        anchor: dim?.anchor ?? null,
        parentNameZh: dim?.parent?.nameZh ?? null,
        parentNameEn: dim?.parent?.nameEn ?? null,
        parentCode: dim?.parent?.code ?? null,
        failureTags: (dim?.failureTags ?? []).map((t) => ({
          id: t.id,
          labelZh: t.labelZh,
          labelEn: t.labelEn,
        })),
      }}
      progress={{
        current: currentIndex + 1,
        total: totalItems,
        completed: completedItems,
      }}
      navigation={{ prevItemId, nextItemId }}
      userId={session.userId}
      dimensionFilters={dimensionFilters}
      videoList={videoList}
      hideModel={hideModel}
    />
  );
}
