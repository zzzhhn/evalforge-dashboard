"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  url: string;
  sourceImage?: string | null;
}

export function SampleDetailVideo({ url, sourceImage }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Space-key play/pause. HTML5 <video controls> only binds Space when the
  // element is focused; after page load focus stays on <body>, so Space
  // silently scrolls (or does nothing). Bind globally, skip typing targets
  // and the lightbox.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== " " && e.code !== "Space") return;
      if (zoomedImage) return;
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "BUTTON" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const v = videoRef.current;
      if (!v) return;
      e.preventDefault();
      if (v.paused) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomedImage]);

  return (
    <>
      <div className="overflow-hidden rounded-lg border bg-black">
        <video
          ref={videoRef}
          src={url}
          controls
          className="mx-auto max-h-[400px] w-full object-contain"
        />
      </div>

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

      {sourceImage && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Source Image (I2V)
          </p>
          <img
            src={sourceImage}
            alt="Start frame"
            className="h-40 w-40 cursor-zoom-in rounded-lg border object-cover transition-transform hover:scale-105"
            onClick={() => setZoomedImage(sourceImage)}
          />
        </div>
      )}
    </>
  );
}
