"use client";

import { useLocale } from "@/lib/i18n/context";
import type { ArenaVerdict } from "@prisma/client";

interface Props {
  onVote: (verdict: ArenaVerdict) => void;
  disabled?: boolean;
  existingVerdict?: ArenaVerdict | null;
  watchSatisfied: boolean;
}

interface ArenaChoice {
  verdict: ArenaVerdict;
  key: "←" | "→" | "↑" | "↓";
  keyCode: string;
  tone: string;
  selectedTone: string;
  labelKey: string;
}

const CHOICES: ArenaChoice[] = [
  {
    verdict: "LEFT_WINS",
    key: "←",
    keyCode: "ArrowLeft",
    tone:
      "border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-500/40 dark:text-sky-300 dark:hover:bg-sky-500/10",
    selectedTone:
      "bg-sky-500 text-white border-sky-500 dark:bg-sky-500 dark:border-sky-400",
    labelKey: "arena.leftBetter",
  },
  {
    verdict: "RIGHT_WINS",
    key: "→",
    keyCode: "ArrowRight",
    tone:
      "border-fuchsia-300 text-fuchsia-700 hover:bg-fuchsia-50 dark:border-fuchsia-500/40 dark:text-fuchsia-300 dark:hover:bg-fuchsia-500/10",
    selectedTone:
      "bg-fuchsia-500 text-white border-fuchsia-500 dark:bg-fuchsia-500 dark:border-fuchsia-400",
    labelKey: "arena.rightBetter",
  },
  {
    verdict: "BOTH_GOOD",
    key: "↑",
    keyCode: "ArrowUp",
    tone:
      "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10",
    selectedTone:
      "bg-emerald-500 text-white border-emerald-500 dark:bg-emerald-500 dark:border-emerald-400",
    labelKey: "arena.bothGood",
  },
  {
    verdict: "BOTH_BAD",
    key: "↓",
    keyCode: "ArrowDown",
    tone:
      "border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10",
    selectedTone:
      "bg-rose-500 text-white border-rose-500 dark:bg-rose-500 dark:border-rose-400",
    labelKey: "arena.bothBad",
  },
];

export function ArenaVotingPanel({
  onVote,
  disabled,
  existingVerdict,
  watchSatisfied,
}: Props) {
  const { t } = useLocale();

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {t("arena.chooseWinner")}
        </p>
        {!watchSatisfied && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {t("arena.watchBothFirst")}
          </p>
        )}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        {CHOICES.map((c) => {
          const isSelected = existingVerdict === c.verdict;
          return (
            <button
              key={c.verdict}
              type="button"
              disabled={disabled}
              onClick={() => onVote(c.verdict)}
              className={`group flex flex-col items-center justify-center rounded-md border-2 px-3 py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                isSelected ? c.selectedTone : c.tone
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={`rounded border px-1.5 font-mono text-xs ${
                    isSelected
                      ? "border-white/40 text-white"
                      : "border-current"
                  }`}
                >
                  {c.key}
                </span>
                <span className="text-sm font-semibold">
                  {t(c.labelKey as Parameters<typeof t>[0])}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const ARENA_KEY_MAP: Record<string, ArenaVerdict> = Object.fromEntries(
  CHOICES.map((c) => [c.keyCode, c.verdict]),
);
