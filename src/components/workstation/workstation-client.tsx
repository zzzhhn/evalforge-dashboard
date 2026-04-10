"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { VideoPlayer, type VideoMetrics } from "./video-player";
import { ScoringPanel } from "./scoring-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { submitEvaluation, type ScoreInput } from "@/app/(main)/workstation/[itemId]/action";

interface ItemData {
  id: string;
  status: string;
  externalId?: string;
  videoUrl: string;
  videoDuration: number | null;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType?: string;
  sourceImage?: string | null;
  modelMeta?: string;
}

interface DimensionData {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  anchor: string | null;
  parentNameZh?: string | null;
  parentNameEn?: string | null;
  parentCode?: string | null;
  failureTags: { id: string; labelZh: string; labelEn: string }[];
}

interface DimensionHierarchy {
  l1Label: string;
  l2Label: string | null;
  l3Label: string;
}

interface ProgressData {
  current: number;
  total: number;
  completed: number;
}

interface NavigationData {
  prevItemId: string | null;
  nextItemId: string | null;
}

interface DimensionFilter {
  code: string;
  label: string;
  count: number;
}

interface VideoListItem {
  id: string;
  index: number;
  externalId: string;
  promptPreview: string;
  l1Label: string;
  status: string;
}

interface Props {
  item: ItemData;
  dimension: DimensionData;
  dimensionHierarchy: DimensionHierarchy;
  progress: ProgressData;
  navigation: NavigationData;
  userId: string;
  antiCheat?: { minWatchRatio: number };
  dimensionFilters?: DimensionFilter[];
  videoList?: VideoListItem[];
  hideModel?: boolean;
}

