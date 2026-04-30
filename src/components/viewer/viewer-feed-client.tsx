"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";

// NOTE: earlier revision rendered an inline range slider above the video for
// jumping within the current package. Removed on user feedback — the topbar
// package picker (ViewerPackageScroller) covers cross-model jumps, and the
// sidebar list already gives O(1) access within a package, so the inline
// slider was redundant visual weight.

interface VideoListEntry {
  id: string;
  index: number;
  externalId: string;
  promptPreview: string;
  modelName: string;
  taskType: string;
  l1Label: string;
}

interface Props {
  assetId: string;
  videoUrl: string;
  sourceImage: string | null;
  prevId: string | null;
  nextId: string | null;
  prevPreloadUrl: string | null;
  nextPreloadUrl: string | null;
  packageId: string;
  videoList: VideoListEntry[];
  currentIndex: number;
}

/**
 * Viewer feed UI: large video player with prev/next navigation.
 *
 * Design choices tailored for "boss browse" use case (NOT annotator scoring):
 * - No watch-ratio enforcement; no anti-cheat events.
 * - Arrow keys + buttons + Space toggle for fast sequential browsing.
 * - RSC prefetch on neighbors + <link rel=preload as=video> with matching
 *   signed URL, so the browser begins buffering the next clip before the
 *   user clicks.
 * - Sidebar portal renders the full package video list as a scrollable
 *   picker (mirrors annotator workstation) so the boss can jump anywhere.
 * - A horizontal range-slider above the video scrubs through siblings by
 *   index for rapid non-sequential browsing.
 */
export function ViewerFeedClient({
  assetId,
  videoUrl,
  sourceImage,
  prevId,
  nextId,
  prevPreloadUrl,
  nextPreloadUrl,
  packageId,
  videoList,
  currentIndex,
}: Props) {
  const router = useRouter();
  const { t, locale } = useLocale();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [isPending, startTransition] = useTransition();

  const navigateTo = (id: string) => {
    if (id === assetId) return;
    startTransition(() => router.push(`/viewer/sample/${id}?pkg=${packageId}`));
  };

  // Prefetch neighbor RSC payloads.
  useEffect(() => {
    if (prevId) router.prefetch(`/viewer/sample/${prevId}?pkg=${packageId}`);
    if (nextId) router.prefetch(`/viewer/sample/${nextId}?pkg=${packageId}`);
  }, [prevId, nextId, packageId, router]);

  // Keyboard navigation + Space toggle (skip typing targets / slider /
  // buttons to preserve default behavior on focused controls).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if ((e.key === " " || e.code === "Space") && !zoomed) {
        const v = videoRef.current;
        if (!v) return;
        e.preventDefault();
        if (v.paused) v.play().catch(() => {});
        else v.pause();
      } else if (e.key === "ArrowLeft" && prevId) {
        e.preventDefault();
        startTransition(() =>
          router.push(`/viewer/sample/${prevId}?pkg=${packageId}`)
        );
      } else if (e.key === "ArrowRight" && nextId) {
        e.preventDefault();
        startTransition(() =>
          router.push(`/viewer/sample/${nextId}?pkg=${packageId}`)
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prevId, nextId, packageId, zoomed, router]);

  // Sidebar portal target
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSidebarTarget(document.getElementById("sidebar-video-list"));
  }, []);

  return (
    <>
      {/* Preload neighbor videos so clicking prev/next starts playing
          immediately rather than waiting on the first byte. */}
      {prevPreloadUrl && (
        <link rel="preload" as="video" href={prevPreloadUrl} />
      )}
      {nextPreloadUrl && (
        <link rel="preload" as="video" href={nextPreloadUrl} />
      )}

      <div
        className={`overflow-hidden rounded-lg border bg-black transition-opacity ${
          isPending ? "opacity-60" : ""
        }`}
      >
        <video
          ref={videoRef}
          src={videoUrl}
          controls
          autoPlay
          preload="auto"
          className="mx-auto max-h-[70vh] w-full object-contain"
        />
      </div>

      {/* Prev / Next row */}
      <div className="flex items-center gap-2">
        {prevId ? (
          <Link
            href={`/viewer/sample/${prevId}?pkg=${packageId}`}
            className="flex-1"
          >
            <Button variant="outline" size="lg" className="w-full">
              ← {t("viewer.prev")}
            </Button>
          </Link>
        ) : (
          <Button variant="outline" size="lg" disabled className="flex-1">
            ← {t("viewer.prev")}
          </Button>
        )}
        {nextId ? (
          <Link
            href={`/viewer/sample/${nextId}?pkg=${packageId}`}
            className="flex-1"
          >
            <Button variant="outline" size="lg" className="w-full">
              {t("viewer.next")} →
            </Button>
          </Link>
        ) : (
          <Button variant="outline" size="lg" disabled className="flex-1">
            {t("viewer.next")} →
          </Button>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {locale === "zh"
          ? "快捷键：← / → 切换，空格播放/暂停"
          : "Shortcuts: ← / → to navigate, Space to play/pause"}
      </p>

      {/* Source image for I2V */}
      {sourceImage && (
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("viewer.sourceImage")}
          </p>
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="block"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceImage}
              alt="Source frame"
              // 16:9 + object-contain: h-40 w-40 + object-cover used to
              // crop panoramic starting frames (I2V_200 set is 16:9).
              className="aspect-video w-64 cursor-zoom-in rounded-lg border bg-muted object-contain transition-transform hover:scale-105"
            />
          </button>
        </div>
      )}

      {/* Image lightbox */}
      {zoomed && sourceImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setZoomed(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceImage}
            alt="Zoomed source frame"
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
          />
        </div>
      )}

      {/* Portal: scrollable video list into sidebar */}
      {sidebarTarget &&
        createPortal(
          <div className="flex h-full flex-col">
            <div className="border-b px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {locale === "zh" ? "视频列表" : "Video List"} ({videoList.length})
            </div>
            <div className="flex-1 overflow-y-auto">
              {videoList.map((v) => {
                const active = v.id === assetId;
                return (
                  <button
                    key={v.id}
                    ref={
                      active
                        ? (el) => {
                            if (el) el.scrollIntoView({ block: "center" });
                          }
                        : undefined
                    }
                    onClick={() => navigateTo(v.id)}
                    className={`block w-full border-b px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "bg-primary/10 border-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-bold ${
                          active ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {v.externalId}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {v.taskType}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 font-prompt text-[11px] leading-tight text-muted-foreground">
                      {v.promptPreview}
                    </p>
                    <p className="mt-0.5 text-[10px] text-primary/70">
                      {v.l1Label || v.modelName}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>,
          sidebarTarget
        )}
    </>
  );
}
