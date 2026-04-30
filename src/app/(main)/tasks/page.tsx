import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Progress } from "@/components/ui/progress";
import { TaskListClient } from "@/components/tasks/task-list-client";
import { getLocale, t } from "@/lib/i18n/server";

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Admin has no personal eval tasks — redirect to task management
  if (session.role === "ADMIN") redirect("/admin/samples");
  const locale = await getLocale();

  const [items, arenaItems] = await Promise.all([
    prisma.evaluationItem.findMany({
      where: {
        assignedToId: session.userId,
        // EvaluationItem.packageId is authoritative; legacy fallback dropped
        // 2026-04-29 (Q3 confirmed 0 items with packageId IS NULL in prod,
        // and the videoAsset.packageId 1:1 field had drifted across 5
        // package groups, making it unsafe as a join axis).
        package: { status: "PUBLISHED", deletedAt: null },
      },
      include: {
        package: { select: { id: true, name: true, deadline: true } },
        videoAsset: {
          include: {
            prompt: true,
            model: true,
            package: { select: { id: true, name: true, deadline: true } },
          },
        },
      },
      orderBy: { videoAsset: { prompt: { externalId: "asc" } } },
    }),
    prisma.arenaItem.findMany({
      where: {
        assignedToId: session.userId,
        package: { status: "PUBLISHED", deletedAt: null },
      },
      include: {
        prompt: true,
        package: { select: { id: true, name: true, deadline: true, taskType: true } },
        videoAssetA: { include: { model: { select: { name: true } } } },
        videoAssetB: { include: { model: { select: { name: true } } } },
      },
      orderBy: { prompt: { externalId: "asc" } },
    }),
  ]);

  const scoringSerialized = items.map((item) => {
    // Authoritative package wins; fall back to legacy videoAsset.package for
    // pre-Dataset-era items whose EvaluationItem.packageId is null.
    const pkg = item.package ?? item.videoAsset.package;
    return {
      id: item.id,
      status: item.status,
      promptZh: item.videoAsset.prompt.textZh,
      promptEn: item.videoAsset.prompt.textEn,
      modelName: item.videoAsset.model.name,
      taskType: item.videoAsset.model.taskType,
      packageName: pkg?.name ?? "",
      packageId: pkg?.id ?? "",
      evaluationMode: "SCORING" as const,
    };
  });

  const arenaSerialized = arenaItems.map((ai) => ({
    id: ai.id,
    status: ai.status,
    promptZh: ai.prompt.textZh,
    promptEn: ai.prompt.textEn,
    modelName: `${ai.videoAssetA.model.name} vs ${ai.videoAssetB.model.name}`,
    taskType: ai.package.taskType,
    packageName: ai.package.name,
    packageId: ai.package.id,
    evaluationMode: "ARENA" as const,
  }));

  const serialized = [...scoringSerialized, ...arenaSerialized];

  const completed = serialized.filter((i) => i.status === "COMPLETED").length;
  const total = serialized.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Build per-package summary for sidebar cards
  const pkgMap = new Map<string, {
    id: string;
    name: string;
    deadline: string | null;
    total: number;
    completed: number;
  }>();
  for (const item of items) {
    // Prefer authoritative EvaluationItem.package; fall back to legacy
    // videoAsset.package only when packageId is null (pre-Dataset era).
    const pkg = item.package ?? item.videoAsset.package;
    if (!pkg) continue;
    const entry = pkgMap.get(pkg.id) ?? {
      id: pkg.id,
      name: pkg.name,
      deadline: pkg.deadline?.toISOString() ?? null,
      total: 0,
      completed: 0,
    };
    entry.total += 1;
    if (item.status === "COMPLETED") entry.completed += 1;
    pkgMap.set(pkg.id, entry);
  }
  for (const ai of arenaItems) {
    const pkg = ai.package;
    const entry = pkgMap.get(pkg.id) ?? {
      id: pkg.id,
      name: pkg.name,
      deadline: pkg.deadline?.toISOString() ?? null,
      total: 0,
      completed: 0,
    };
    entry.total += 1;
    if (ai.status === "COMPLETED") entry.completed += 1;
    pkgMap.set(pkg.id, entry);
  }
  const packageSummaries = [...pkgMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="rounded-full bg-primary/10 p-6 mb-6">
          <svg className="h-12 w-12 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">{t(locale, "tasks.welcomeTitle")}</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {t(locale, "tasks.welcomeDesc")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t(locale, "tasks.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(locale, "tasks.completed", { completed: String(completed), total: String(total) })}
        </p>
      </div>

      <Progress value={progressPct} className="h-2" />

      <TaskListClient items={serialized} packageSummaries={packageSummaries} />
    </div>
  );
}
