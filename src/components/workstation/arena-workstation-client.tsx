"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArenaVideoPair, type ArenaVideoMetrics, type ArenaVideoPairHandle } from "./arena-video-pair";
import { ArenaVotingPanel, ARENA_KEY_MAP } from "./arena-voting-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  submitArenaVerdict,
  syncArenaWatchProgress,
} from "@/app/(main)/workstation/[itemId]/arena-action";
import { fetchArenaItem } from "@/app/(main)/workstation/[itemId]/fetch-arena-item";
import { useLocale } from "@/lib/i18n/context";
import type { ArenaVerdict } from "@prisma/client";

interface ArenaSide {
  assetId: string;
  videoUrl: string;
  durationSec: number | null;
  modelName: string;
  modelMeta: string;
}

interface ItemData {
  id: string;
  status: string;
  externalId: string;
  promptZh: string;
  promptEn: string;
  taskType: string;
  sourceImage: string | null;
  videoA: ArenaSide;
  videoB: ArenaSide;
  verdict: ArenaVerdict | null;
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

interface ArenaListItem {
  id: string;
  index: number;
  externalId: string;
  promptPreview: string;
  l1Code: string;
  l1Label: string;
  status: string;
}

interface Props {
  packageId: string;
  item: ItemData;
  dimensionHierarchy: DimensionHierarchy;
  progress: ProgressData;
  antiCheatMinWatchRatio: number;
  arenaList: ArenaListItem[];
  serverWatchProgressA: number[] | null;
  serverWatchProgressB: number[] | null;
  itemVersion: number;
  hideModel: boolean;
  nextPairUrls: { a: string; b: string } | null;
}

const SYNC_DEBOUNCE_MS = 5000;

export function ArenaWorkstationClient({
  packageId,
  item: initialItem,
  dimensionHierarchy: initialDimHierarchy,
  progress: initialProgress,
  antiCheatMinWatchRatio: initialAntiCheat,
  arenaList: initialList,
  serverWatchProgressA: initialWatchedA,
  serverWatchProgressB: initialWatchedB,
  itemVersion,
  hideModel,
  nextPairUrls,
}: Props) {
  const router = useRouter();
  const { locale, t } = useLocale();

  const [item, setItem] = useState(initialItem);
  const [dimHierarchy, setDimHierarchy] = useState(initialDimHierarchy);
  const [progress, setProgress] = useState(initialProgress);
  const [arenaList, setArenaList] = useState(initialList);
  const [minWatchRatio, setMinWatchRatio] = useState(initialAntiCheat);
  const [watchedA, setWatchedA] = useState<number[]>(initialWatchedA ?? []);
  const [watchedB, setWatchedB] = useState<number[]>(initialWatchedB ?? []);
  const [prefetchUrls, setPrefetchUrls] = useState(nextPairUrls);

  // Bug fix: initialize metrics from already-watched seconds + known durationSec
  // so watchSatisfied reflects server-persisted progress immediately on mount.
  // Previously started at 0 until <video> fired loadedmetadata, creating a
  // false "need to rewatch" window after navigating back to a prior item.
  const [metrics, setMetrics] = useState<ArenaVideoMetrics>(() => {
    const durA = initialItem.videoA.durationSec ?? 0;
    const durB = initialItem.videoB.durationSec ?? 0;
    const watchedASize = initialWatchedA?.length ?? 0;
    const watchedBSize = initialWatchedB?.length ?? 0;
    const ratioA = durA > 0 ? Math.min(1, watchedASize / Math.ceil(durA)) : 0;
    const ratioB = durB > 0 ? Math.min(1, watchedBSize / Math.ceil(durB)) : 0;
    return {
      watchRatioA: ratioA,
      watchRatioB: ratioB,
      dwellStartTime: Date.now(),
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const videoPairRef = useRef<ArenaVideoPairHandle>(null);
  const versionRef = useRef(itemVersion);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWatchRef = useRef<{ a: number[]; b: number[] } | null>(null);

  const storageKey = useMemo(() => `arena_watch_${item.id}`, [item.id]);

  const flushSync = useCallback(() => {
    const pending = pendingWatchRef.current;
    if (!pending) return;
    pendingWatchRef.current = null;
    syncArenaWatchProgress(item.id, pending.a, pending.b, versionRef.current).then(
      (res) => {
        if (res.success) versionRef.current = res.version;
      },
    );
  }, [item.id]);

  const handleWatchedUpdate = useCallback(
    (a: number[], b: number[]) => {
      setWatchedA(a);
      setWatchedB(b);
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ a, b }),
        );
      } catch {
        /* quota */
      }
      pendingWatchRef.current = { a, b };
      if (!syncTimerRef.current) {
        syncTimerRef.current = setTimeout(() => {
          syncTimerRef.current = null;
          flushSync();
        }, SYNC_DEBOUNCE_MS);
      }
    },
    [storageKey, flushSync],
  );

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      flushSync();
    };
  }, [flushSync]);

  // SPA navigation within package
  const navigateTo = useCallback(
    async (targetId: string) => {
      if (targetId === item.id || navigating) return;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      flushSync();

      setNavigating(true);
      try {
        const data = await Promise.race([
          fetchArenaItem(targetId, packageId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
        ]);
        if (!data) {
          router.push(`/workstation/${targetId}?pkg=${packageId}`);
          return;
        }

        window.history.pushState(
          null,
          "",
          `/workstation/${targetId}?pkg=${packageId}`,
        );

        setItem(data.item);
        setDimHierarchy(data.dimensionHierarchy);
        setProgress(data.progress);
        setMinWatchRatio(data.antiCheatMinWatchRatio);
        setArenaList(data.arenaList);
        setWatchedA(data.serverWatchProgressA ?? []);
        setWatchedB(data.serverWatchProgressB ?? []);
        setPrefetchUrls(data.nextPairUrls);
        versionRef.current = data.itemVersion;

        // Mark leaving item as COMPLETED if so
        setArenaList((prev) =>
          prev.map((v) =>
            v.id === item.id && item.status !== "COMPLETED"
              ? { ...v, status: "COMPLETED" }
              : v,
          ),
        );

        // Restore metrics from server-persisted watch progress (same calc as
        // lazy init) so revisiting a partially-watched item doesn't appear
        // "unwatched" until <video> loadedmetadata fires.
        const durA = data.item.videoA.durationSec ?? 0;
        const durB = data.item.videoB.durationSec ?? 0;
        const wA = data.serverWatchProgressA?.length ?? 0;
        const wB = data.serverWatchProgressB?.length ?? 0;
        setMetrics({
          watchRatioA: durA > 0 ? Math.min(1, wA / Math.ceil(durA)) : 0,
          watchRatioB: durB > 0 ? Math.min(1, wB / Math.ceil(durB)) : 0,
          dwellStartTime: Date.now(),
        });
        setSubmitting(false);
        setError(null);
      } finally {
        setNavigating(false);
      }
    },
    [item.id, item.status, navigating, packageId, router, flushSync],
  );

  // Revotable if already completed
  const isRevote = item.status === "COMPLETED";
  const watchSatisfied =
    isRevote ||
    Math.min(metrics.watchRatioA, metrics.watchRatioB) >= minWatchRatio;

  const handleVote = useCallback(
    async (verdict: ArenaVerdict) => {
      if (submitting) return;
      if (!watchSatisfied) {
        setError(t("arena.watchBothFirst"));
        return;
      }
      setSubmitting(true);
      setError(null);

      const dwellTimeMs = Date.now() - metrics.dwellStartTime;
      const payload = {
        itemId: item.id,
        verdict,
        watchRatioA: metrics.watchRatioA,
        watchRatioB: metrics.watchRatioB,
        dwellTimeMs,
      };

      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 12_000;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await Promise.race([
            submitArenaVerdict(payload),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
            ),
          ]);
          if (!result.success) {
            setError(result.error ?? t("arena.submitFailed"));
            setSubmitting(false);
            return;
          }
          if (result.nextItemId) {
            navigateTo(result.nextItemId);
          } else {
            // Bug fix: hard navigation. Previous `router.push("/tasks")` raced
            // with the pushState-based in-package nav — Next.js router cache
            // thought we were still on the initial /workstation URL, so the
            // RSC fetch for /tasks could mis-align and surface an error
            // overlay. window.location.href bypasses the router entirely.
            if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
            flushSync();
            window.location.href = "/tasks";
          }
          return;
        } catch (err) {
          const isTimeout = err instanceof Error && err.message === "timeout";
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, attempt * 1000));
            continue;
          }
          setError(
            isTimeout
              ? locale === "zh"
                ? "网络超时，请重试"
                : "Network timeout, please retry"
              : locale === "zh"
                ? "提交失败，请重试"
                : "Submit failed, please retry",
          );
          setSubmitting(false);
        }
      }
    },
    [item.id, metrics, submitting, watchSatisfied, t, locale, navigateTo, router],
  );

  // Keyboard: arrows = vote, Space = sync play/pause, Enter = disabled (per spec).
  // Capture phase + stopImmediatePropagation to preempt the browser's native
  // Space-toggles-focused-video behaviour when a <video controls> element has
  // focus (otherwise one video toggles individually instead of both syncing).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Enter") {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        e.stopImmediatePropagation();
        // Blur focused video so its native control doesn't also toggle.
        const active = document.activeElement as HTMLElement | null;
        if (active && active.tagName === "VIDEO") active.blur();

        const pair = videoPairRef.current;
        if (!pair) return;
        if (pair.isPlaying()) {
          pair.pauseBoth();
        } else {
          pair.playBoth();
        }
        return;
      }
      const verdict = ARENA_KEY_MAP[e.key];
      if (verdict) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleVote(verdict);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [handleVote]);

  // popstate
  useEffect(() => {
    const handle = () => {
      const match = window.location.pathname.match(/\/workstation\/(.+)$/);
      if (match && match[1] !== item.id) navigateTo(match[1]);
    };
    window.addEventListener("popstate", handle);
    return () => window.removeEventListener("popstate", handle);
  }, [item.id, navigateTo]);

  // Error auto-dismiss on Enter/Escape
  useEffect(() => {
    if (!error) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setError(null);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [error]);

  // Portal target
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.getElementById("sidebar-video-list"));
  }, []);

  // Nav
  const currentIndex = useMemo(
    () => arenaList.findIndex((v) => v.id === item.id),
    [arenaList, item.id],
  );
  const prevId = currentIndex > 0 ? arenaList[currentIndex - 1].id : null;
  const nextId =
    currentIndex >= 0 && currentIndex < arenaList.length - 1
      ? arenaList[currentIndex + 1].id
      : null;

  return (
    <div className="flex h-full flex-col">
      {/* Prefetch next pair's videos so the browser warms its cache while the
          user is still voting on the current pair. Rendered as <link> via
          React 19; served with Range requests so we only grab the initial
          bytes needed to start playback. */}
      {prefetchUrls && (
        <>
          <link rel="prefetch" as="video" href={prefetchUrls.a} />
          <link rel="prefetch" as="video" href={prefetchUrls.b} />
        </>
      )}
      {/* Header */}
      <header className="flex h-9 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400"
          >
            {t("admin.packages.modeArena")}
          </Badge>
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
            {t("arena.shortcutHint")}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/tasks")}>
          {t("ws.exitEval")}
        </Button>
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Prompt + Dimension */}
        <div className="shrink-0 border-b px-4 py-1.5">
          {item.sourceImage && (
            <div className="float-left mr-3">
              <img
                src={item.sourceImage}
                alt="Start frame"
                // 16:9 + object-contain: show whole starting frame
                // without cropping. See workstation-client.tsx for the
                // matching comment on the scoring variant.
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
          <p className="mt-1 text-xs font-medium text-primary">
            {dimHierarchy.l1Label}
            {dimHierarchy.l2Label ? ` —— ${dimHierarchy.l2Label}` : ""}
            {` —— ${dimHierarchy.l3Label}`}
          </p>
          {!hideModel && (
            <p className="text-[10px] text-muted-foreground">
              A: {item.videoA.modelName} · B: {item.videoB.modelName}
            </p>
          )}
        </div>

        {/* Video pair */}
        <div className="min-h-0 px-4 py-2" style={{ flex: "8 1 0%" }}>
          <ArenaVideoPair
            key={item.id}
            ref={videoPairRef}
            urlA={item.videoA.videoUrl}
            urlB={item.videoB.videoUrl}
            initialWatchedA={watchedA}
            initialWatchedB={watchedB}
            onMetricsUpdate={setMetrics}
            onWatchedUpdate={handleWatchedUpdate}
          />
        </div>

        {/* Voting panel */}
        <div className="px-4 pb-2" style={{ flex: "1 0 auto" }}>
          <ArenaVotingPanel
            onVote={handleVote}
            disabled={submitting}
            existingVerdict={item.verdict}
            watchSatisfied={watchSatisfied}
          />
        </div>

        {/* Error dialog */}
        {error && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 w-full max-w-sm rounded-lg border bg-card p-5 shadow-xl">
              <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                {error}
              </p>
              {!watchSatisfied && (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-amber-200/30">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all"
                    style={{
                      width: `${Math.min(
                        (Math.min(metrics.watchRatioA, metrics.watchRatioB) /
                          minWatchRatio) *
                          100,
                        100,
                      )}%`,
                    }}
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
      </div>

      {/* Footer */}
      <footer className="flex h-9 shrink-0 items-center justify-between border-t bg-card px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!prevId || navigating}
            onClick={() => prevId && navigateTo(prevId)}
          >
            {t("ws.prevItem")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!nextId || navigating}
            onClick={() => nextId && navigateTo(nextId)}
          >
            {t("ws.nextItem")}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            {t("ws.totalVideos", { count: String(progress.total) })}
          </span>
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

      {/* Sidebar portal: arena item list */}
      {portalTarget &&
        createPortal(
          <div className="flex h-full flex-col">
            <div className="border-b px-2 py-1.5 text-[11px] text-muted-foreground">
              {t("arena.packageList")} ({arenaList.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {arenaList.map((v) => (
                <button
                  key={v.id}
                  ref={
                    v.id === item.id
                      ? (el) => {
                          if (el) el.scrollIntoView({ block: "center" });
                        }
                      : undefined
                  }
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
                    <span
                      className={`text-xs font-bold ${
                        v.id === item.id ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {v.externalId}
                    </span>
                    {v.status === "COMPLETED" && (
                      <span className="text-[10px] text-muted-foreground">✓</span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground font-prompt">
                    {v.promptPreview}
                  </p>
                  <p className="mt-0.5 text-[10px] text-primary/70">{v.l1Label}</p>
                </button>
              ))}
            </div>
          </div>,
          portalTarget,
        )}
    </div>
  );
}
