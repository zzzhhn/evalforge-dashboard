"use client";

import {
  useRef,
  useEffect,
  useCallback,
  useImperativeHandle,
  forwardRef,
  useState,
} from "react";
import { useLocale } from "@/lib/i18n/context";

export interface ArenaVideoMetrics {
  watchRatioA: number;
  watchRatioB: number;
  dwellStartTime: number;
}

export interface ArenaVideoPairHandle {
  playBoth: () => void;
  pauseBoth: () => void;
  replayBoth: () => void;
  isPlaying: () => boolean;
}

interface Props {
  urlA: string;
  urlB: string;
  labelA?: string;
  labelB?: string;
  initialWatchedA?: number[];
  initialWatchedB?: number[];
  onMetricsUpdate: (metrics: ArenaVideoMetrics) => void;
  onWatchedUpdate?: (a: number[], b: number[]) => void;
}

function safePlay(video: HTMLVideoElement) {
  const p = video.play();
  if (p) p.catch(() => {});
}

export const ArenaVideoPair = forwardRef<ArenaVideoPairHandle, Props>(
  function ArenaVideoPair(
    {
      urlA,
      urlB,
      labelA,
      labelB,
      initialWatchedA,
      initialWatchedB,
      onMetricsUpdate,
      onWatchedUpdate,
    },
    ref,
  ) {
    const { t } = useLocale();
    const videoARef = useRef<HTMLVideoElement>(null);
    const videoBRef = useRef<HTMLVideoElement>(null);
    const watchedARef = useRef(new Set<number>(initialWatchedA));
    const watchedBRef = useRef(new Set<number>(initialWatchedB));
    const dwellStartRef = useRef(Date.now());
    const [playing, setPlaying] = useState(false);
    const ratiosRef = useRef({ a: 0, b: 0 });
    const autoPlayedRef = useRef(false);

    const reportMetrics = useCallback(() => {
      onMetricsUpdate({
        watchRatioA: ratiosRef.current.a,
        watchRatioB: ratiosRef.current.b,
        dwellStartTime: dwellStartRef.current,
      });
    }, [onMetricsUpdate]);

    const makeTimeUpdateHandler = useCallback(
      (side: "a" | "b") => () => {
        const video = side === "a" ? videoARef.current : videoBRef.current;
        if (!video || !video.duration) return;
        const watched = side === "a" ? watchedARef.current : watchedBRef.current;
        const second = Math.floor(video.currentTime);
        const isNew = !watched.has(second);
        watched.add(second);
        const totalSeconds = Math.ceil(video.duration);
        const ratio = totalSeconds > 0 ? watched.size / totalSeconds : 0;
        ratiosRef.current = { ...ratiosRef.current, [side]: ratio };
        reportMetrics();
        if (isNew && onWatchedUpdate) {
          onWatchedUpdate([...watchedARef.current], [...watchedBRef.current]);
        }
      },
      [reportMetrics, onWatchedUpdate],
    );

    // On mount: emit restored metrics once both videos have durations.
    useEffect(() => {
      const a = videoARef.current;
      const b = videoBRef.current;
      if (!a || !b) return;
      let cancelled = false;

      const tryEmit = () => {
        if (cancelled) return;
        if (!a.duration || !b.duration) return;
        const totalA = Math.ceil(a.duration);
        const totalB = Math.ceil(b.duration);
        ratiosRef.current = {
          a: totalA > 0 ? watchedARef.current.size / totalA : 0,
          b: totalB > 0 ? watchedBRef.current.size / totalB : 0,
        };
        reportMetrics();
      };

      tryEmit();
      a.addEventListener("loadedmetadata", tryEmit, { once: true });
      b.addEventListener("loadedmetadata", tryEmit, { once: true });
      return () => {
        cancelled = true;
        a.removeEventListener("loadedmetadata", tryEmit);
        b.removeEventListener("loadedmetadata", tryEmit);
      };
    }, [reportMetrics]);

    const playBoth = useCallback(() => {
      const a = videoARef.current;
      const b = videoBRef.current;
      if (!a || !b) return;
      safePlay(a);
      safePlay(b);
    }, []);

    // Auto-play + duration matching: once both videos have metadata, align
    // playback rate so the shorter video slows down to finish alongside the
    // longer one (e.g. Kling 2.5 at 5s vs PixVerse v6 at 6s → Kling plays
    // at rate 5/6 ≈ 0.833 so both finish at 6s wall-clock).
    useEffect(() => {
      const a = videoARef.current;
      const b = videoBRef.current;
      if (!a || !b) return;

      autoPlayedRef.current = false;

      const align = () => {
        if (!a.duration || !b.duration) return;
        if (a.duration === b.duration) {
          a.playbackRate = 1;
          b.playbackRate = 1;
        } else if (a.duration < b.duration) {
          a.playbackRate = a.duration / b.duration;
          b.playbackRate = 1;
        } else {
          a.playbackRate = 1;
          b.playbackRate = b.duration / a.duration;
        }
      };

      const tryStart = () => {
        if (autoPlayedRef.current) return;
        if (!a.duration || !b.duration) return;
        align();
        autoPlayedRef.current = true;
        playBoth();
      };

      tryStart();
      a.addEventListener("loadedmetadata", tryStart);
      b.addEventListener("loadedmetadata", tryStart);
      return () => {
        a.removeEventListener("loadedmetadata", tryStart);
        b.removeEventListener("loadedmetadata", tryStart);
      };
    }, [playBoth, urlA, urlB]);

    const pauseBoth = useCallback(() => {
      videoARef.current?.pause();
      videoBRef.current?.pause();
    }, []);

    const replayBoth = useCallback(() => {
      const a = videoARef.current;
      const b = videoBRef.current;
      if (!a || !b) return;
      a.currentTime = 0;
      b.currentTime = 0;
      safePlay(a);
      safePlay(b);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        playBoth,
        pauseBoth,
        replayBoth,
        isPlaying: () => {
          const a = videoARef.current;
          const b = videoBRef.current;
          if (!a || !b) return false;
          return !a.paused || !b.paused;
        },
      }),
      [playBoth, pauseBoth, replayBoth],
    );

    // Track playing state from either video so the overlay control reflects reality.
    useEffect(() => {
      const a = videoARef.current;
      const b = videoBRef.current;
      if (!a || !b) return;
      const update = () => setPlaying(!a.paused || !b.paused);
      const evts = ["play", "pause", "ended"] as const;
      for (const e of evts) {
        a.addEventListener(e, update);
        b.addEventListener(e, update);
      }
      return () => {
        for (const e of evts) {
          a.removeEventListener(e, update);
          b.removeEventListener(e, update);
        }
      };
    }, []);

    const SideLabel = ({ side, label }: { side: "A" | "B"; label?: string }) => (
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            side === "A" ? "bg-sky-400" : "bg-fuchsia-400"
          }`}
        />
        {label ?? side}
      </div>
    );

    return (
      <div className="flex h-full flex-col gap-2">
        <div className="grid min-h-0 flex-1 gap-2 md:grid-cols-2">
          <div className="relative overflow-hidden rounded-lg border bg-black">
            <SideLabel side="A" label={labelA ?? t("arena.leftSide")} />
            <video
              ref={videoARef}
              src={urlA}
              className="h-full w-full object-contain"
              onTimeUpdate={makeTimeUpdateHandler("a")}
              controls
              preload="auto"
            />
          </div>
          <div className="relative overflow-hidden rounded-lg border bg-black">
            <SideLabel side="B" label={labelB ?? t("arena.rightSide")} />
            <video
              ref={videoBRef}
              src={urlB}
              className="h-full w-full object-contain"
              onTimeUpdate={makeTimeUpdateHandler("b")}
              controls
              preload="auto"
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="rounded border px-1.5 py-0.5 font-mono">Space</span>
          <span>{playing ? t("arena.pauseSync") : t("arena.playSync")}</span>
          <span className="mx-1">·</span>
          <button
            type="button"
            onClick={replayBoth}
            className="rounded border px-2 py-0.5 hover:bg-muted/50"
          >
            {t("arena.replayBoth")}
          </button>
        </div>
      </div>
    );
  },
);
