"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";
import { RankogramStrip } from "@/components/admin/rankogram-strip";
import type { LeaderboardRow } from "@/app/(main)/admin/annotators/leaderboard-action";

type SortKey = "ability-desc" | "ability-asc" | "ci-narrow" | "samples";

interface SampleAdequacy {
  ok: boolean;
  assessedRaters: number;
  minItemsPerRater: number;
  reason: string | null;
}

interface Props {
  rows: LeaderboardRow[];
  sampleAdequacy?: SampleAdequacy;
  onSelect: (userId: string) => void;
}

/**
 * Full-width leaderboard with percentile-axis forest plot + rankogram.
 * Percentile (0-100) is used directly for the horizontal axis so every row
 * shares the same reference frame. Tier colour coding is consistent across
 * rank badge, avatar ring, interval line, and dot.
 *
 * Click on a row → parent opens the annotator drawer.
 */
export function CalibrationForestSection({
  rows,
  sampleAdequacy,
  onSelect,
}: Props) {
  const { locale } = useLocale();
  const [sort, setSort] = useState<SortKey>("ability-desc");
  const [showUnassessed, setShowUnassessed] = useState(false);

  const visibleRows = useMemo(
    () => (showUnassessed ? rows : rows.filter((r) => r.tier != null)),
    [rows, showUnassessed],
  );
  const sorted = useMemo(() => sortRows(visibleRows, sort), [visibleRows, sort]);
  const unassessedCount = rows.length - rows.filter((r) => r.tier != null).length;

  return (
    <div className="rounded-xl border bg-card/40 px-5 py-5">
      {sampleAdequacy && !sampleAdequacy.ok && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <div className="font-medium">
              {locale === "zh"
                ? "样本量不足，排名置信度低"
                : "Insufficient sample size — rankings are unreliable"}
            </div>
            <div className="mt-0.5 text-[11px] text-amber-600/80 dark:text-amber-400/80">
              {sampleAdequacy.reason === "raters<5"
                ? locale === "zh"
                  ? `当前仅 ${sampleAdequacy.assessedRaters} 位已评估评测员。Bayesian IRT 在 <5 位评测员时识别性较差，α 估计可能抖动，百分位差距可能被放大。建议增加评测员或结合多个校准批次。`
                  : `Only ${sampleAdequacy.assessedRaters} assessed raters. Bayesian IRT is poorly identified below 5 raters; α estimates may be jittery and percentile gaps inflated. Add more raters or pool across batches.`
                : locale === "zh"
                  ? `最少评测员条目数 = ${sampleAdequacy.minItemsPerRater}，低于建议阈值 30。较少的观测数会放大后验不确定性。`
                  : `Minimum items per rater = ${sampleAdequacy.minItemsPerRater}, below the recommended 30. Sparse observations inflate posterior uncertainty.`}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {locale === "zh"
              ? "能力 Forest Plot · α_r 后验均值 ± 95% CI"
              : "Ability Forest Plot · α_r posterior mean ± 95% CI"}
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {locale === "zh"
              ? "每行一位评测员 · 点 = 后验均值 · 横条 = CI · 颜色 = Tier"
              : "One row per annotator · dot = posterior mean · bar = CI · colour = tier"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SortChips sort={sort} onChange={setSort} />
          <button
            type="button"
            onClick={() => setShowUnassessed((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
              showUnassessed
                ? "border-primary/50 bg-primary/10 text-primary"
                : "hover:bg-muted/50"
            }`}
            title={
              locale === "zh"
                ? `${unassessedCount} 位未评估评测员`
                : `${unassessedCount} unassessed annotators`
            }
          >
            {showUnassessed ? (
              <Eye className="h-3.5 w-3.5" />
            ) : (
              <EyeOff className="h-3.5 w-3.5" />
            )}
            {locale === "zh"
              ? `${showUnassessed ? "隐藏" : "显示"}未评估 (${unassessedCount})`
              : `${showUnassessed ? "Hide" : "Show"} unassessed (${unassessedCount})`}
          </button>
        </div>
      </div>

      {/* Column header */}
      <div className="mt-5 grid grid-cols-[40px_220px_1fr_90px_70px] items-center gap-3 border-b pb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div></div>
        <div>{locale === "zh" ? "评测员" : "Annotator"}</div>
        <div className="grid grid-cols-5 px-2">
          <span className="text-left">P0</span>
          <span className="text-center">P25</span>
          <span className="text-center">P50</span>
          <span className="text-center">P75</span>
          <span className="text-right">P100</span>
        </div>
        <div className="text-center">RANKOGRAM</div>
        <div className="text-right">
          {locale === "zh" ? "百分位" : "Pct"}
        </div>
      </div>

      {/* Rows */}
      <div>
        {sorted.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            {locale === "zh"
              ? "暂无评测员数据"
              : "No annotators to display"}
          </div>
        ) : (
          sorted.map((r, i) => (
            <ForestRow
              key={r.userId}
              row={r}
              rank={i + 1}
              total={sorted.length}
              onClick={() => onSelect(r.userId)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ForestRow({
  row,
  rank,
  total,
  onClick,
}: {
  row: LeaderboardRow;
  rank: number;
  total: number;
  onClick: () => void;
}) {
  const { locale } = useLocale();
  const tier = row.tier;

  // Centralised tier palette. Everything (track tint, box, whiskers,
  // thumb, rank chip, pct text) reads from this one source of truth so
  // the visual feels coherent instead of patched together.
  const palette = {
    TIER_1: {
      // rgb() values for inline alpha blending with the gradient track.
      color: "16 185 129", // emerald-500
      textClass: "text-emerald-400",
      gradientFrom: "from-emerald-500/15",
      rankBg: "bg-emerald-500/90",
      ghostText: "text-emerald-400/15",
    },
    TIER_2: {
      color: "56 189 248", // sky-400
      textClass: "text-sky-400",
      gradientFrom: "from-sky-500/15",
      rankBg: "bg-slate-400",
      ghostText: "text-sky-400/15",
    },
    TIER_3: {
      color: "245 158 11", // amber-500
      textClass: "text-amber-400",
      gradientFrom: "from-amber-500/15",
      rankBg: "bg-amber-500",
      ghostText: "text-amber-400/15",
    },
    TIER_4: {
      color: "244 63 94", // rose-500
      textClass: "text-rose-400",
      gradientFrom: "from-rose-500/15",
      rankBg: "bg-rose-500",
      ghostText: "text-rose-400/15",
    },
  }[tier ?? "TIER_3"];

  // Real percentile CI from bootstrap if present, else derive a symmetric
  // interval around rankPercentile from alpha CI in logit space as a
  // conservative fallback for rows that preceded the bootstrap pass.
  const hasPosterior =
    row.rankPercentile != null &&
    row.alphaCILow != null &&
    row.alphaCIHigh != null &&
    row.alphaMean != null;
  let ciLowPct = 0;
  let ciHighPct = 100;
  if (hasPosterior) {
    if (row.percentileCILow != null && row.percentileCIHigh != null) {
      ciLowPct = row.percentileCILow;
      ciHighPct = row.percentileCIHigh;
    } else {
      const logitWidth = (row.alphaCIHigh as number) - (row.alphaCILow as number);
      const half = Math.max(2, Math.min(40, (logitWidth / 2) * 22));
      ciLowPct = Math.max(0, (row.rankPercentile as number) - half);
      ciHighPct = Math.min(100, (row.rankPercentile as number) + half);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[40px_220px_1fr_90px_70px] items-center gap-3 border-b border-border/40 px-0 py-3 text-left transition-colors hover:bg-muted/30"
    >
      {/* Rank badge */}
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-md font-mono text-xs font-semibold text-white ${palette.rankBg}`}
      >
        {rank}
      </div>

      {/* Avatar + name + org */}
      <div className="flex items-center gap-2.5 overflow-hidden">
        <AvatarBadge initials={row.avatarInitials} tier={tier} />
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{row.name}</span>
            {tier && <TierMiniChip tier={tier} />}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {row.groupName ?? (locale === "zh" ? "未分组" : "No group")}
            {row.accountType === "INTERNAL"
              ? locale === "zh"
                ? " · 内部"
                : " · Internal"
              : locale === "zh"
                ? " · 外包"
                : " · Vendor"}
          </div>
        </div>
      </div>

      {/* Forest track — replicates the reference Claude Design Bold UI
          exactly. 24px-tall gradient track with rose/amber/sky/emerald
          tint from P0 to P100, three hairline grid lines at P25/P50/P75,
          a thin 3px translucent CI bar, 2×10px whisker caps at each end,
          and a 12px posterior-mean dot with card-coloured cutout border
          plus tier-coloured outer ring. All geometry from the reference
          CSS at components/annotator-mgmt.js + legacy Admin.html. */}
      <div
        className="relative h-6 rounded-[4px]"
        style={{
          background:
            "linear-gradient(to right, " +
            "color-mix(in oklab, rgb(244 63 94) 8%, transparent) 0%, " +
            "color-mix(in oklab, rgb(245 158 11) 8%, transparent) 25%, " +
            "color-mix(in oklab, rgb(56 189 248) 8%, transparent) 50%, " +
            "color-mix(in oklab, rgb(16 185 129) 8%, transparent) 75%, " +
            "color-mix(in oklab, rgb(16 185 129) 12%, transparent) 100%)",
        }}
      >
        {/* Vertical hairline grid at 25 / 50 / 75 — these anchor the eye
            to percentile gradations even when the CI spans a narrow arc. */}
        <div className="pointer-events-none absolute inset-0">
          {[25, 50, 75].map((p) => (
            <div
              key={p}
              className="absolute bottom-0 top-0 w-px"
              style={{
                left: `${p}%`,
                background:
                  "color-mix(in oklab, var(--border) 90%, transparent)",
              }}
            />
          ))}
        </div>

        {hasPosterior ? (
          <>
            {/* CI interval — 3px translucent horizontal line */}
            <div
              className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-[2px]"
              style={{
                left: `${ciLowPct}%`,
                right: `${100 - ciHighPct}%`,
                backgroundColor: `rgb(${palette.color})`,
                opacity: 0.35,
              }}
              title={`α_r = ${(row.alphaMean as number).toFixed(2)} · CI [${(row.alphaCILow as number).toFixed(2)}, ${(row.alphaCIHigh as number).toFixed(2)}] · pct [${ciLowPct.toFixed(0)}, ${ciHighPct.toFixed(0)}]`}
            />

            {/* Left whisker cap — 2px × 10px vertical */}
            <div
              className="absolute top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${ciLowPct}%`,
                backgroundColor: `rgb(${palette.color})`,
                opacity: 0.55,
              }}
            />
            {/* Right whisker cap */}
            <div
              className="absolute top-1/2 h-[10px] w-[2px] -translate-x-1/2 -translate-y-1/2"
              style={{
                left: `${ciHighPct}%`,
                backgroundColor: `rgb(${palette.color})`,
                opacity: 0.55,
              }}
            />

            {/* Posterior-mean dot — 12px circle, card-coloured 2px inner
                cutout border + tier-coloured 1px outer ring. This is what
                gives the reference design its "chip" look instead of the
                earlier scrubber-bar visual. */}
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${row.rankPercentile}%`,
                backgroundColor: `rgb(${palette.color})`,
                border: "2px solid var(--card)",
                boxShadow: `0 0 0 1px rgb(${palette.color})`,
              }}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            {locale === "zh" ? "未评估" : "Unassessed"}
          </div>
        )}
      </div>

      {/* Rankogram — real posterior bins when available */}
      <div className="flex justify-center">
        <RankogramStrip
          bins={row.rankogramBins ?? null}
          rankPercentile={row.rankPercentile}
          total={total}
          tintClass={
            {
              TIER_1: "bg-emerald-400/70",
              TIER_2: "bg-sky-400/70",
              TIER_3: "bg-amber-400/70",
              TIER_4: "bg-rose-400/70",
            }[tier ?? "TIER_3"]
          }
        />
      </div>

      {/* Definitive percentile number */}
      <div
        className={`text-right font-mono text-lg font-semibold tabular-nums ${row.tier ? palette.textClass : "text-muted-foreground"}`}
      >
        {row.rankPercentile != null ? (
          <>
            {row.rankPercentile.toFixed(0)}
            <span className="text-[10px] text-muted-foreground">/100</span>
          </>
        ) : (
          "—"
        )}
      </div>
    </button>
  );
}


function AvatarBadge({
  initials,
  tier,
}: {
  initials: string;
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null;
}) {
  const ring = {
    TIER_1: "ring-emerald-500/60 bg-emerald-500/20 text-emerald-400",
    TIER_2: "ring-sky-500/60 bg-sky-500/20 text-sky-400",
    TIER_3: "ring-amber-500/60 bg-amber-500/20 text-amber-400",
    TIER_4: "ring-rose-500/60 bg-rose-500/20 text-rose-400",
  }[tier ?? "TIER_2"];
  return (
    <div
      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ${ring}`}
    >
      {initials}
    </div>
  );
}

function TierMiniChip({
  tier,
}: {
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";
}) {
  const cls = {
    TIER_1: "bg-emerald-500/15 text-emerald-500",
    TIER_2: "bg-sky-500/15 text-sky-500",
    TIER_3: "bg-amber-500/15 text-amber-500",
    TIER_4: "bg-rose-500/15 text-rose-500",
  }[tier];
  const label = { TIER_1: "T1", TIER_2: "T2", TIER_3: "T3", TIER_4: "T4" }[
    tier
  ];
  return (
    <span
      className={`rounded px-1.5 py-px text-[9px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function SortChips({
  sort,
  onChange,
}: {
  sort: SortKey;
  onChange: (k: SortKey) => void;
}) {
  const { locale } = useLocale();
  const options: { key: SortKey; label: string }[] = [
    { key: "ability-desc", label: locale === "zh" ? "能力 高→低" : "Ability ↓" },
    { key: "ability-asc", label: locale === "zh" ? "能力 低→高" : "Ability ↑" },
    { key: "ci-narrow", label: locale === "zh" ? "CI 宽→窄" : "CI wide→narrow" },
    { key: "samples", label: locale === "zh" ? "样本量" : "Sample size" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
            sort === o.key
              ? "border-primary bg-primary/10 text-primary"
              : "hover:bg-muted/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function sortRows(rows: LeaderboardRow[], key: SortKey): LeaderboardRow[] {
  const copy = [...rows];
  switch (key) {
    case "ability-desc":
      return copy.sort(
        (a, b) => (b.alphaMean ?? -Infinity) - (a.alphaMean ?? -Infinity),
      );
    case "ability-asc":
      return copy.sort(
        (a, b) => (a.alphaMean ?? Infinity) - (b.alphaMean ?? Infinity),
      );
    case "ci-narrow":
      return copy.sort((a, b) => {
        const wa =
          a.alphaCIHigh != null && a.alphaCILow != null
            ? a.alphaCIHigh - a.alphaCILow
            : Infinity;
        const wb =
          b.alphaCIHigh != null && b.alphaCILow != null
            ? b.alphaCIHigh - b.alphaCILow
            : Infinity;
        return wb - wa; // wide first per design label "CI 宽→窄"
      });
    case "samples":
      return copy.sort((a, b) => b.itemsEvaluated - a.itemsEvaluated);
  }
}

