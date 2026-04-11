"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { VideoPlayer, type VideoMetrics } from "./video-player";
import { ScoringPanel } from "./scoring-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { submitEvaluation } from "@/app/(main)/workstation/[itemId]/action";
import { useLocale } from "@/lib/i18n/context";
import { ArrowUp, ArrowDown } from "lucide-react";

// ── Interfaces ──

interface ItemData {
  id: string;
  status: string;
  externalId: string;
  videoUrl: string;
  videoDuration: number | null;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType: string;
  sourceImage: string | null;
  modelMeta: string;
}

interface DimensionData {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  anchor: string | null;
  parentNameZh: string | null;
  parentNameEn: string | null;
  parentCode: string | null;
  failureTags: { id: string; labelZh: string; labelEn: string }[];
}

interface DimensionHierarchy {
  l1Label: string;   // e.g. "D1 指令遵循与语义对齐"
  l2Label: string | null; // e.g. "指令类型" (from anchor)
  l3Label: string;   // e.g. "多条件同时满足"
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

interface AntiCheatProps {
  minWatchRatio: number;
}

interface DimensionFilter {
  code: string;
  label: string;  // display label (nameZh already includes code)
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
  antiCheat: AntiCheatProps;
  dimensionFilters: DimensionFilter[];
  videoList: VideoListItem[];
  hideModel: boolean;
}

// ── Component ──

const DEFAULT_RIGHT_WIDTH = 200;
const MIN_RIGHT_WIDTH = 120;
const MAX_RIGHT_FRACTION = 1 / 3;
const MIN_RIGHT_FRACTION = 1 / 9;

export function WorkstationClient({
  item,
  dimension,
  dimensionHierarchy,
  progress,
  navigation,
  antiCheat,
  dimensionFilters,
  videoList,
  hideModel,
}: Props) {
  const router = useRouter();
  const { locale, t } = useLocale();
  // Restore persisted watch progress for this item
  const storageKey = `watch_${item.id}`;
  const savedSeconds = useMemo(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  }, [storageKey]);

  const [videoMetrics, setVideoMetrics] = useState<VideoMetrics>(() => ({
    watchRatio: 0, // will be recalculated by VideoPlayer on mount with initialWatchedSeconds
    dwellStartTime: Date.now(),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [dimFilter, setDimFilter] = useState<string>("ALL");
  const [jumpValue, setJumpValue] = useState("");

  const handleWatchedUpdate = useCallback((seconds: number[]) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(seconds)); } catch { /* quota */ }
  }, [storageKey]);

