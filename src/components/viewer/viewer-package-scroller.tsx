"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export interface PackageEntry {
  id: string;
  name: string;
  taskType: string;
  videoCount: number;
}

interface Props {
  packages: PackageEntry[];
  activePackageId: string;
}

/**
 * Horizontal package picker that renders into the topbar via portal.
 *
 * Intent: the boss is browsing one package, sees "这条 prompt 在 Pixverse v6
 * 上长什么样？", and wants to jump to that model without navigating back to
 * the grid. The top strip gives O(1) access to every assigned package, so
 * the comparison loop is "look → arrow → swipe" instead of
 * "back → scroll → click → wait".
 *
 * Rendered via portal into `#topbar-center-slot` to keep the topbar layout
 * concern in the layout file while letting page-scope data flow here.
 */
export function ViewerPackageScroller({ packages, activePackageId }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById("topbar-center-slot"));
  }, []);

  // Auto-scroll the active chip into view on mount / when active changes.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const active = scroller.querySelector<HTMLElement>("[data-active='true']");
    if (active) {
      active.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [activePackageId]);

  if (!target || packages.length === 0) return null;

  return createPortal(
    <div
      ref={scrollerRef}
      className="flex items-center gap-2 overflow-x-auto whitespace-nowrap px-1 [scrollbar-width:thin]"
      role="tablist"
      aria-label="Package picker"
    >
      {packages.map((pkg) => {
        const active = pkg.id === activePackageId;
        return (
          <button
            key={pkg.id}
            type="button"
            data-active={active}
            onClick={() => {
              if (active) return;
              router.push(`/viewer/package/${pkg.id}`);
            }}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <span className="font-medium">{pkg.name}</span>
            <span className="ml-1.5 text-[10px] opacity-70">
              {pkg.taskType} · {pkg.videoCount}
            </span>
          </button>
        );
      })}
    </div>,
    target
  );
}
