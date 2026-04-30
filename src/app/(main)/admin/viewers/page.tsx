import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getLocale, t } from "@/lib/i18n/server";
import { ViewersClient } from "@/components/admin/viewers-client";

export default async function AdminViewersPage() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const [viewers, packages] = await Promise.all([
    prisma.user.findMany({
      where: { role: "VIEWER", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        accountType: true,
        createdAt: true,
        viewerAssignments: {
          select: {
            packageId: true,
            assignedAt: true,
            package: {
              select: {
                id: true,
                name: true,
                taskType: true,
                evaluationMode: true,
                videoCount: true,
              },
            },
          },
          orderBy: { assignedAt: "desc" },
        },
      },
    }),
    prisma.evaluationPackage.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        taskType: true,
        evaluationMode: true,
        videoCount: true,
        status: true,
      },
    }),
  ]);

  const serializedViewers = viewers.map((v) => ({
    id: v.id,
    name: v.name,
    email: v.email,
    accountType: v.accountType,
    createdAt: v.createdAt.toISOString(),
    assignments: v.viewerAssignments.map((a) => ({
      packageId: a.packageId,
      packageName: a.package.name,
      taskType: a.package.taskType,
      evaluationMode: a.package.evaluationMode,
      videoCount: a.package.videoCount,
      assignedAt: a.assignedAt.toISOString(),
    })),
  }));

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t(locale, "admin.viewers.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(locale, "admin.viewers.subtitle")}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ViewersClient viewers={serializedViewers} packages={packages} />
      </div>
    </div>
  );
}
