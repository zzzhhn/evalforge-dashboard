import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  PackageCreateForm,
  type DatasetOption,
} from "@/components/admin/package-create-form";
import type { AnnotatorOption } from "@/components/admin/annotator-picker";

export default async function PackageCreatePage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }

  const [datasets, annotators] = await Promise.all([
    prisma.dataset.findMany({
      orderBy: { generatedAt: "desc" },
      include: {
        model: { select: { id: true, name: true, provider: true } },
        promptSuite: { select: { id: true, name: true } },
        _count: { select: { videoAssets: true } },
      },
    }),
    prisma.user.findMany({
      where: {
        role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] },
        deletedAt: null,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        accountType: true,
        groupMemberships: {
          select: { group: { select: { name: true } } },
        },
      },
    }),
  ]);

  const annotatorIds = annotators.map((a) => a.id);
  const activeCounts = annotatorIds.length
    ? await prisma.evaluationPackage.findMany({
        where: {
          deletedAt: null,
          status: { in: ["DRAFT", "PUBLISHED"] },
          OR: [
            {
              videoAssets: {
                some: {
                  evaluationItems: {
                    some: {
                      assignedToId: { in: annotatorIds },
                      status: { in: ["PENDING", "IN_PROGRESS"] },
                    },
                  },
                },
              },
            },
            {
              arenaItems: {
                some: {
                  assignedToId: { in: annotatorIds },
                  status: { in: ["PENDING", "IN_PROGRESS"] },
                },
              },
            },
          ],
        },
        include: {
          videoAssets: {
            select: {
              evaluationItems: {
                where: {
                  assignedToId: { in: annotatorIds },
                  status: { in: ["PENDING", "IN_PROGRESS"] },
                },
                select: { assignedToId: true },
              },
            },
          },
          arenaItems: {
            where: {
              assignedToId: { in: annotatorIds },
              status: { in: ["PENDING", "IN_PROGRESS"] },
            },
            select: { assignedToId: true },
          },
        },
      })
    : [];

  const activeByUser = new Map<string, Set<string>>();
  for (const pkg of activeCounts) {
    const userIdsInPkg = new Set<string>();
    for (const va of pkg.videoAssets) {
      for (const it of va.evaluationItems) userIdsInPkg.add(it.assignedToId);
    }
    for (const ai of pkg.arenaItems) userIdsInPkg.add(ai.assignedToId);
    for (const uid of userIdsInPkg) {
      const set = activeByUser.get(uid) ?? new Set<string>();
      set.add(pkg.id);
      activeByUser.set(uid, set);
    }
  }

  const datasetOptions: DatasetOption[] = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    taskType: d.taskType,
    videoCount: d._count.videoAssets,
    generatedAt: d.generatedAt.toISOString(),
    model: d.model,
    promptSuite: d.promptSuite,
  }));

  const annotatorOptions: AnnotatorOption[] = annotators.map((a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    accountType: a.accountType,
    groups: a.groupMemberships.map((m) => m.group.name),
    activePackageCount: activeByUser.get(a.id)?.size ?? 0,
    compositeScore: null,
  }));

  return (
    <PackageCreateForm
      datasets={datasetOptions}
      annotators={annotatorOptions}
    />
  );
}
