import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getLocale, t } from "@/lib/i18n/server";

export default async function ProgressPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const locale = await getLocale();

  const [total, completed, scores] = await Promise.all([
    prisma.evaluationItem.count({
      where: { assignedToId: session.userId },
    }),
    prisma.evaluationItem.count({
      where: { assignedToId: session.userId, status: "COMPLETED" },
    }),
    prisma.score.findMany({
      where: { userId: session.userId },
      select: { value: true },
    }),
  ]);

  const pending = total - completed;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const distribution = [0, 0, 0, 0, 0];
  for (const s of scores) {
    distribution[s.value - 1]++;
  }
  const maxCount = Math.max(...distribution, 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t(locale, "progress.title")}</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t(locale, "progress.completionRate")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{progressPct}%</div>
            <Progress value={progressPct} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t(locale, "progress.completed")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{completed}</div>
            <p className="text-xs text-muted-foreground">
              {t(locale, "progress.totalTasks", { total: String(total) })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t(locale, "progress.remaining")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pending}</div>
            <p className="text-xs text-muted-foreground">
              {t(locale, "progress.remainingTasks")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t(locale, "progress.scoreDistribution")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            {distribution.map((count, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs text-muted-foreground">{count}</span>
                <div
                  className="w-full rounded-t bg-primary transition-all"
                  style={{ height: `${(count / maxCount) * 120}px` }}
                />
                <span className="text-sm font-medium">{i + 1}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
