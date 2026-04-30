import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale, t } from "@/lib/i18n/server";
import { SampleDetailVideo } from "@/components/admin/sample-detail-video";
import { SampleDetailNav } from "@/components/admin/sample-detail-nav";
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
      dataset: true,
      evaluationItems: {
        include: {
          dimension: { include: { parent: true } },
          assignedTo: { select: { name: true } },
          scores: { select: { value: true, dimensionId: true } },
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

  // ── Score histogram buckets (1-5) + mean/stddev ─────────
  const buckets = [1, 2, 3, 4, 5].map((value) => ({ value, count: 0 }));
  const allScores: number[] = [];
  for (const item of asset.evaluationItems) {
    for (const s of item.scores) {
      if (s.value >= 1 && s.value <= 5) {
        buckets[s.value - 1] = {
          value: s.value,
          count: buckets[s.value - 1].count + 1,
        };
        allScores.push(s.value);
      }
    }
  }
  const maxBucket = buckets.reduce((m, b) => (b.count > m ? b.count : m), 0);
  const hasScores = maxBucket > 0;
  const mean =
    allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;
  const variance =
    allScores.length > 0
      ? allScores.reduce((a, b) => a + (b - mean) ** 2, 0) / allScores.length
      : 0;
  const stddev = Math.sqrt(variance);

  // ── Sibling navigation (same package, ordered by prompt.externalId) ──
  let navData: {
    prevId: string | null;
    nextId: string | null;
    currentIndex: number;
    total: number;
  } | null = null;

  if (asset.packageId) {
    const siblings = await prisma.videoAsset.findMany({
      where: { packageId: asset.packageId },
      orderBy: { prompt: { externalId: "asc" } },
      select: { id: true },
    });
    const currentIndex = siblings.findIndex((s) => s.id === asset.id);
    if (currentIndex !== -1) {
      navData = {
        prevId: currentIndex > 0 ? siblings[currentIndex - 1].id : null,
        nextId:
          currentIndex < siblings.length - 1
            ? siblings[currentIndex + 1].id
            : null,
        currentIndex,
        total: siblings.length,
      };
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 pb-8">
      {/* Back link (full width, above grid) */}
      <Link href="/admin/samples">
        <Button variant="ghost" size="sm">
          ← {t(locale, "admin.samples.title")}
        </Button>
      </Link>

      {/* 70/30 grid; collapses to single column below lg */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,70%)_minmax(0,30%)]">
        {/* ─── Left column ─────────────────────────── */}
        <div className="space-y-6">
          {/* Prompt info */}
          <div className="flex gap-4">
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

          {/* Video player + I2V source image */}
          <SampleDetailVideo
            url={signed.videoUrl}
            sourceImage={signed.sourceImage}
          />

          {/* Evaluation status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t(locale, "admin.samples.evalProgress")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {asset.evaluationItems.map((item) => {
                  const dimName =
                    locale === "zh"
                      ? item.dimension.nameZh
                      : item.dimension.nameEn;
                  const parentName = item.dimension.parent
                    ? locale === "zh"
                      ? item.dimension.parent.nameZh
                      : item.dimension.parent.nameEn
                    : null;
                  const score = item.scores[0];

                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded-md border px-4 py-2"
                    >
                      <div>
                        <span className="text-sm font-medium">
                          {item.assignedTo.name}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {parentName && `${parentName} › `}
                          {dimName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {score ? (
                          <Badge variant="default">{score.value}/5</Badge>
                        ) : (
                          <Badge variant="outline">
                            {t(locale, "common.pending")}
                          </Badge>
                        )}
                        <Badge
                          variant={
                            item.status === "COMPLETED" ? "default" : "outline"
                          }
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

        {/* ─── Right column (sidebar) ───────────────── */}
        <aside className="space-y-8">
          <SampleMetaSection
            externalId={asset.prompt.externalId}
            modelName={asset.model.name}
            taskType={asset.model.taskType}
            durationSec={asset.durationSec}
            width={asset.width}
            height={asset.height}
            fps={asset.fps}
            locale={locale}
          />
          <ScoreDistributionSection
            buckets={buckets}
            maxBucket={maxBucket}
            hasScores={hasScores}
            mean={mean}
            stddev={stddev}
            locale={locale}
          />
          {navData && (
            <SampleDetailNav
              prevId={navData.prevId}
              nextId={navData.nextId}
              currentIndex={navData.currentIndex}
              total={navData.total}
            />
          )}
        </aside>
      </div>
      </div>
    </div>
  );
}

// ─── Sample metadata (flat list, reference layout) ─────────

interface SampleMetaSectionProps {
  externalId: string;
  modelName: string;
  taskType: "T2V" | "I2V";
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  locale: "zh" | "en";
}

function SampleMetaSection({
  externalId,
  modelName,
  taskType,
  durationSec,
  width,
  height,
  fps,
  locale,
}: SampleMetaSectionProps) {
  const rows: Array<{ label: string; value: string }> = [
    { label: t(locale, "admin.samples.meta.externalId"), value: externalId },
    { label: t(locale, "admin.samples.meta.model"), value: modelName },
    { label: t(locale, "admin.samples.meta.taskType"), value: taskType },
  ];
  if (durationSec != null) {
    rows.push({
      label: t(locale, "admin.samples.videoParams.duration"),
      value: `${durationSec}s`,
    });
  }
  if (width != null && height != null) {
    rows.push({
      label: t(locale, "admin.samples.videoParams.resolution"),
      value: `${width}×${height}`,
    });
  }
  if (fps != null) {
    rows.push({
      label: t(locale, "admin.samples.videoParams.fps"),
      value: `${fps} fps`,
    });
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        {t(locale, "admin.samples.meta.title")}
      </h3>
      <dl className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ─── Score distribution (vertical colored bars) ────────────

interface ScoreDistributionSectionProps {
  buckets: Array<{ value: number; count: number }>;
  maxBucket: number;
  hasScores: boolean;
  mean: number;
  stddev: number;
  locale: "zh" | "en";
}

// Tailwind colors: red-500, orange-500, amber-500, green-500, teal-500
const BAR_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-green-500",
  "bg-teal-500",
];

function ScoreDistributionSection({
  buckets,
  maxBucket,
  hasScores,
  mean,
  stddev,
  locale,
}: ScoreDistributionSectionProps) {
  return (
    <section className="border-t pt-6">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        {t(locale, "admin.samples.scoreDistribution.title")}
      </h3>
      {!hasScores ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t(locale, "admin.samples.scoreDistribution.empty")}
        </p>
      ) : (
        <>
          {/* Vertical bars — outer items-stretch so each column fills h-28,
             then flex-col + justify-end anchors bar to the baseline. Using
             items-end on the outer would collapse each column's height to
             its content, making the inner `height: X%` resolve to 0. */}
          <div className="flex h-28 items-stretch gap-2">
            {buckets.map((b, i) => {
              const ratio = maxBucket > 0 ? b.count / maxBucket : 0;
              const pct = Math.max(ratio * 100, b.count > 0 ? 10 : 3);
              return (
                <div
                  key={b.value}
                  className="flex flex-1 flex-col justify-end"
                >
                  <div
                    className={`w-full rounded-sm ${
                      b.count > 0
                        ? BAR_COLORS[i]
                        : "bg-foreground/10 dark:bg-foreground/15"
                    }`}
                    style={{ height: `${pct}%` }}
                    title={`${b.value}: ${b.count}`}
                  />
                </div>
              );
            })}
          </div>
          {/* X-axis labels */}
          <div className="mt-2 flex gap-2">
            {buckets.map((b) => (
              <div
                key={b.value}
                className="flex-1 text-center text-xs text-muted-foreground"
              >
                {b.value}
              </div>
            ))}
          </div>
          {/* Mean + stddev */}
          <p className="mt-4 text-xs text-muted-foreground">
            {t(locale, "admin.samples.scoreDistribution.mean")}{" "}
            <span className="font-semibold text-foreground">
              {mean.toFixed(2)}
            </span>{" "}
            ·{" "}
            {t(locale, "admin.samples.scoreDistribution.stddev")}{" "}
            <span className="font-semibold text-foreground">
              {stddev.toFixed(2)}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
