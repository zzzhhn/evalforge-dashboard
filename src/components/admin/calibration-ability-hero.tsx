"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/context";

interface TierDistribution {
  TIER_1: number;
  TIER_2: number;
  TIER_3: number;
  TIER_4: number;
  unassessed: number;
}

interface Props {
  // Phase 9: null → shows "—" + phase-9 inline tag.
  teamKrippendorffAlpha: number | null;
  iccTwoK: number | null;
  tierDistribution: TierDistribution;
  avgCIWidth: number | null;
  observations: { likert: number; pairwise: number; total: number };
}

/**
 * Four hero cells that mirror the Claude Design bold mock exactly:
 *   1. Team Krippendorff α  + ICC(2,k) sub-line
 *   2. Tier distribution    + 2·2·2·2 digit line + colored bar + legend
 *   3. Avg 95% CI width     + unit hint
 *   4. Observations         + Likert / Pairwise split
 */
export function CalibrationAbilityHero({
  teamKrippendorffAlpha,
  iccTwoK,
  tierDistribution,
  avgCIWidth,
  observations,
}: Props) {
  const { locale } = useLocale();

  const assessed =
    tierDistribution.TIER_1 +
    tierDistribution.TIER_2 +
    tierDistribution.TIER_3 +
    tierDistribution.TIER_4;
  const digitLine = `${tierDistribution.TIER_1}·${tierDistribution.TIER_2}·${tierDistribution.TIER_3}·${tierDistribution.TIER_4}`;

  return (
    <div className="grid gap-4 md:grid-cols-4">
      {/* Cell 1 — Krippendorff α */}
      <div className="rounded-xl border bg-card/60 px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {locale === "zh" ? "团队 KRIPPENDORFF α" : "Team Krippendorff α"}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          {teamKrippendorffAlpha != null ? (
            <span className="font-mono text-3xl font-semibold tabular-nums text-emerald-500">
              {teamKrippendorffAlpha.toFixed(3)}
            </span>
          ) : (
            <>
              <span className="font-mono text-3xl font-semibold text-muted-foreground">
                —
              </span>
              <Badge
                variant="outline"
                className="text-[9px] font-normal text-muted-foreground"
              >
                Phase 9
              </Badge>
            </>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {iccTwoK != null ? (
            <>
              ICC(2,k) = {iccTwoK.toFixed(3)} ·{" "}
              <span className="text-emerald-500">
                {locale === "zh" ? "可靠" : "reliable"}
              </span>
            </>
          ) : (
            <>
              ICC(2,k) · {locale === "zh" ? "待采样" : "pending sampling"}
            </>
          )}
        </div>
      </div>

      {/* Cell 2 — Tier distribution */}
      <div className="rounded-xl border bg-card/60 px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {locale === "zh" ? "TIER 分布" : "Tier distribution"}
        </div>
        <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">
          {digitLine}
        </div>
        <TierBar dist={tierDistribution} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          <TierLegend color="bg-emerald-500" label={locale === "zh" ? "T1 独立" : "T1 solo"} />
          <TierLegend color="bg-sky-500" label={locale === "zh" ? "T2 抽查" : "T2 spot-check"} />
          <TierLegend color="bg-amber-500" label={locale === "zh" ? "T3 培训" : "T3 training"} />
          <TierLegend color="bg-rose-500" label={locale === "zh" ? "T4 暂停" : "T4 paused"} />
        </div>
        {assessed === 0 && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            {locale === "zh"
              ? "暂无已评估评测员"
              : "No assessed annotators yet"}
          </div>
        )}
      </div>

      {/* Cell 3 — Avg 95% CI width */}
      <div className="rounded-xl border bg-card/60 px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {locale === "zh" ? "平均 95% CI 宽度" : "Avg 95% CI width"}
        </div>
        <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">
          {avgCIWidth != null ? (
            <>±{(avgCIWidth / 2).toFixed(1)}</>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {locale === "zh"
            ? "百分位单位·越窄越确信"
            : "Percentile · narrower = more certain"}
        </div>
      </div>

      {/* Cell 4 — Observations */}
      <div className="rounded-xl border bg-card/60 px-4 py-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {locale === "zh" ? "累计观测" : "Observations"}
        </div>
        <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">
          {observations.total.toLocaleString()}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          Likert {observations.likert} · Pairwise {observations.pairwise}
        </div>
      </div>
    </div>
  );
}

function TierBar({ dist }: { dist: TierDistribution }) {
  const total = dist.TIER_1 + dist.TIER_2 + dist.TIER_3 + dist.TIER_4 || 1;
  const segments: [string, number, string][] = [
    ["TIER_1", dist.TIER_1, "bg-emerald-500"],
    ["TIER_2", dist.TIER_2, "bg-sky-500"],
    ["TIER_3", dist.TIER_3, "bg-amber-500"],
    ["TIER_4", dist.TIER_4, "bg-rose-500"],
  ];
  return (
    <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full">
      {segments.map(([k, n, cls]) =>
        n > 0 ? (
          <div
            key={k}
            className={cls}
            style={{ width: `${(n / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

function TierLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} /> {label}
    </span>
  );
}
