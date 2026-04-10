import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  PENDING: { label: "待评测", variant: "outline" },
  IN_PROGRESS: { label: "进行中", variant: "secondary" },
  COMPLETED: { label: "已完成", variant: "default" },
  EXPIRED: { label: "已过期", variant: "outline" },
};

export default async function TasksPage() {
  const session = await getSession();
  if (!session) redirect("/login");

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
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });

  const completed = items.filter((i) => i.status === "COMPLETED").length;
  const total = items.length;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">评测任务</h1>
        <p className="text-sm text-muted-foreground">
          已完成 {completed}/{total} 项
        </p>
      </div>

      <Progress value={progressPct} className="h-2" />

      <div className="grid gap-3">
        {items.map((item) => {
          const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.PENDING;
          return (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium">
                    {item.videoAsset.prompt.textZh}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {item.videoAsset.model.name} · {item.videoAsset.prompt.textEn}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {item.status !== "COMPLETED" && (
                    <Link href={`/workstation/${item.id}`}>
                      <Button size="sm">开始评测</Button>
                    </Link>
                  )}
                </div>
              </CardHeader>
            </Card>
          );
        })}

        {items.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              暂无评测任务
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
