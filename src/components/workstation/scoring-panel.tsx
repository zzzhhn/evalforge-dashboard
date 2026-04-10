"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLocale } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

interface DimensionData {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  anchor: string | null;
  failureTags: { id: string; labelZh: string; labelEn: string }[];
}

interface Props {
  dimension: DimensionData;
  onSubmit: (score: number, failureTags: string[], comment: string) => void;
  submitting: boolean;
}

const SCORE_COLORS: Record<number, string> = {
  1: "bg-red-500 text-white border-red-500",
  2: "bg-orange-500 text-white border-orange-500",
  3: "bg-yellow-500 text-white border-yellow-500",
  4: "bg-lime-500 text-white border-lime-500",
  5: "bg-green-500 text-white border-green-500",
};

const SCORE_LABEL_KEYS: Record<number, TranslationKey> = {
  1: "score.1",
  2: "score.2",
  3: "score.3",
  4: "score.4",
  5: "score.5",
};

export function ScoringPanel({ dimension, onSubmit, submitting }: Props) {
  const { locale, t } = useLocale();
  const [score, setScore] = useState<number | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");

  const needsTags = score !== null && score <= 2 && dimension.failureTags.length > 0;
  const tagsValid = !needsTags || selectedTags.size > 0;
  const canSubmit = score !== null && tagsValid && !submitting;

  useEffect(() => {
    if (score !== null && score > 2) {
      setSelectedTags(new Set());
    }
  }, [score]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    if (score === null) return;
    onSubmit(score, Array.from(selectedTags), comment);
  }, [score, selectedTags, comment, onSubmit]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if (e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        setScore(parseInt(e.key));
      }

      if (e.key === "Enter" && canSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [canSubmit, handleSubmit]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-center gap-3">
          {[1, 2, 3, 4, 5].map((value) => {
            const selected = score === value;
            return (
              <button
                key={value}
                onClick={() => setScore(value)}
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-lg border-2 text-lg font-bold transition-all",
                  selected
                    ? cn(SCORE_COLORS[value], "scale-110 shadow-md")
                    : "border-border text-muted-foreground hover:border-foreground/30"
                )}
              >
                {value}
              </button>
            );
          })}
        </div>
        <div className="flex justify-center gap-3">
          {[1, 2, 3, 4, 5].map((v) => (
            <span key={v} className="w-12 text-center text-[10px] text-muted-foreground">
              {t(SCORE_LABEL_KEYS[v])}
            </span>
          ))}
        </div>

        {needsTags && (
          <div className="animate-in slide-in-from-top-2 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">
              {t("ws.failureTags")}
            </p>
            <div className="flex flex-wrap gap-2">
              {dimension.failureTags.map((tag) => {
                const isSelected = selectedTags.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      isSelected
                        ? "border-destructive bg-destructive text-destructive-foreground"
                        : "border-border text-muted-foreground hover:border-destructive/50 hover:text-foreground"
                    )}
                  >
                    {locale === "zh" ? tag.labelZh : tag.labelEn}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Input
          placeholder={t("ws.comment")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="text-sm"
        />
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full"
          size="lg"
        >
          {submitting ? t("ws.submitting") : t("ws.submitNext")}
        </Button>
      </div>
    </div>
  );
}
