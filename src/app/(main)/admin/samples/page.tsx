import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { PackageListClient } from "@/components/admin/package-list-client";

export default async function TaskManagementPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const packages = await prisma.evaluationPackage.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      videoAssets: {
        include: {
          model: { select: { name: true } },
          evaluationItems: {
            select: {
              status: true,
              assignedTo: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  const serialized = packages.map((pkg) => {
    const completed = pkg.videoAssets.reduce(
      (sum, va) => sum + va.evaluationItems.filter((i) => i.status === "COMPLETED").length,
      0
    );
    const totalItems = pkg.videoAssets.reduce(
      (sum, va) => sum + va.evaluationItems.length,
      0
    );

    const modelNames = [...new Set(pkg.videoAssets.map((va) => va.model.name))];

    const annotatorMap = new Map<string, { name: string; completed: number; total: number }>();
    for (const va of pkg.videoAssets) {
      for (const item of va.evaluationItems) {
        const existing = annotatorMap.get(item.assignedTo.id);
        if (existing) {
          existing.total++;
          if (item.status === "COMPLETED") existing.completed++;
        } else {
          annotatorMap.set(item.assignedTo.id, {
            name: item.assignedTo.name,
            total: 1,
            completed: item.status === "COMPLETED" ? 1 : 0,
          });
        }
      }
    }

    const deadlineStatus: "ok" | "near" | "overdue" | null = pkg.deadline
      ? new Date(pkg.deadline) < new Date()
        ? "overdue"
        : new Date(pkg.deadline).getTime() - Date.now() < 24 * 3600_000
          ? "near"
          : "ok"
      : null;

    return {
      id: pkg.id,
      name: pkg.name,
      taskType: pkg.taskType,
      videoCount: pkg.videoCount,
      annotatorCount: pkg.annotatorCount,
      completedItems: completed,
      totalItems,
      status: pkg.status,
      publishedAt: pkg.publishedAt?.toISOString() ?? null,
      deadline: pkg.deadline?.toISOString() ?? null,
      deadlineStatus,
      modelCheckpoint: pkg.modelCheckpoint,
      description: pkg.description,
      modelNames,
      annotatorProgress: [...annotatorMap.values()],
      createdAt: pkg.createdAt.toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t(locale, "admin.samples.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(locale, "admin.samples.total", { count: String(serialized.length) })}
        </p>
      </div>
      <PackageListClient packages={serialized} />
    </div>
  );
}
