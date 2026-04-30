"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";

interface Props {
  prevId: string | null;
  nextId: string | null;
  currentIndex: number;
  total: number;
}

export function SampleDetailNav({
  prevId,
  nextId,
  currentIndex,
  total,
}: Props) {
  const router = useRouter();
  const { t } = useLocale();
  const [isPending, startTransition] = useTransition();

  // Prefetch neighbor RSC payloads so arrow-key / click nav feels instant.
  useEffect(() => {
    if (prevId) router.prefetch(`/admin/samples/${prevId}`);
    if (nextId) router.prefetch(`/admin/samples/${nextId}`);
  }, [prevId, nextId, router]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      if (e.key === "ArrowLeft" && prevId) {
        e.preventDefault();
        startTransition(() => router.push(`/admin/samples/${prevId}`));
      } else if (e.key === "ArrowRight" && nextId) {
        e.preventDefault();
        startTransition(() => router.push(`/admin/samples/${nextId}`));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prevId, nextId, router]);

  return (
    <section className={`border-t pt-6 transition-opacity ${isPending ? "opacity-60" : ""}`}>
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        {t("admin.samples.nav.title")}
      </h3>
      <div className="flex gap-2">
        {prevId ? (
          <Link href={`/admin/samples/${prevId}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              ← {t("admin.samples.nav.prev")}
            </Button>
          </Link>
        ) : (
          <Button variant="outline" size="sm" disabled className="flex-1">
            ← {t("admin.samples.nav.prev")}
          </Button>
        )}
        {nextId ? (
          <Link href={`/admin/samples/${nextId}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              {t("admin.samples.nav.next")} →
            </Button>
          </Link>
        ) : (
          <Button variant="outline" size="sm" disabled className="flex-1">
            {t("admin.samples.nav.next")} →
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {currentIndex + 1} / {total}
      </p>
    </section>
  );
}
