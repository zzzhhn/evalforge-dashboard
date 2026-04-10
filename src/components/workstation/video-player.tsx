"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

export interface VideoMetrics {
  watchRatio: number;
  dwellStartTime: number;
}

interface Props {
  url: string;
  onMetricsUpdate: (metrics: VideoMetrics) => void;
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const;

export function VideoPlayer({ url, onMetricsUpdate }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const watchedRef = useRef(new Set<number>());
  const dwellStartRef = useRef(Date.now());
  const [speed, setSpeed] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);

  // Track watched segments (1-second granularity)
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.duration) return;

    const second = Math.floor(video.currentTime);
    watchedRef.current.add(second);

    const totalSeconds = Math.ceil(video.duration);
    const watchRatio =
      totalSeconds > 0 ? watchedRef.current.size / totalSeconds : 0;

    onMetricsUpdate({
      watchRatio,
      dwellStartTime: dwellStartRef.current,
    });
  }, [onMetricsUpdate]);

  // Keyboard: Space to play/pause
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.target === document.body) {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }, []);

  const changeSpeed = useCallback((newSpeed: number) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = newSpeed;
    }
    setSpeed(newSpeed);
  }, []);

  return (
    <div className="space-y-2">
      {/* Video element */}
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

      {/* Custom controls row */}
      <div className="flex items-center justify-between px-1">
        <Button variant="ghost" size="sm" onClick={togglePlay}>
          {isPlaying ? "⏸ 暂停" : "▶ 播放"}
        </Button>
        <div className="flex items-center gap-1">
          {SPEED_OPTIONS.map((s) => (
            <Button
              key={s}
              variant={speed === s ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => changeSpeed(s)}
            >
              {s}x
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
