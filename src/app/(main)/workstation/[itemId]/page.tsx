import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { WorkstationClient } from "@/components/workstation/workstation-client";

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
    },
  });

  if (!item || item.assignedToId !== session.userId) {
    notFound();
  }

  const dimensions = await prisma.dimension.findMany({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    include: {
      failureTags: true,
    },
  });

  // Count total and completed for progress
  const [totalItems, completedItems] = await Promise.all([
    prisma.evaluationItem.count({
      where: { assignedToId: session.userId },
    }),
    prisma.evaluationItem.count({
      where: { assignedToId: session.userId, status: "COMPLETED" },
    }),
  ]);

  // Find prev/next items for navigation
  const allItems = await prisma.evaluationItem.findMany({
    where: { assignedToId: session.userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true },
  });

  const currentIndex = allItems.findIndex((i) => i.id === itemId);
  const prevItemId = currentIndex > 0 ? allItems[currentIndex - 1].id : null;
  const nextItemId =
    currentIndex < allItems.length - 1 ? allItems[currentIndex + 1].id : null;

  return (
    <WorkstationClient
      item={{
        id: item.id,
        status: item.status,
        videoUrl: item.videoAsset.url,
        videoDuration: item.videoAsset.durationSec,
        promptZh: item.videoAsset.prompt.textZh,
        promptEn: item.videoAsset.prompt.textEn,
        modelName: item.videoAsset.model.name,
      }}
      dimensions={dimensions.map((d) => ({
        id: d.id,
        code: d.code,
        nameZh: d.nameZh,
        nameEn: d.nameEn,
        anchor: d.anchor,
        testPoints: d.testPoints as string[] | null,
        failureTags: d.failureTags.map((t) => ({
          id: t.id,
          labelZh: t.labelZh,
          labelEn: t.labelEn,
        })),
      }))}
      progress={{
        current: currentIndex + 1,
        total: totalItems,
        completed: completedItems,
      }}
      navigation={{ prevItemId, nextItemId }}
      userId={session.userId}
    />
  );
}
