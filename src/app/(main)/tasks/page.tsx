import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Progress } from "@/components/ui/progress";
import { TaskListClient } from "@/components/tasks/task-list-client";
import { getLocale, t } from "@/lib/i18n/server";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "ADMIN") redirect("/admin/samples");
  const locale = await getLocale();

  const items = await prisma.evaluationItem.findMany({
    where: { assignedToId: session.userId },
    include: {
      videoAsset: {
        include: {
          prompt: true,
          model: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const completed = items.filter((i) => i.status === "COMPLETED").length;
  const total = items.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const serialized = items.map((item) => ({
    id: item.id,
    status: item.status,
    promptZh: item.videoAsset.prompt.textZh,
    promptEn: item.videoAsset.prompt.textEn,
    modelName: item.videoAsset.model.name,
    taskType: item.videoAsset.model.taskType,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t(locale, "tasks.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(locale, "tasks.completed", { completed: String(completed), total: String(total) })}
        </p>
      </div>

      <Progress value={progressPct} className="h-2" />

      <TaskListClient items={serialized} />
    </div>
  );
}
