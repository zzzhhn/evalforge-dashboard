"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { VideoPlayer, type VideoMetrics } from "./video-player";
import { ScoringPanel } from "./scoring-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { submitEvaluation, type ScoreInput } from "@/app/(main)/workstation/[itemId]/action";

interface ItemData {
  id: string;
  status: string;
  videoUrl: string;
  videoDuration: number | null;
  promptZh: string;
  promptEn: string;
  modelName: string;
}

interface DimensionData {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  anchor: string | null;
  testPoints: string[] | null;
  failureTags: { id: string; labelZh: string; labelEn: string }[];
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

interface Props {
  item: ItemData;
  dimensions: DimensionData[];
  progress: ProgressData;
  navigation: NavigationData;
  userId: string;
}

export function WorkstationClient({
  item,
  dimensions,
  progress,
  navigation,
}: Props) {
  const router = useRouter();
  const [videoMetrics, setVideoMetrics] = useState<VideoMetrics>({
    watchRatio: 0,
    dwellStartTime: Date.now(),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (scores: ScoreInput[], comment: string) => {
      setSubmitting(true);
      setError(null);

      const dwellTimeMs = Date.now() - videoMetrics.dwellStartTime;

      const result = await submitEvaluation({
        itemId: item.id,
        scores,
        comment,
        watchRatio: videoMetrics.watchRatio,
        dwellTimeMs,
      });

      if (!result.success) {
        setError(result.error ?? "提交失败");
        setSubmitting(false);
        return;
      }

      if (result.nextItemId) {
        router.push(`/workstation/${result.nextItemId}`);
      } else {
        router.push("/tasks");
      }
    },
    [item.id, videoMetrics, router]
  );

  return (
    <div className="flex h-full flex-col">
      {/* ─── Top Bar ─── */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-3">
          <Badge variant="outline">
            {progress.current}/{progress.total}
          </Badge>
          <span className="text-xs text-muted-foreground">
            ⌨ 1-5 评分 · Space 播放/暂停 · Enter 提交
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/tasks")}
        >
          退出评测
        </Button>
      </header>

      {/* ─── Main Content (scrollable) ─── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-4">
          {/* ─── Prompt + Dimension Info (horizontal) ─── */}
          <div className="flex gap-4">
            <div className="flex-[65] rounded-lg border bg-card p-4">
              <p className="text-sm font-medium text-foreground">
                {item.promptZh}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.promptEn}
              </p>
            </div>
            <div className="flex-[35] rounded-lg border bg-card p-4">
              <div className="text-xs font-medium text-muted-foreground">
                当前维度概览
              </div>
              <div className="mt-2 space-y-1">
                {dimensions.slice(0, 3).map((d) => (
                  <div key={d.id} className="text-xs">
                    <span className="font-mono text-primary">{d.code}</span>{" "}
                    <span className="text-foreground">{d.nameZh}</span>
                  </div>
                ))}
                {dimensions.length > 3 && (
                  <div className="text-xs text-muted-foreground">
                    +{dimensions.length - 3} 个维度
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Video Player ─── */}
          <VideoPlayer
            url={item.videoUrl}
            onMetricsUpdate={setVideoMetrics}
          />

          {/* ─── Scoring Panel ─── */}
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <ScoringPanel
            dimensions={dimensions}
            onSubmit={handleSubmit}
            submitting={submitting}
          />
        </div>
      </div>

      {/* ─── Bottom Bar ─── */}
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
          ← 上一题
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
          下一题 →
        </Button>
      </footer>
    </div>
  );
}
