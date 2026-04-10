"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";

export interface VideoMetrics {
  watchRatio: number;
  dwellStartTime: number;
}

interface Props {
  url: string;
  initialWatchedSeconds?: number[];
  onMetricsUpdate: (metrics: VideoMetrics) => void;
  onWatchedUpdate?: (seconds: number[]) => void;
}

function safePlay(video: HTMLVideoElement) {
  const p = video.play();
  if (p) p.catch(() => {});
}

export function VideoPlayer({ url, initialWatchedSeconds, onMetricsUpdate, onWatchedUpdate }: Props) {
  const { t } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const watchedRef = useRef(new Set<number>(initialWatchedSeconds));
  const dwellStartRef = useRef(Date.now());
  const [isPlaying, setIsPlaying] = useState(false);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration) return;

    const second = Math.floor(video.currentTime);
    const isNew = !watchedRef.current.has(second);
    watchedRef.current.add(second);

    const totalSeconds = Math.ceil(video.duration);
    const watchRatio =
      totalSeconds > 0 ? watchedRef.current.size / totalSeconds : 0;

    onMetricsUpdate({
      watchRatio,
      dwellStartTime: dwellStartRef.current,
    });

    if (isNew && onWatchedUpdate) {
      onWatchedUpdate([...watchedRef.current]);
    }
  }, [onMetricsUpdate, onWatchedUpdate]);

  useEffect(() => {
    if (!initialWatchedSeconds?.length) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const emitRestored = () => {
      if (cancelled) return;
      const totalSeconds = Math.ceil(video.duration);
      if (totalSeconds > 0) {
        const watchRatio = watchedRef.current.size / totalSeconds;
        onMetricsUpdate({ watchRatio, dwellStartTime: dwellStartRef.current });
      }
    };

    if (video.duration) {
      emitRestored();
    } else {
      video.addEventListener("loadedmetadata", emitRestored, { once: true });
    }
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", emitRestored);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        safePlay(video);
      } else {
        video.pause();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleReplay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    safePlay(video);
  }, []);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border bg-black">
        <video
          ref={videoRef}
          src={url}
          className="mx-auto max-h-[50vh] w-full object-contain"
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          controls
          preload="metadata"
        />
      </div>

      <div className="flex items-center px-1">
        <Button variant="ghost" size="sm" onClick={handleReplay}>
          {t("ws.replay")}
        </Button>
      </div>
    </div>
  );
}