export function WorkstationClient({
  item,
  dimension,
  dimensionHierarchy,
  progress,
  navigation,
  antiCheat,
  videoList,
  hideModel,
}: Props) {
  const router = useRouter();
  const { locale, t } = useLocale();
  const [videoMetrics, setVideoMetrics] = useState<VideoMetrics>({
    watchRatio: 0,
    dwellStartTime: Date.now(),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (score: number, failureTags: string[], comment: string) => {
      setSubmitting(true);
      setError(null);

      const dwellTimeMs = Date.now() - videoMetrics.dwellStartTime;

      const scores: ScoreInput[] = [{
        dimensionId: dimension.id,
        value: score,
        failureTags,
      }];

      const result = await submitEvaluation({
        itemId: item.id,
        scores,
        comment,
        watchRatio: videoMetrics.watchRatio,
        dwellTimeMs,
      });

      if (!result.success) {
        setError(result.error ?? (locale === "zh" ? "提交失败" : "Submit failed"));
        setSubmitting(false);
        return;
      }

      if (result.nextItemId) {
        router.push(`/workstation/${result.nextItemId}`);
      } else {
        router.push("/tasks");
      }
    },
    [item.id, dimension.id, videoMetrics, router, locale]
  );

  const promptPrimary = locale === "zh" ? item.promptZh : item.promptEn;
  const promptSecondary = locale === "zh" ? item.promptEn : item.promptZh;
  const dimName = locale === "zh" ? dimension.nameZh : dimension.nameEn;

  return (
    <div className="flex h-full">
      {/* ─── Left sidebar: dimension info ─── */}
      <aside className="w-64 shrink-0 border-r bg-card overflow-y-auto p-4 space-y-4 hidden lg:block">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {locale === "zh" ? "维度层级" : "Dimension"}
          </h3>
          <div className="space-y-1 text-sm">
            <div className="text-primary font-medium">{dimensionHierarchy.l1Label}</div>
            {dimensionHierarchy.l2Label && (
              <div className="ml-2 text-muted-foreground">→ {dimensionHierarchy.l2Label}</div>
            )}
            <div className="ml-4 text-foreground">{dimensionHierarchy.l3Label}</div>
          </div>
        </div>

        {dimension.anchor && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">
              {locale === "zh" ? "评分锚点" : "Anchor"}
            </h4>
            <p className="text-xs text-foreground">{dimension.anchor}</p>
          </div>
        )}

        {dimension.failureTags.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">
              {locale === "zh" ? "失败标签" : "Failure Tags"}
            </h4>
            <div className="flex flex-wrap gap-1">
              {dimension.failureTags.map((tag) => (
                <Badge key={tag.id} variant="outline" className="text-xs">
                  {locale === "zh" ? tag.labelZh : tag.labelEn}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ─── Center: main content ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
          <div className="flex items-center gap-3">
            <Badge variant="outline">
              {progress.current}/{progress.total}
            </Badge>
            <Badge variant="secondary">{dimName}</Badge>
            <span className="text-xs text-muted-foreground">
              ⌨ 1-5 {locale === "zh" ? "评分" : "score"} · Space {locale === "zh" ? "播放/暂停" : "play/pause"} · Enter {locale === "zh" ? "提交" : "submit"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/tasks")}
          >
            {locale === "zh" ? "退出评测" : "Exit"}
          </Button>
        </header>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 p-4">
            {/* Prompt */}
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium text-foreground">{promptPrimary}</p>
              <p className="mt-1 text-sm text-muted-foreground">{promptSecondary}</p>
              <div className="mt-2 flex items-center gap-2">
                {!hideModel && (
                  <Badge variant="secondary">{item.modelName}</Badge>
                )}
                {item.taskType && (
                  <Badge variant="outline" className={
                    item.taskType === "T2V"
                      ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                      : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                  }>
                    {item.taskType}
                  </Badge>
                )}
                {item.modelMeta && (
                  <span className="text-xs text-muted-foreground">{item.modelMeta}</span>
                )}
              </div>
            </div>

            {/* Video player */}
            <VideoPlayer url={item.videoUrl} onMetricsUpdate={setVideoMetrics} />

            {/* Error */}
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Scoring panel */}
            <ScoringPanel
              dimension={dimension}
              onSubmit={handleSubmit}
              submitting={submitting}
            />
          </div>
        </div>

        {/* Bottom nav */}
        <footer className="flex h-12 shrink-0 items-center justify-center gap-4 border-t bg-card px-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={!navigation.prevItemId}
            onClick={() =>
              navigation.prevItemId &&
              router.push(`/workstation/${navigation.prevItemId}`)
            }
          >
            ← {locale === "zh" ? "上一题" : "Previous"}
          </Button>

          <div className="flex gap-1">
            {Array.from({ length: Math.min(progress.total, 20) }, (_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full ${
                  i < progress.completed
                    ? "bg-primary"
                    : i === progress.current - 1
                      ? "bg-primary/50"
                      : "bg-muted"
                }`}
              />
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            disabled={!navigation.nextItemId}
            onClick={() =>
              navigation.nextItemId &&
              router.push(`/workstation/${navigation.nextItemId}`)
            }
          >
            {locale === "zh" ? "下一题" : "Next"} →
          </Button>
        </footer>
      </div>

      {/* ─── Right sidebar: video list ─── */}
      {videoList && videoList.length > 0 && (
        <aside className="w-56 shrink-0 border-l bg-card overflow-y-auto hidden xl:block">
          <div className="p-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {locale === "zh" ? "视频列表" : "Video List"}
            </h3>
            <div className="space-y-1">
              {videoList.map((v) => (
                <button
                  key={v.id}
                  onClick={() => router.push(`/workstation/${v.id}`)}
                  className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors ${
                    v.id === item.id
                      ? "bg-primary/10 text-primary font-medium"
                      : v.status === "COMPLETED"
                        ? "text-muted-foreground hover:bg-accent"
                        : "text-foreground hover:bg-accent"
                  }`}
                >
                  <span className="font-mono">{v.index}.</span>{" "}
                  <span className="truncate">{v.promptPreview}</span>
                  {v.status === "COMPLETED" && <span className="ml-1">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
