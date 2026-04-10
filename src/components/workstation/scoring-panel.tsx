"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ScoreInput } from "@/app/(main)/workstation/[itemId]/action";

interface DimensionData {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  anchor: string | null;
  testPoints: string[] | null;
  failureTags: { id: string; labelZh: string; labelEn: string }[];
}

interface Props {
  dimensions: DimensionData[];
  onSubmit: (scores: ScoreInput[], comment: string) => void;
  submitting: boolean;
}

const SCORE_COLORS: Record<number, string> = {
  1: "bg-red-500 text-white border-red-500",
  2: "bg-orange-500 text-white border-orange-500",
  3: "bg-yellow-500 text-white border-yellow-500",
  4: "bg-lime-500 text-white border-lime-500",
  5: "bg-green-500 text-white border-green-500",
};

const SCORE_LABELS: Record<number, string> = {
  1: "极差",
  2: "较差",
  3: "一般",
  4: "较好",
  5: "优秀",
};

export function ScoringPanel({ dimensions, onSubmit, submitting }: Props) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [selectedTags, setSelectedTags] = useState<Record<string, Set<string>>>({});
  const [comment, setComment] = useState("");
  const [activeDimIndex, setActiveDimIndex] = useState(0);

  const activeDim = dimensions[activeDimIndex];
  const allScored = dimensions.every((d) => scores[d.id] !== undefined);

  // Check if all low-score dimensions have failure tags
  const allTagsValid = dimensions.every((d) => {
    const score = scores[d.id];
    if (score === undefined || score > 2) return true;
    const tags = selectedTags[d.id];
    return tags && tags.size > 0;
  });

  const canSubmit = allScored && allTagsValid && !submitting;

  // Set score for active dimension (immutable update)
  const setScore = useCallback(
    (dimId: string, value: number) => {
      setScores((prev) => ({ ...prev, [dimId]: value }));
      // Clear failure tags when score > 2
      if (value > 2) {
        setSelectedTags((prev) => {
          const next = { ...prev };
          delete next[dimId];
          return next;
        });
      }
    },
    []
  );

  // Toggle failure tag (immutable update)
  const toggleTag = useCallback((dimId: string, tagId: string) => {
    setSelectedTags((prev) => {
      const existing = prev[dimId] ?? new Set<string>();
      const next = new Set(existing);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return { ...prev, [dimId]: next };
    });
  }, []);

  // Keyboard shortcuts: 1-5 for scoring, Tab/Shift+Tab for dimension nav, Enter to submit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      // Number keys 1-5 for scoring
      if (e.key >= "1" && e.key <= "5" && activeDim) {
        e.preventDefault();
        setScore(activeDim.id, parseInt(e.key));
      }

      // Tab / Shift+Tab for dimension navigation
      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          setActiveDimIndex((i) => Math.max(0, i - 1));
        } else {
          setActiveDimIndex((i) => Math.min(dimensions.length - 1, i + 1));
        }
      }

      // Enter to submit
      if (e.key === "Enter" && canSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeDim, canSubmit, dimensions.length, setScore]);

  const handleSubmit = useCallback(() => {
    const scoreInputs: ScoreInput[] = dimensions.map((d) => ({
      dimensionId: d.id,
      value: scores[d.id],
      failureTags: Array.from(selectedTags[d.id] ?? []),
    }));
    onSubmit(scoreInputs, comment);
  }, [dimensions, scores, selectedTags, comment, onSubmit]);

  return (
    <div className="space-y-4">
      {/* ─── Dimension Tabs ─── */}
      <div className="flex flex-wrap gap-1">
        {dimensions.map((d, i) => {
          const scored = scores[d.id] !== undefined;
          const active = i === activeDimIndex;
          return (
            <button
              key={d.id}
              onClick={() => setActiveDimIndex(i)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : scored
                    ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-400"
                    : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {d.code} {scored && `(${scores[d.id]})`}
            </button>
          );
        })}
      </div>

      {/* ─── Active Dimension Info ─── */}
      {activeDim && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-primary">
                {activeDim.code}
              </span>
              <span className="text-sm font-medium">{activeDim.nameZh}</span>
              <span className="text-xs text-muted-foreground">
                {activeDim.nameEn}
              </span>
            </div>
            {activeDim.anchor && (
              <p className="mt-1 text-xs text-muted-foreground">
                锚点: {activeDim.anchor}
              </p>
            )}
          </div>

          {/* ─── Likert Scale ─── */}
          <div className="flex items-center justify-center gap-3">
            {[1, 2, 3, 4, 5].map((value) => {
              const selected = scores[activeDim.id] === value;
              return (
                <button
                  key={value}
                  onClick={() => setScore(activeDim.id, value)}
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
                {SCORE_LABELS[v]}
              </span>
            ))}
          </div>

          {/* ─── Failure Tags (conditional, ≤ 2) ─── */}
          {scores[activeDim.id] !== undefined &&
            scores[activeDim.id] <= 2 &&
            activeDim.failureTags.length > 0 && (
              <div className="animate-in slide-in-from-top-2 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-xs font-medium text-destructive">
                  请选择失败标签（必选）
                </p>
                <div className="flex flex-wrap gap-2">
                  {activeDim.failureTags.map((tag) => {
                    const selected =
                      selectedTags[activeDim.id]?.has(tag.id) ?? false;
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(activeDim.id, tag.id)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs transition-colors",
                          selected
                            ? "border-destructive bg-destructive text-destructive-foreground"
                            : "border-border text-muted-foreground hover:border-destructive/50 hover:text-foreground"
                        )}
                      >
                        {tag.labelZh}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
        </div>
      )}

      {/* ─── Comment + Submit ─── */}
      <div className="space-y-3">
        <Input
          placeholder="备注（可选）"
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
          {submitting
            ? "提交中…"
            : `提交并进入下一题 (${Object.keys(scores).length}/${dimensions.length})`}
        </Button>
      </div>
    </div>
  );
}
