import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { DatasetsClient } from "@/components/admin/datasets-client";

export default async function DatasetsPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const [datasets, promptSuites, models] = await Promise.all([
    prisma.dataset.findMany({
      orderBy: { generatedAt: "desc" },
      include: {
        model: { select: { id: true, name: true, provider: true, taskType: true } },
        promptSuite: { select: { id: true, name: true, taskType: true } },
        imageSet: { select: { id: true, name: true, imageCount: true } },
        _count: { select: { evaluationPackages: true, videoAssets: true } },
      },
    }),
    prisma.promptSuite.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        taskType: true,
        createdAt: true,
        entries: {
          select: { dimensionId: true },
        },
        _count: {
          select: {
            entries: true,
            evaluationPackages: true,
          },
        },
      },
    }),
    prisma.model.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, provider: true, taskType: true, description: true },
    }),
  ]);

  const serializedDatasets = datasets.map((d) => ({
    id: d.id,
    name: d.name,
    taskType: d.taskType,
    videoCount: d.videoCount,
    videoOssPrefix: d.videoOssPrefix,
    generatedAt: d.generatedAt.toISOString(),
    frames: d.frames,
    resolution: d.resolution,
    duration: d.duration,
    aspect: d.aspect,
    model: d.model,
    promptSuite: d.promptSuite,
    imageSet: d.imageSet,
    packageCount: d._count.evaluationPackages,
    actualVideoCount: d._count.videoAssets,
  }));

  const serializedSuites = promptSuites.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    taskType: s.taskType,
    entryCount: s._count.entries,
    // Distinct-dimension count — one prompt can span multiple dimensions
    // so Set dedupes correctly. Small client-side cost, avoids a second
    // DB query.
    dimensionCount: new Set(s.entries.map((e) => e.dimensionId)).size,
    createdAt: s.createdAt.toISOString(),
    linkedPackageCount: s._count.evaluationPackages,
  }));

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t(locale, "admin.datasets.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(locale, "admin.datasets.total", {
              count: String(serializedDatasets.length),
            })}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DatasetsClient
          datasets={serializedDatasets}
          promptSuites={serializedSuites}
          models={models}
        />
      </div>
    </div>
  );
}
