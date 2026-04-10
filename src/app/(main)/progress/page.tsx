import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export default async function ProgressPage() {
  const session = await getSession();
  if (!session) redirect("/login");

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

  // Score distribution
  const distribution = [0, 0, 0, 0, 0]; // index 0 = score 1, etc.
  for (const s of scores) {
    distribution[s.value - 1]++;
  }
  const maxCount = Math.max(...distribution, 1);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">我的进度</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">完成率</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{progressPct}%</div>
            <Progress value={progressPct} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">已完成</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{completed}</div>
            <p className="text-xs text-muted-foreground">共 {total} 项任务</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">待完成</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pending}</div>
            <p className="text-xs text-muted-foreground">剩余任务</p>
          </CardContent>
        </Card>
      </div>

      {/* Score Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">评分分布</CardTitle>
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
