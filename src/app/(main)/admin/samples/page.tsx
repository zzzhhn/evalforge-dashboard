import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function SamplesPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }

  const videoAssets = await prisma.videoAsset.findMany({
    include: {
      model: true,
      prompt: true,
      evaluationItems: {
        select: { status: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">样本管理</h1>
        <p className="text-sm text-muted-foreground">
          共 {videoAssets.length} 个视频样本
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Prompt (中)</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>时长</TableHead>
              <TableHead>评测进度</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {videoAssets.map((asset) => {
              const completed = asset.evaluationItems.filter(
                (i) => i.status === "COMPLETED"
              ).length;
              const total = asset.evaluationItems.length;
              return (
                <TableRow key={asset.id}>
                  <TableCell className="max-w-xs truncate text-sm">
                    {asset.prompt.textZh}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{asset.model.name}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {asset.model.taskType}
                  </TableCell>
                  <TableCell className="text-xs">
                    {asset.durationSec ? `${asset.durationSec}s` : "-"}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">
                      {completed}/{total}
                    </span>
                    {completed === total && total > 0 && (
                      <Badge variant="default" className="ml-2">
                        完成
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
