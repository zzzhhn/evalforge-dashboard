"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface Props {
  href: string;
  label: string;
}

export function BackLinkRefresh({ href, label }: Props) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        router.push(href);
        // Invalidate the Router Cache so the target page re-fetches RSC
        // payloads instead of serving a prefetched / previously-rendered
        // version. Without this, edits made on the current page (e.g.
        // personal info) don't appear after navigating back via <Link>.
        router.refresh();
      }}
    >
      ← {label}
    </Button>
  );
}
