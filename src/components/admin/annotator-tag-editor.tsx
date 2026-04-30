"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/context";
import {
  assignTag,
  removeTag,
  confirmSuggestedTag,
  dismissSuggestedTag,
  searchTags,
  createTag,
} from "@/app/(main)/admin/annotators/tag-action";

export interface UserTagRow {
  tagId: string;
  name: string;
  nameEn: string | null;
  source: "MANUAL" | "AUTO_SUGGESTED";
  confidence: number | null;
}

interface TagHit {
  id: string;
  name: string;
  nameEn: string | null;
}

interface Props {
  userId: string;
  tags: UserTagRow[];
}

export function AnnotatorTagEditor({ userId, tags }: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TagHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  // Debounced tag search on query change (only when there's input)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const handle = setTimeout(async () => {
      const res = await searchTags(q, 8);
      if (res.status === "ok") {
        // Exclude tags the user already has
        const existing = new Set(tags.map((tt) => tt.tagId));
        setHits(res.data.filter((tt) => !existing.has(tt.id)));
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query, tags]);

  const handleAssign = async (tagId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await assignTag(userId, tagId);
      if (res.status === "ok") {
        setQuery("");
        setHits([]);
        refresh();
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (tagId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await removeTag(userId, tagId);
      if (res.status === "ok") {
        refresh();
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // Dismiss an AUTO_SUGGESTED tag. Uses the guarded action so we can't
  // accidentally wipe out a MANUAL tag through this path.
  const handleDismissSuggested = async (tagId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await dismissSuggestedTag(userId, tagId);
      if (res.status === "ok") {
        refresh();
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmSuggested = async (tagId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await confirmSuggestedTag(userId, tagId);
      if (res.status === "ok") {
        refresh();
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndAssign = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTag(q);
      if (created.status !== "ok") {
        // If it already exists, tell user to use the search results instead.
        setError(created.message);
        return;
      }
      const assigned = await assignTag(userId, created.data.id);
      if (assigned.status === "ok") {
        setQuery("");
        setHits([]);
        refresh();
      } else {
        setError(assigned.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Existing tags */}
      <div className="flex flex-wrap gap-1">
        {tags.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("admin.annotators.people.noTags")}
          </span>
        ) : (
          tags.map((tg) => {
            const label = locale === "en" && tg.nameEn ? tg.nameEn : tg.name;
            const isSuggested = tg.source === "AUTO_SUGGESTED";
            return (
              <Badge
                key={tg.tagId}
                variant={isSuggested ? "outline" : "secondary"}
                className={`text-xs gap-1 ${isSuggested ? "border-amber-500/50 text-amber-600 dark:text-amber-400" : ""}`}
              >
                <span>{label}</span>
                {isSuggested && tg.confidence != null && (
                  <span className="font-mono opacity-70">
                    {Math.round(tg.confidence * 100)}%
                  </span>
                )}
                {isSuggested && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleConfirmSuggested(tg.tagId)}
                    className="hover:opacity-70"
                    title={locale === "zh" ? "确认此标签" : "Confirm tag"}
                  >
                    ✓
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    isSuggested
                      ? handleDismissSuggested(tg.tagId)
                      : handleRemove(tg.tagId)
                  }
                  className="hover:opacity-70"
                  title={
                    isSuggested
                      ? locale === "zh"
                        ? "驳回推荐"
                        : "Dismiss suggestion"
                      : t("admin.annotators.people.removeTag")
                  }
                >
                  ×
                </button>
              </Badge>
            );
          })
        )}
      </div>

      {/* Search + add */}
      <div className="relative">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("admin.annotators.people.searchTag")}
          className="h-7 text-xs"
        />
        {query.trim() && (
          <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
            {hits.length > 0 ? (
              <ul className="max-h-48 overflow-y-auto py-1">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAssign(hit.id)}
                      className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                    >
                      {hit.name}
                      {hit.nameEn && (
                        <span className="ml-2 text-muted-foreground">({hit.nameEn})</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {locale === "zh" ? "未找到匹配标签" : "No matches"}
              </div>
            )}
            <div className="border-t">
              <button
                type="button"
                disabled={busy}
                onClick={handleCreateAndAssign}
                className="w-full px-3 py-1.5 text-left text-xs text-primary hover:bg-accent disabled:opacity-50"
              >
                + {locale === "zh" ? `创建并分配 "${query.trim()}"` : `Create and assign "${query.trim()}"`}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
    </div>
  );
}