  // Resizable right sidebar
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = rightWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const containerWidth = containerRef.current?.offsetWidth ?? window.innerWidth;
      const maxW = containerWidth * MAX_RIGHT_FRACTION;
      const minW = Math.max(MIN_RIGHT_WIDTH, containerWidth * MIN_RIGHT_FRACTION);
      const delta = startX - ev.clientX;
      const newWidth = Math.min(maxW, Math.max(minW, startWidth + delta));
      setRightWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [rightWidth]);

  // Watch progress (server enforces exact thresholds; client only shows generic progress)
  const watchSatisfied = videoMetrics.watchRatio >= antiCheat.minWatchRatio;

  // Filtered video list
  const filteredVideoList = useMemo(() => {
    if (dimFilter === "ALL") return videoList;
    return videoList.filter((v) => v.l1Label.startsWith(dimFilter + " "));
  }, [videoList, dimFilter]);

  const handleSubmit = useCallback(
    async (score: number, failureTags: string[], comment: string) => {
      if (!watchSatisfied) {
        setError(
          locale === "zh"
            ? "请先充分观看视频内容再提交评分"
            : "Please watch the video before submitting"
        );
        return;
      }

      setSubmitting(true);
      setError(null);

      const dwellTimeMs = Date.now() - videoMetrics.dwellStartTime;
      const result = await submitEvaluation({
        itemId: item.id,
        scores: [{ dimensionId: dimension.id, value: score, failureTags }],
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
    [item.id, dimension.id, videoMetrics, router, locale, t, watchSatisfied]
  );

  const handleJump = () => {
    const num = parseInt(jumpValue, 10);
    if (isNaN(num) || num < 1 || num > videoList.length) return;
    const target = videoList[num - 1];
    if (target && target.id !== item.id) {
      router.push(`/workstation/${target.id}`);
    }
  };

  // Keyboard: Arrow Up/Down to navigate prev/next video
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowUp" && navigation.prevItemId) {
        e.preventDefault();
        router.push(`/workstation/${navigation.prevItemId}`);
      } else if (e.key === "ArrowDown" && navigation.nextItemId) {
        e.preventDefault();
        router.push(`/workstation/${navigation.nextItemId}`);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigation.prevItemId, navigation.nextItemId, router]);

  const dh = dimensionHierarchy;

  return (
    <div className="flex h-full flex-col">
      {/* Top Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-3">
          <Badge variant={item.taskType === "T2V" ? "default" : "secondary"}>
            {item.taskType}
          </Badge>
          <span className="text-sm font-medium">
            {progress.current}/{progress.total}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {item.externalId}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("ws.shortcuts")}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/tasks")}
        >
          {t("ws.exitEval")}
        </Button>
      </header>

      {/* Three-column layout */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* ── Left Sidebar: Model + Dimension Filter ── */}
        <aside className="hidden w-56 shrink-0 flex-col border-r bg-card/50 lg:flex">
          <div className="overflow-y-auto p-3 space-y-5">
            {/* Model info (conditionally hidden by admin) */}
            {!hideModel && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {locale === "zh" ? "模型" : "MODEL"}
                </div>
                <p className="mt-1 text-sm font-medium text-foreground">{item.modelName}</p>
                {item.modelMeta && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.modelMeta}</p>
                )}
              </div>
            )}

            {/* Dimension filter */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {locale === "zh" ? "维度筛选" : "FILTER BY DIMENSION"}
              </div>
              <div className="mt-2 space-y-0.5">
                <button
                  onClick={() => setDimFilter("ALL")}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                    dimFilter === "ALL"
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span>{locale === "zh" ? "全部" : "All"}</span>
                  <span className="font-mono">({videoList.length})</span>
                </button>
                {dimensionFilters.map((df) => (
                  <button
                    key={df.code}
                    onClick={() => setDimFilter(df.code)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                      dimFilter === df.code
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{df.label}</span>
                    <span className="ml-1 shrink-0 font-mono">({df.count})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── Center: Prompt + Video + Scoring ── */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-3 p-4">
            {/* Prompt row with dimension hierarchy on right */}
            <div className="flex gap-3">
              {/* Prompt */}
              <div className="flex flex-1 gap-3 rounded-lg border bg-card p-3">
                {item.sourceImage && (
                  <img
                    src={item.sourceImage}
                    alt="Start frame"
                    className="h-32 w-32 shrink-0 cursor-zoom-in rounded-md border object-cover transition-transform hover:scale-105"
                    onClick={() => setZoomedImage(item.sourceImage)}
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium italic text-foreground">
                    {locale === "zh" ? item.promptZh : item.promptEn}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {locale === "zh" ? item.promptEn : item.promptZh}
                  </p>
                </div>
              </div>

              {/* Dimension hierarchy card (L1 → L2 → L3 bold) */}
              <div className="w-52 shrink-0 rounded-lg border bg-card p-3 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {locale === "zh" ? "一级维度" : "L1 DIMENSION"}
                </div>
                <div className="text-sm font-medium text-primary">
                  {dh.l1Label}
                </div>
                {dh.l2Label && (
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {locale === "zh" ? "二级分类" : "L2 CATEGORY"}
                    </div>
                    <div className="text-xs text-primary">
                      {dh.l2Label}
                    </div>
                  </>
                )}
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {locale === "zh" ? "三级子类" : "L3 SUB-TYPE"}
                </div>
                <div className="text-sm font-bold text-foreground">
                  {dh.l3Label}
                </div>
              </div>
            </div>

            {/* Video Player */}
            <VideoPlayer
              url={item.videoUrl}
              initialWatchedSeconds={savedSeconds}
              onMetricsUpdate={setVideoMetrics}
              onWatchedUpdate={handleWatchedUpdate}
            />

            {/* Watch ratio indicator */}
            {!watchSatisfied && (
              <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <div className="flex-1">
                  <div className="text-xs text-amber-600 dark:text-amber-400">
                    {locale === "zh"
                      ? "请先充分观看视频内容再提交评分"
                      : "Please watch the video before submitting"}
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/30">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all"
                      style={{ width: `${Math.min(videoMetrics.watchRatio / antiCheat.minWatchRatio * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {/* Scoring */}
            <ScoringPanel
              dimension={dimension}
              onSubmit={handleSubmit}
              submitting={submitting}
            />
          </div>
        </main>

        {/* ── Right Sidebar: Video List (resizable) ── */}
        <div className="relative hidden shrink-0 lg:flex" style={{ width: rightWidth }}>
          {/* Drag handle (positioned on the left edge of the sidebar) */}
          <div
            onMouseDown={handleDragStart}
            className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
          />
          <aside className="flex flex-1 flex-col overflow-hidden border-l bg-card/50">
            <div className="border-b px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {locale === "zh" ? "视频列表" : "VIDEO LIST"}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredVideoList.map((v) => (
                <button
                  key={v.id}
                  onClick={() => v.id !== item.id && router.push(`/workstation/${v.id}`)}
                  className={`block w-full border-b px-3 py-1.5 text-left transition-colors ${
                    v.id === item.id
                      ? "bg-primary/10 border-primary/30"
                      : v.status === "COMPLETED"
                        ? "opacity-50 hover:bg-muted/50"
                        : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${v.id === item.id ? "text-primary" : "text-foreground"}`}>
                      {v.externalId}
                    </span>
                    {v.status === "COMPLETED" && (
                      <span className="text-[10px] text-muted-foreground">✓</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground line-clamp-2">
                    {v.promptPreview}
                  </p>
                  <p className="mt-0.5 text-[10px] text-primary/70">
                    {v.l1Label}
                  </p>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {/* Bottom Bar */}
      <footer className="flex h-12 shrink-0 items-center justify-between border-t bg-card px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!navigation.prevItemId}
            onClick={() =>
              navigation.prevItemId && router.push(`/workstation/${navigation.prevItemId}`)
            }
          >
            <ArrowUp className="mr-1 h-4 w-4" />
            {t("ws.prevItem")}
          </Button>
          <Button variant="default" size="sm" onClick={() => {
            const videoEl = document.querySelector("video");
            if (videoEl) { videoEl.currentTime = 0; videoEl.play().catch(() => {}); }
          }}>
            {t("ws.replay")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!navigation.nextItemId}
            onClick={() =>
              navigation.nextItemId && router.push(`/workstation/${navigation.nextItemId}`)
            }
          >
            {t("ws.nextItem")}
            <ArrowDown className="ml-1 h-4 w-4" />
          </Button>
        </div>

        {/* Jump to */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{locale === "zh" ? "跳转到" : "Jump to"}:</span>
          <input
            type="number"
            min={1}
            max={videoList.length}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJump()}
            className="h-7 w-14 rounded border bg-background px-1.5 text-center text-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            placeholder={String(progress.current)}
          />
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={handleJump}>
            Go
          </Button>
          <span className="font-mono text-xs">{progress.total} {locale === "zh" ? "个视频" : "videos"}</span>
        </div>
      </footer>

      {/* Image lightbox */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setZoomedImage(null)}
        >
          <img
            src={zoomedImage}
            alt="Zoomed start frame"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}
