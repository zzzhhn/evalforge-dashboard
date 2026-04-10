import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, t } from "@/lib/i18n/server";
import { SampleDetailVideo } from "@/components/admin/sample-detail-video";
import { signAssetUrls } from "@/lib/oss";

interface Props {
  params: Promise<{ assetId: string }>;
}

export default async function SampleDetailPage({ params }: Props) {
  const { assetId } = await params;
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    redirect("/tasks");
  }
  const locale = await getLocale();

  const asset = await prisma.videoAsset.findUnique({
    where: { id: assetId },
    include: {
      model: true,
      prompt: true,
      evaluationItems: {
        include: {
          assignedTo: { select: { name: true } },
          scores: {
            include: { dimension: { select: { code: true, nameZh: true, nameEn: true } } },
          },
        },
      },
    },
  });

  if (!asset) notFound();

  const primary = locale === "zh" ? asset.prompt.textZh : asset.prompt.textEn;
  const secondary = locale === "zh" ? asset.prompt.textEn : asset.prompt.textZh;
  const isI2V = asset.model.taskType === "I2V";
  const signed = signAssetUrls(
    asset.url,
    isI2V ? asset.prompt.sourceImage : null
  );

  return (
    <div className="space-y-6">
      <Link href="/admin/samples">
        <Button variant="ghost" size="sm">
          ← {t(locale, "admin.samples.title")}
        </Button>
      </Link>

      <div className="flex gap-4">
        {isI2V && signed.sourceImage && (
          <img
            src={signed.sourceImage}
            alt="Start frame"
            className="h-24 w-24 shrink-0 rounded-lg border object-cover"
          />
        )}
        <div className="flex-1">
          <p className="text-lg font-medium">{primary}</p>
          <p className="mt-1 text-sm text-muted-foreground">{secondary}</p>
          <div className="mt-2 flex gap-2">
            <Badge variant="secondary">{asset.model.name}</Badge>
            <Badge
              variant="outline"
              className={
                asset.model.taskType === "T2V"
                  ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                  : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
              }
            >
              {asset.model.taskType}
            </Badge>
            {asset.durationSec && (
              <Badge variant="outline">{asset.durationSec}s</Badge>
            )}
          </div>
        </div>
      </div>

      <SampleDetailVideo url={signed.videoUrl} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t(locale, "admin.samples.evalProgress")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {asset.evaluationItems.map((item) => {
              const avgScore = item.scores.length > 0
                ? (item.scores.reduce((sum, s) => sum + s.value, 0) / item.scores.length).toFixed(1)
                : null;

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-md border px-4 py-2"
                >
                  <div>
                    <span className="text-sm font-medium">{item.assignedTo.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.scores.length} {locale === "zh" ? "个评分" : "scores"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {avgScore ? (
                      <Badge variant="default">{avgScore}/5</Badge>
                    ) : (
                      <Badge variant="outline">
                        {locale === "zh" ? "待评测" : "Pending"}
                      </Badge>
                    )}
                    <Badge
                      variant={item.status === "COMPLETED" ? "default" : "outline"}
                    >
                      {item.status === "COMPLETED"
                        ? t(locale, "common.completed")
                        : t(locale, "common.pending")}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
