"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/context";
import { listAnnotatorCalibrationDetail } from "@/app/(main)/admin/annotators/leaderboard-action";
import type { AnnotatorDetail } from "@/app/(main)/admin/annotators/leaderboard-action";

interface Props {
  userId: string | null;
  onClose: () => void;
  positionIndex?: number | null;
  total?: number | null;
}

export function CalibrationAnnotatorDrawer({
  userId,
  onClose,
  positionIndex,
  total,
}: Props) {
  const { locale } = useLocale();
  const [detail, setDetail] = useState<AnnotatorDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    listAnnotatorCalibrationDetail(userId)
      .then((res) => {
        if (res.status === "ok") setDetail(res.data);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <Sheet open={userId !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full max-w-2xl overflow-y-auto sm:max-w-2xl">
        {loading && (
          <div className="p-6 text-sm text-muted-foreground">
            {locale === "zh" ? "加载中…" : "Loading…"}
          </div>
        )}
        {!loading && detail && (
          <DrawerBody
            detail={detail}
            positionIndex={positionIndex ?? null}
            total={total ?? null}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  detail,
  positionIndex,
  total,
}: {
  detail: AnnotatorDetail;
  positionIndex: number | null;
  total: number | null;
}) {
  const { locale } = useLocale();
  const tier = detail.tier;
  const tierTextTone = {
    TIER_1: "text-emerald-500",
    TIER_2: "text-sky-500",
    TIER_3: "text-amber-500",
    TIER_4: "text-rose-500",
  }[tier ?? "TIER_3"];

  return (
    <>
      <SheetHeader className="gap-0 border-b pb-4">
        <SheetTitle className="flex items-center gap-2.5">
          <AvatarBadge initials={detail.avatarInitials} tier={tier} />
          <span className="flex-1 text-lg font-semibold">{detail.name}</span>
          {tier && <TierBadge tier={tier} />}
        </SheetTitle>
        <div className="mt-1 pl-[42px] text-[11px] text-muted-foreground">
          {detail.groupName ?? (locale === "zh" ? "未分组" : "No group")}
          {detail.accountType === "INTERNAL"
            ? locale === "zh"
              ? " · 内部"
              : " · Internal"
            : locale === "zh"
              ? " · 外包"
              : " · Vendor"}
          {positionIndex != null && total != null && (
            <> · #{positionIndex + 1} / {total}</>
          )}
        </div>
      </SheetHeader>

      {/* 能力后验 */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh" ? "能力后验" : "Ability posterior"}
        </SectionTitle>
        <div className="grid grid-cols-[1fr_auto] items-start gap-6 rounded-lg border bg-card/60 px-4 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {locale === "zh" ? "P₁ · 百分位" : "P₁ · percentile"}
            </div>
            <div
              className={`mt-1 font-mono text-5xl font-bold tabular-nums ${tierTextTone}`}
            >
              {detail.rankPercentile != null ? (
                <>
                  {detail.rankPercentile.toFixed(0)}
                  <span className="text-2xl">%</span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            <div className="mt-2 font-mono text-xs text-muted-foreground">
              {detail.alphaMean != null ? (
                <>
                  α_r = {detail.alphaMean.toFixed(3)} · 95% CI [
                  {detail.alphaCILow?.toFixed(2) ?? "—"},{" "}
                  {detail.alphaCIHigh?.toFixed(2) ?? "—"}]
                </>
              ) : (
                <>α_r · {locale === "zh" ? "暂未采样" : "not sampled"}</>
              )}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">
                {locale === "zh" ? "处置建议：" : "Recommended action:"}
              </span>
              <span className={tierTextTone}>{actionForTier(tier, locale)}</span>
            </div>
          </div>
          <div className="space-y-1.5 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {locale === "zh" ? "RANK 后验" : "Rank posterior"}
            </div>
            <MiniRankogram
              rankPercentile={detail.rankPercentile}
              total={total ?? 8}
            />
            <div className="text-[9px] text-muted-foreground">
              {locale === "zh"
                ? "左=冠军 · 右=末位"
                : "Left = top · right = bottom"}
            </div>
          </div>
        </div>
      </section>

      {/* BIFACTOR 维度画像 */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh"
            ? "BIFACTOR 维度画像"
            : "Bifactor dimensions"}
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            ({locale === "zh" ? "GENERAL + CLUSTER-SPECIFIC" : "General + cluster"})
          </span>
        </SectionTitle>
        {detail.scores ? (
          <div className="space-y-2">
            <BifactorBar
              label={locale === "zh" ? "指令遵循" : "Instruction following"}
              value={detail.scores.accuracy}
            />
            <BifactorBar
              label={locale === "zh" ? "视觉质量" : "Visual fidelity"}
              value={detail.scores.consistency}
            />
            <BifactorBar
              label={locale === "zh" ? "运动自然度" : "Motion"}
              value={detail.scores.coverage}
            />
            <BifactorBar
              label={locale === "zh" ? "物理一致性" : "Physics"}
              value={detail.scores.detailOriented}
            />
            <BifactorBar
              label={locale === "zh" ? "身份保持" : "Identity"}
              value={detail.scores.speed}
            />
            {/* 美学 / Arena 偏好 are Phase 9 per user direction — not rendered. */}
          </div>
        ) : (
          <EmptyRow label={locale === "zh" ? "尚无评估数据" : "No assessment yet"} />
        )}
      </section>

      {/* 评测员参数 — real values from Davidson-BT surrogates */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh" ? "评测员参数" : "Annotator parameters"}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <ParamCell
            symbol="δ_R"
            symbolColor="rose"
            title={locale === "zh" ? "严厉度" : "Severity"}
            value={
              detail.params.severityDelta != null
                ? (detail.params.severityDelta > 0 ? "+" : "") +
                  detail.params.severityDelta.toFixed(2)
                : "—"
            }
            hint={severityHint(detail.params.severityDelta, locale)}
          />
          <ParamCell
            symbol="γ_R"
            symbolColor="purple"
            title={locale === "zh" ? "TIE 倾向" : "Tie propensity"}
            value={
              detail.params.tieGamma != null
                ? (detail.params.tieGamma * 100).toFixed(0) + "%"
                : "—"
            }
            hint={tieHint(detail.params.tieGamma, locale)}
          />
          <ParamCell
            symbol="H_R"
            symbolColor="amber"
            title={locale === "zh" ? "质量敏感度" : "Quality sensitivity"}
            value={
              detail.params.qualityH != null
                ? detail.params.qualityH.toFixed(2)
                : "—"
            }
            hint={qualityHint(detail.params.qualityH, locale)}
            span={2}
          />
        </div>
      </section>

      {/* 一致度指标 — real Kα + Pearson-as-ICC */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh"
            ? "一致度指标（与群体中位数对齐）"
            : "Concordance metrics (vs group median)"}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <MetricCell
            label={locale === "zh" ? "KRIPPENDORFF α (区间)" : "Krippendorff α"}
            value={
              detail.concordance.krippendorffAlpha != null
                ? detail.concordance.krippendorffAlpha.toFixed(3)
                : "—"
            }
            hint={
              detail.concordance.krippendorffAlpha != null
                ? concordanceHint(
                    detail.concordance.krippendorffAlpha,
                    locale,
                  )
                : locale === "zh"
                  ? "数据不足"
                  : "Insufficient data"
            }
          />
          <MetricCell
            label={locale === "zh" ? "ICC 相关" : "ICC correlation"}
            value={
              detail.concordance.icc != null
                ? detail.concordance.icc.toFixed(3)
                : "—"
            }
            hint={
              detail.concordance.icc != null
                ? concordanceHint(detail.concordance.icc, locale)
                : locale === "zh"
                  ? "数据不足"
                  : "Insufficient data"
            }
          />
        </div>
      </section>

      {/* Likert / Pairwise */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh" ? "观测分布" : "Observation split"}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <MetricCell
            label={locale === "zh" ? "LIKERT 观测" : "Likert observations"}
            value={String(detail.likertObservations)}
            hint={locale === "zh" ? "5 级评分" : "5-level Likert"}
          />
          <MetricCell
            label={locale === "zh" ? "PAIRWISE 投票" : "Pairwise votes"}
            value={String(detail.pairwiseObservations)}
            hint={locale === "zh" ? "Arena 4 选项" : "Arena 4-option"}
          />
        </div>
      </section>

      {/* 诊断 — bootstrap chain-split R̂ + sample/CI sanity flags */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh" ? "诊断" : "Diagnostics"}
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          <DiagChip
            label="R̂"
            value={
              detail.diagnostics.rHat != null
                ? detail.diagnostics.rHat.toFixed(3)
                : "—"
            }
          />
          <DiagChip
            label="divergent"
            value={String(detail.diagnostics.divergent)}
          />
          <DiagChip
            label={locale === "zh" ? "样本" : "Samples"}
            value={
              detail.diagnostics.samplesOk
                ? locale === "zh"
                  ? "充足"
                  : "OK"
                : locale === "zh"
                  ? "偏少"
                  : "Sparse"
            }
          />
          <DiagChip
            label="CI"
            value={
              detail.diagnostics.ciOk
                ? locale === "zh"
                  ? "正常"
                  : "Normal"
                : locale === "zh"
                  ? "较宽"
                  : "Wide"
            }
          />
        </div>
      </section>

      {/* 8 轮轨迹 */}
      <section className="space-y-3 border-b px-6 py-4">
        <SectionTitle>
          {locale === "zh" ? "近 8 轮评估 · A_R 轨迹" : "Last 8 rounds · A_R trajectory"}
        </SectionTitle>
        {detail.trajectory.length === 0 ? (
          <EmptyRow label={locale === "zh" ? "暂无历史评估" : "No history yet"} />
        ) : (
          <TrajectorySparkline data={detail.trajectory} />
        )}
      </section>

      {/* 处置建议 */}
      <section className="space-y-3 px-6 py-4">
        <SectionTitle>
          {locale === "zh" ? "处置建议" : "Recommendation"}
        </SectionTitle>
        <div
          className={`rounded-lg border px-3 py-2.5 text-sm ${tierBgTone(tier)}`}
        >
          · {actionDescForTier(tier, locale)}
        </div>
      </section>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function PhaseBadge() {
  return (
    <Badge
      variant="outline"
      className="ml-1 h-4 px-1 text-[8px] font-normal text-muted-foreground"
    >
      Phase 9
    </Badge>
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
      className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ${ring}`}
    >
      {initials}
    </div>
  );
}

function TierBadge({
  tier,
}: {
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";
}) {
  const cls = {
    TIER_1: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    TIER_2: "bg-sky-500/15 text-sky-500 border-sky-500/30",
    TIER_3: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    TIER_4: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  }[tier];
  const label = { TIER_1: "Tier 1", TIER_2: "Tier 2", TIER_3: "Tier 3", TIER_4: "Tier 4" }[
    tier
  ];
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function BifactorBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 10) * 100));
  return (
    <div className="grid grid-cols-[100px_1fr_48px] items-center gap-3">
      <div className="text-xs">{label}</div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-sky-500/60 to-sky-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right font-mono text-xs tabular-nums">
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}

function ParamCell({
  symbol,
  symbolColor,
  title,
  value,
  hint,
  span,
}: {
  symbol: string;
  symbolColor: "rose" | "purple" | "amber";
  title: string;
  value: string;
  hint: string;
  span?: number;
}) {
  const symCls = {
    rose: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    purple: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    amber: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  }[symbolColor];
  return (
    <div
      className={`rounded-lg border bg-card/50 px-3 py-3 ${span === 2 ? "col-span-2" : ""}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium">{title}</span>
        <span
          className={`rounded border px-1 py-0 font-mono text-[10px] ${symCls}`}
        >
          {symbol}
        </span>
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-muted-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function DiagChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/40 px-2 py-1 font-mono text-[11px]">
      <span className="text-muted-foreground">{label}</span>{" "}
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-dashed py-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

function MiniRankogram({
  rankPercentile,
}: {
  rankPercentile: number | null;
  total: number;
}) {
  if (rankPercentile == null) {
    return <div className="h-10 w-32 rounded-sm border bg-muted/30" />;
  }
  // The drawer uses the fallback gaussian because the full bootstrap bins
  // aren't round-tripped through AnnotatorDetail yet — they are in the
  // leaderboard row. Leaving this as a stable visual summary; the precise
  // shape is driven by rankPercentile alone.
  const bins = 16;
  const center = (rankPercentile / 100) * (bins - 1);
  const sigma = Math.max(1, bins * 0.18);
  const mass: number[] = [];
  let sum = 0;
  for (let i = 0; i < bins; i++) {
    const d = i - center;
    const v = Math.exp(-(d * d) / (2 * sigma * sigma));
    mass.push(v);
    sum += v;
  }
  const norm = mass.map((v) => v / sum);
  const peak = Math.max(...norm);
  return (
    <div className="flex h-10 w-32 items-end gap-px rounded-sm border bg-muted/20 p-1">
      {norm.map((p, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1px] bg-primary/70"
          style={{ height: `${(p / peak) * 100}%`, minHeight: 2 }}
        />
      ))}
    </div>
  );
}

function TrajectorySparkline({
  data,
}: {
  data: { date: string; alphaMean: number | null; compositeScore: number }[];
}) {
  if (data.length === 0) return null;
  const values = data.map((d) => d.alphaMean ?? d.compositeScore);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.001);
  const path = data
    .map((d, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * 100;
      const v = d.alphaMean ?? d.compositeScore;
      const y = 30 - ((v - min) / range) * 26 - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-3">
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-20 w-full">
        <path d={path} className="fill-none stroke-primary" strokeWidth="1.2" />
        {data.map((d, i) => {
          const x = (i / Math.max(data.length - 1, 1)) * 100;
          const v = d.alphaMean ?? d.compositeScore;
          const y = 30 - ((v - min) / range) * 26 - 2;
          return <circle key={i} cx={x} cy={y} r="1" className="fill-primary" />;
        })}
      </svg>
    </div>
  );
}

function actionForTier(
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null,
  locale: "zh" | "en",
): string {
  if (!tier) return locale === "zh" ? "待评估" : "Pending";
  return {
    TIER_1: locale === "zh" ? "独立工作" : "Independent",
    TIER_2: locale === "zh" ? "抽查复核" : "Spot-check",
    TIER_3: locale === "zh" ? "培训提升" : "Training",
    TIER_4: locale === "zh" ? "暂停分配" : "Pause assignment",
  }[tier];
}

function actionDescForTier(
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null,
  locale: "zh" | "en",
): string {
  if (!tier) return locale === "zh" ? "等待更多评估数据后给出建议。" : "Awaiting more data.";
  return {
    TIER_1:
      locale === "zh"
        ? "独立工作·可承担高难度 / 细粒度维度任务"
        : "Independent work · suitable for hard / fine-grained dimensions",
    TIER_2:
      locale === "zh"
        ? "抽查复核·建议每周抽样 10% 交叉验证"
        : "Spot-check · sample 10% weekly for cross-validation",
    TIER_3:
      locale === "zh"
        ? "培训提升·安排 Group Admin 一对一指导"
        : "Training · arrange 1-on-1 with group admin",
    TIER_4:
      locale === "zh"
        ? "暂停分配·需重新校准后再启用"
        : "Pause · re-calibrate before resuming",
  }[tier];
}

function severityHint(
  delta: number | null,
  locale: "zh" | "en",
): string {
  if (delta == null)
    return locale === "zh" ? "数据不足" : "Insufficient data";
  const abs = Math.abs(delta);
  if (abs < 0.1)
    return locale === "zh" ? "接近群体均值" : "Near group mean";
  return delta < 0
    ? locale === "zh"
      ? "偏严厉"
      : "Stricter than peers"
    : locale === "zh"
      ? "偏宽容"
      : "Looser than peers";
}

function tieHint(
  gamma: number | null,
  locale: "zh" | "en",
): string {
  if (gamma == null)
    return locale === "zh" ? "Arena 样本不足" : "Arena sample too small";
  if (gamma > 0.3)
    return locale === "zh"
      ? "常投 BOTH_GOOD/BAD"
      : "Often picks BOTH_GOOD/BAD";
  if (gamma < 0.08)
    return locale === "zh"
      ? "几乎不投 tie"
      : "Rarely picks tie";
  return locale === "zh" ? "tie 比例正常" : "Tie rate normal";
}

function qualityHint(
  h: number | null,
  locale: "zh" | "en",
): string {
  if (h == null)
    return locale === "zh"
      ? "需要 ≥2 高/低 GT"
      : "Needs ≥2 high/low GT items";
  if (h > 1.3)
    return locale === "zh"
      ? "挑剔·区分双高/双低"
      : "Discriminates highs vs lows";
  if (h < 0.5)
    return locale === "zh"
      ? "分辨力弱"
      : "Low discrimination";
  return locale === "zh" ? "分辨力中等" : "Medium discrimination";
}

function concordanceHint(
  value: number,
  locale: "zh" | "en",
): string {
  if (value >= 0.8) return locale === "zh" ? "可靠" : "Reliable";
  if (value >= 0.6)
    return locale === "zh" ? "尚可" : "Acceptable";
  return locale === "zh" ? "偏弱" : "Weak";
}

function tierBgTone(
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null,
): string {
  return {
    null: "bg-muted/30",
    TIER_1: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
    TIER_2: "bg-sky-500/10 text-sky-500 border-sky-500/30",
    TIER_3: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    TIER_4: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  }[tier ?? "null"];
}
