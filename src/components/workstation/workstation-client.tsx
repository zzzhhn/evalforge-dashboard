"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { VideoPlayer, type VideoMetrics } from "./video-player";
import { ScoringPanel } from "./scoring-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { submitEvaluation } from "@/app/(main)/workstation/[itemId]/action";
import { syncWatchProgress } from "@/app/(main)/workstation/[itemId]/sync-watch";
import { fetchWorkstationItem } from "@/app/(main)/workstation/[itemId]/fetch-item";
import { useLocale } from "@/lib/i18n/context";

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
  l1Code: string;
  l1Label: string;
  status: string;
}

interface Props {
  packageId?: string | null;
  item: ItemData;
  dimension: DimensionData;
  dimensionHierarchy: DimensionHierarchy;
  progress: ProgressData;
  navigation: NavigationData;
  antiCheat: AntiCheatProps;
  dimensionFilters: DimensionFilter[];
  videoList: VideoListItem[];
  hideModel: boolean;
  serverWatchProgress?: number[] | null;
  itemVersion?: number;
  existingScore?: { value: number; failureTags: string[]; comment: string } | null;
}

// ── Component ──

// No constants needed — video list is portaled into the sidebar

export function WorkstationClient({
  packageId,
  item: initialItem,
  dimension: initialDimension,
  dimensionHierarchy: initialDimHierarchy,
  progress: initialProgress,
  antiCheat,
  dimensionFilters,
  videoList: initialVideoList,
  hideModel,
  serverWatchProgress: initialWatchProgress,
  itemVersion,
  existingScore: initialExistingScore,
}: Props) {
  const router = useRouter();
  const { locale, t } = useLocale();

  // ── SPA state: item-specific data that swaps on navigation ──
  const [item, setItem] = useState(initialItem);
  const [dimension, setDimension] = useState(initialDimension);
  const [dimensionHierarchy, setDimensionHierarchy] = useState(initialDimHierarchy);
  const [progress, setProgress] = useState(initialProgress);
  const [currentExistingScore, setCurrentExistingScore] = useState(initialExistingScore);
  const [currentWatchProgress, setCurrentWatchProgress] = useState(initialWatchProgress);
  const [currentAntiCheatRatio, setCurrentAntiCheatRatio] = useState(antiCheat.minWatchRatio);
  const [videoList, setVideoList] = useState(initialVideoList);
  const [navigating, setNavigating] = useState(false);

  // Restore persisted watch progress: prefer server data, fallback to sessionStorage
  const storageKey = `watch_${item.id}`;
  const savedSeconds = useMemo(() => {
    if (currentWatchProgress && currentWatchProgress.length > 0) return currentWatchProgress;
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  }, [storageKey, currentWatchProgress]);

  const [videoMetrics, setVideoMetrics] = useState<VideoMetrics>(() => ({
    watchRatio: 0,
    dwellStartTime: Date.now(),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [dimFilter, setDimFilter] = useState<string>("ALL");
  const [jumpValue, setJumpValue] = useState("");
  const [jumpMatch, setJumpMatch] = useState<{ count: number; targetId: string | null }>({ count: 0, targetId: null });
  // Server sync state (version for optimistic concurrency)
  const versionRef = useRef(itemVersion ?? 1);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSecondsRef = useRef<number[] | null>(null);

  // Prefetch cache for adjacent items. Keyed by item id; stores the full
  // `fetchWorkstationItem` response so navigation becomes instant for the
  // pre-warmed items. Small cap (8) so memory stays bounded on long
  // sessions — evicts oldest on overflow.
  const prefetchCacheRef = useRef<
    Map<string, Awaited<ReturnType<typeof fetchWorkstationItem>>>
  >(new Map());
  // Track URLs we've asked the browser to preload, to avoid repeatedly
  // injecting <link rel="preload"> for the same asset.
  const mediaPrewarmedRef = useRef<Set<string>>(new Set());

  // ── SPA navigation: fetch new item data without full page reload ──
  const navigateTo = useCallback(
    async (targetId: string) => {
      if (targetId === item.id || navigating) return;
      // Flush any pending watch progress before leaving
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      const seconds = pendingSecondsRef.current;
      if (seconds) {
        pendingSecondsRef.current = null;
        syncWatchProgress(item.id, seconds, versionRef.current);
      }

      setNavigating(true);
      try {
        // Cache hit: prefetched data is already populated by the adjacent-
        // item warming effect, so swap state synchronously with no
        // network wait. This is what makes arrow-key nav feel instant.
        const cached = prefetchCacheRef.current.get(targetId);
        const data =
          cached ??
          (await Promise.race([
            fetchWorkstationItem(targetId, packageId),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
          ]));
        if (!data) {
          // Fallback to hard navigation if fetch fails or times out
          const pkgSuffix = packageId ? `?pkg=${packageId}` : "";
          router.push(`/workstation/${targetId}${pkgSuffix}`);
          return;
        }

        // Update URL without triggering Next.js navigation
        const pkgSuffix = packageId ? `?pkg=${packageId}` : "";
        window.history.pushState(null, "", `/workstation/${targetId}${pkgSuffix}`);

        // Swap all item state
        setItem(data.item);
        setDimension(data.dimension);
        setDimensionHierarchy(data.dimensionHierarchy);
        setProgress(data.progress);
        setCurrentExistingScore(data.existingScore);
        setCurrentWatchProgress(data.serverWatchProgress);
        setCurrentAntiCheatRatio(data.antiCheatMinWatchRatio);
        versionRef.current = data.itemVersion;

        // Update sidebar item statuses
        setVideoList((prev) =>
          prev.map((v) =>
            v.id === item.id && item.status !== "COMPLETED"
              ? { ...v, status: "COMPLETED" }
              : v
          )
        );

        // Reset per-item state
        setVideoMetrics({ watchRatio: 0, dwellStartTime: Date.now() });
        setSubmitting(false);
        setError(null);
        setJumpValue("");
      } finally {
        setNavigating(false);
      }
    },
    [item.id, navigating, router]
  );

  const flushSync = useCallback(() => {
    const seconds = pendingSecondsRef.current;
    if (!seconds) return;
    pendingSecondsRef.current = null;
    syncWatchProgress(item.id, seconds, versionRef.current).then((res) => {
      if (res.success) versionRef.current = res.version;
    });
  }, [item.id]);

  const handleWatchedUpdate = useCallback((seconds: number[]) => {
    // Always persist to sessionStorage immediately
    try { sessionStorage.setItem(storageKey, JSON.stringify(seconds)); } catch { /* quota */ }
    // Debounced server sync (every 5 seconds)
    pendingSecondsRef.current = seconds;
    if (!syncTimerRef.current) {
      syncTimerRef.current = setTimeout(() => {
        syncTimerRef.current = null;
        flushSync();
      }, 5000);
    }
  }, [storageKey, flushSync]);

  // Flush pending sync on unmount (navigation away)
  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      flushSync();
    };
  }, [flushSync]);

  // Portal target for video list in sidebar
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.getElementById("sidebar-video-list"));
  }, []);

  // Dismiss error dialog with Enter or Escape
  useEffect(() => {
    if (!error) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setError(null);
      }
    };
    // Use capture phase to fire before ScoringPanel's document handler
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [error]);

  // Watch progress: skip requirement for re-scoring (already watched previously)
  const isRescore = item.status === "COMPLETED";
  const watchSatisfied = isRescore || videoMetrics.watchRatio >= currentAntiCheatRatio;

  // Filtered video list
  const filteredVideoList = useMemo(() => {
    if (dimFilter === "ALL") return videoList;
    return videoList.filter((v) => v.l1Code === dimFilter);
  }, [videoList, dimFilter]);

  const handleSubmit = useCallback(
    async (score: number, failureTags: string[], comment: string) => {
      if (!watchSatisfied) {
        setError(t("ws.watchFirst"));
        return;
      }

      setSubmitting(true);
      setError(null);

      const dwellTimeMs = Date.now() - videoMetrics.dwellStartTime;
      const payload = {
        itemId: item.id,
        scores: [{ dimensionId: dimension.id, value: score, failureTags }],
        comment,
        watchRatio: videoMetrics.watchRatio,
        dwellTimeMs,
        packageId,
      };

      // Retry with timeout: up to 3 attempts, 12s timeout each
      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 12_000;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await Promise.race([
            submitEvaluation(payload),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)
            ),
          ]);

          if (!result.success) {
            setError(result.error ?? t("ws.submitFailed"));
            setSubmitting(false);
            return;
          }

          // Success — navigate to next
          if (result.nextItemId) {
            navigateTo(result.nextItemId);
          } else {
            router.push("/tasks");
          }
          return;
        } catch (err) {
          const isTimeout = err instanceof Error && err.message === "timeout";
          if (attempt < MAX_RETRIES) {
            // Brief pause before retry (exponential: 1s, 2s)
            await new Promise((r) => setTimeout(r, attempt * 1000));
            continue;
          }
          // All retries exhausted
          setError(
            isTimeout
              ? (locale === "zh" ? "网络超时，请检查网络后重试" : "Network timeout, please retry")
              : (locale === "zh" ? "提交失败，请重试" : "Submit failed, please retry")
          );
          setSubmitting(false);
        }
      }
    },
    [item.id, dimension.id, videoMetrics, router, t, locale, watchSatisfied, navigateTo]
  );

  // Validate jump input: match by index number or externalId substring
  const validateJump = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return { count: 0, targetId: null };

      // Try numeric index first
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && String(num) === trimmed && num >= 1 && num <= videoList.length) {
        return { count: 1, targetId: videoList[num - 1].id };
      }

      // Search by externalId (case-insensitive substring)
      const lower = trimmed.toLowerCase();
      const matches = videoList.filter((v) =>
        v.externalId.toLowerCase().includes(lower)
      );
      if (matches.length === 1) {
        return { count: 1, targetId: matches[0].id };
      }
      return { count: matches.length, targetId: null };
    },
    [videoList]
  );

  // Debounced validation
  useEffect(() => {
    if (!jumpValue.trim()) {
      setJumpMatch({ count: 0, targetId: null });
      return;
    }
    const timer = setTimeout(() => {
      setJumpMatch(validateJump(jumpValue));
    }, 200);
    return () => clearTimeout(timer);
  }, [jumpValue, validateJump]);

  const handleJump = () => {
    const result = validateJump(jumpValue);
    if (result.targetId && result.targetId !== item.id) {
      navigateTo(result.targetId);
    }
  };

  // Filter-aware prev/next navigation (respects dimension filter)
  const filterNav = useMemo(() => {
    const idx = filteredVideoList.findIndex((v) => v.id === item.id);
    return {
      prevItemId: idx > 0 ? filteredVideoList[idx - 1].id : null,
      nextItemId: idx >= 0 && idx < filteredVideoList.length - 1 ? filteredVideoList[idx + 1].id : null,
    };
  }, [filteredVideoList, item.id]);

  // ── Prefetch adjacent items + warm browser media cache ─────────────
  // Fires every time the current item changes. Does three things in the
  // background via requestIdleCallback (falls back to setTimeout):
  //   1. Fetches the full ItemData for prev + next ids into
  //      `prefetchCacheRef` so navigateTo can skip the network wait.
  //   2. Injects <link rel="preload" as="video"> for the next/prev video
  //      URLs once their ItemData arrives — primes the HTTP cache so
  //      the <video> element doesn't block on first byte.
  //   3. Same for sourceImage via new Image() — cheap, works across
  //      browsers, caches the decoded pixels too.
  //
  // Cache is capped at 8 entries; oldest-in wins eviction. Keeps memory
  // tiny even across hundreds of navigations in one session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const idsToPrefetch: string[] = [];
    if (filterNav.prevItemId) idsToPrefetch.push(filterNav.prevItemId);
    if (filterNav.nextItemId) idsToPrefetch.push(filterNav.nextItemId);
    if (idsToPrefetch.length === 0) return;

    const CACHE_CAP = 8;
    const cache = prefetchCacheRef.current;
    const warmed = mediaPrewarmedRef.current;

    const schedule = (fn: () => void) => {
      const win = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof win.requestIdleCallback === "function") {
        win.requestIdleCallback(fn, { timeout: 1500 });
      } else {
        setTimeout(fn, 250);
      }
    };

    let cancelled = false;
    schedule(async () => {
      for (const id of idsToPrefetch) {
        if (cancelled || cache.has(id)) continue;
        try {
          const data = await fetchWorkstationItem(id, packageId);
          if (cancelled || !data) continue;
          cache.set(id, data);
          // Bound the cache; evict FIFO.
          while (cache.size > CACHE_CAP) {
            const firstKey = cache.keys().next().value;
            if (firstKey != null) cache.delete(firstKey);
            else break;
          }
          // Warm the video bytes via <link rel="preload">. Inserting the
          // element triggers a network fetch in the background with
          // correct credentials/CORS; the subsequent <video> tag's
          // request hits the browser's disk cache instead.
          const videoUrl = data.item.videoUrl;
          if (videoUrl && !warmed.has(videoUrl)) {
            warmed.add(videoUrl);
            const link = document.createElement("link");
            link.rel = "preload";
            link.as = "video";
            link.href = videoUrl;
            link.crossOrigin = "anonymous";
            document.head.appendChild(link);
          }
          // Warm the starting-frame image (I2V only).
          const imgUrl = data.item.sourceImage;
          if (imgUrl && !warmed.has(imgUrl)) {
            warmed.add(imgUrl);
            const img = new Image();
            img.decoding = "async";
            img.src = imgUrl;
          }
        } catch {
          // Silent — prefetch is an optimization, not critical path.
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filterNav.prevItemId, filterNav.nextItemId, packageId]);

  // Keyboard: Arrow Up/Down to navigate prev/next within filtered list
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "ArrowUp" && filterNav.prevItemId) {
        e.preventDefault();
        navigateTo(filterNav.prevItemId);
      } else if (e.key === "ArrowDown" && filterNav.nextItemId) {
        e.preventDefault();
        navigateTo(filterNav.nextItemId);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [filterNav.prevItemId, filterNav.nextItemId, navigateTo]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      const match = window.location.pathname.match(/\/workstation\/(.+)$/);
      if (match && match[1] !== item.id) {
        navigateTo(match[1]);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [item.id, navigateTo]);

  const dh = dimensionHierarchy;

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <header className="flex h-9 shrink-0 items-center justify-between border-b bg-card px-4">
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
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("ws.shortcuts")}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/tasks")}>
          {t("ws.exitEval")}
        </Button>
      </header>

      {/* ── Main content: Prompt → Video → Scoring (viewport fit, NO scroll) ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
          {/* Prompt + Dimension + Model info (single card) */}
          <div className="shrink-0 border-b px-4 py-1.5">
            {item.sourceImage && (
              <div className="float-left mr-3">
                <img
                  src={item.sourceImage}
                  alt="Start frame"
                  // 16:9 frame (matches video output aspect) with
                  // object-contain so the full starting frame is visible
                  // — object-cover was cropping tops/bottoms on vertical
                  // content. bg-muted fills the letterbox area.
                  className="aspect-video w-24 cursor-zoom-in rounded-md border bg-muted object-contain transition-transform hover:scale-105"
                  onClick={() => setZoomedImage(item.sourceImage)}
                />
              </div>
            )}
            <p className="text-sm font-medium text-foreground leading-snug font-prompt">
              {locale === "zh" ? item.promptZh : item.promptEn}
            </p>
            <p className="text-xs text-muted-foreground leading-snug font-prompt">
              {locale === "zh" ? item.promptEn : item.promptZh}
            </p>
            {/* Dimension hierarchy: L1 —— L2 —— L3 */}
            <p className="mt-1 text-xs font-medium text-primary">
              {dh.l1Label}
              {dh.l2Label ? ` —— ${dh.l2Label}` : ""}
              {` —— ${dh.l3Label}`}
            </p>
            {/* Model meta (if not hidden) */}
            {!hideModel && item.modelMeta && (
              <p className="text-[10px] text-muted-foreground">
                {item.modelName} · {item.modelMeta}
              </p>
            )}
          </div>

          {/* Video Player (capped at ~88% of remaining height so scoring stays visible) */}
          <div className="min-h-0 px-4 py-0.5" style={{ flex: "8 1 0%" }}>
            <VideoPlayer
              key={item.id}
              url={item.videoUrl}
              initialWatchedSeconds={savedSeconds}
              onMetricsUpdate={setVideoMetrics}
              onWatchedUpdate={handleWatchedUpdate}
            />
          </div>

          {/* Watch warning dialog — shown only when user submits too early */}
          {error && (
            <div
              data-watch-dialog
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            >
              <div className="mx-4 w-full max-w-sm rounded-lg border bg-card p-5 shadow-xl">
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  {error}
                </p>
                {!watchSatisfied && (
                  <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-amber-200/30">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all"
                      style={{ width: `${Math.min(videoMetrics.watchRatio / currentAntiCheatRatio * 100, 100)}%` }}
                    />
                  </div>
                )}
                <button
                  autoFocus
                  onClick={() => setError(null)}
                  className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {locale === "zh" ? "知道了" : "Got it"}
                </button>
              </div>
            </div>
          )}

        {/* Scoring panel — flex-[1] guarantees space reservation */}
        <div className="px-4 pb-1" style={{ flex: "1 0 auto" }}>
          <ScoringPanel
            key={item.id}
            dimension={dimension}
            onSubmit={handleSubmit}
            submitting={submitting}
            existingScore={currentExistingScore ?? undefined}
          />
        </div>
      </div>

      {/* ── Footer: Prev / Next, Jump ── */}
      <footer className="flex h-9 shrink-0 items-center justify-between border-t bg-card px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!filterNav.prevItemId || navigating}
            onClick={() => filterNav.prevItemId && navigateTo(filterNav.prevItemId)}
          >
            {t("ws.prevItem")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!filterNav.nextItemId || navigating}
            onClick={() => filterNav.nextItemId && navigateTo(filterNav.nextItemId)}
          >
            {t("ws.nextItem")}
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("ws.jumpTo")}:</span>
          <input
            type="text"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && jumpMatch.targetId && handleJump()}
            className={`h-7 w-28 rounded border bg-background px-1.5 text-center text-sm ${
              jumpValue.trim()
                ? jumpMatch.targetId
                  ? "border-green-500 ring-1 ring-green-500/30"
                  : jumpMatch.count === 0
                    ? "border-red-500 ring-1 ring-red-500/30"
                    : "border-amber-500 ring-1 ring-amber-500/30"
                : ""
            }`}
            placeholder={t("ws.jumpPlaceholder", { current: String(progress.current) })}
          />
          {jumpValue.trim() && (
            <span className={`text-xs font-mono ${
              jumpMatch.targetId ? "text-green-600 dark:text-green-400"
                : jumpMatch.count === 0 ? "text-red-600 dark:text-red-400"
                : "text-amber-600 dark:text-amber-400"
            }`}>
              {jumpMatch.targetId
                ? t("ws.oneMatch")
                : jumpMatch.count > 0
                  ? t("ws.multiMatch", { count: String(jumpMatch.count) })
                  : t("ws.noMatch")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={handleJump}
            disabled={!jumpMatch.targetId}
          >
            Go
          </Button>
          <span className="font-mono text-xs">{t("ws.totalVideos", { count: String(progress.total) })}</span>
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

      {/* Portal: video list into sidebar */}
      {portalTarget && createPortal(
        <div className="flex h-full flex-col">
          {/* Dimension filter */}
          <div className="border-b px-2 py-1.5">
            <select
              value={dimFilter}
              onChange={(e) => setDimFilter(e.target.value)}
              className="h-7 w-full rounded border bg-background px-2 text-xs"
            >
              <option value="ALL">{t("ws.all")} ({videoList.length})</option>
              {dimensionFilters.map((df) => (
                <option key={df.code} value={df.code}>
                  {df.label} ({df.count})
                </option>
              ))}
            </select>
          </div>
          {/* Scrollable video list */}
          <div className="flex-1 overflow-y-auto">
            {filteredVideoList.map((v) => (
              <button
                key={v.id}
                ref={v.id === item.id ? (el) => {
                  if (el) el.scrollIntoView({ block: "center" });
                } : undefined}
                onClick={() => v.id !== item.id && navigateTo(v.id)}
                className={`block w-full border-b px-2 py-1.5 text-left transition-colors ${
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
                <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground line-clamp-2 font-prompt">
                  {v.promptPreview}
                </p>
                <p className="mt-0.5 text-[10px] text-primary/70">
                  {v.l1Label}
                </p>
              </button>
            ))}
          </div>
        </div>,
        portalTarget
      )}
    </div>
  );
}
