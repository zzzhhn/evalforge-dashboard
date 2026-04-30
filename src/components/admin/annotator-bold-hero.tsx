"use client";

import { useLocale } from "@/lib/i18n/context";

interface Props {
  name: string;
  email: string;
  accountType: string;
  riskLevel: string;
  createdAt: string;
  integrityScore: number | null;
  completed: number;
  total: number;
  avgScore: number | null;
  stddev: number | null;
  totalScores: number;
  suspiciousCount: number;
  criticalLast7Days: number;
  distribution: number[]; // length 5, scores 1..5
  trend14: number[]; // length 14, daily submissions (oldest → newest)
}

function formatMonthDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

const HUE_CLASS: Record<number, string> = {
  1: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  2: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
  3: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  4: "bg-violet-500/15 text-violet-700 dark:text-violet-300 ring-violet-500/30",
  5: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30",
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const hasCJK = /[\u3400-\u9fff]/.test(trimmed);
  if (hasCJK) return [...trimmed].slice(-2).join("");
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 5;
  return h + 1;
}

function integrityTone(score: number | null): {
  ring: string;
  text: string;
  label: (locale: "zh" | "en") => string;
} {
  if (score == null)
    return {
      ring: "ring-muted-foreground/30",
      text: "text-muted-foreground",
      label: (l) => (l === "zh" ? "数据不足" : "No data"),
    };
  if (score >= 80)
    return {
      ring: "ring-emerald-500/40",
      text: "text-emerald-600 dark:text-emerald-400",
      label: (l) => (l === "zh" ? "优秀" : "Excellent"),
    };
  if (score >= 60)
    return {
      ring: "ring-amber-500/40",
      text: "text-amber-600 dark:text-amber-400",
      label: (l) => (l === "zh" ? "良好" : "Good"),
    };
  return {
    ring: "ring-rose-500/40",
    text: "text-rose-600 dark:text-rose-400",
    label: (l) => (l === "zh" ? "需关注" : "At risk"),
  };
}

function riskTone(level: string): string {
  if (level === "HIGH")
    return "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30";
  if (level === "MEDIUM")
    return "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30";
}

export function AnnotatorBoldHero({
  name,
  email,
  accountType,
  riskLevel,
  createdAt,
  integrityScore,
  completed,
  total,
  avgScore,
  stddev,
  totalScores,
  suspiciousCount,
  criticalLast7Days,
  distribution,
  trend14,
}: Props) {
  const { locale, t } = useLocale();
  const hue = avatarHue(name);
  const tone = integrityTone(integrityScore);
  const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const suspPct =
    totalScores > 0 ? ((suspiciousCount / totalScores) * 100).toFixed(1) : "0.0";
  const joinedDate = new Date(createdAt).toISOString().slice(0, 10);

  const distMax = Math.max(1, ...distribution);
  const trendMax = Math.max(1, ...trend14);

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-1 text-lg font-semibold ${HUE_CLASS[hue]}`}
            >
              {initials(name)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold truncate">{name}</h2>
                <span
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] ring-1 ${
                    accountType === "INTERNAL"
                      ? "bg-primary/10 text-primary ring-primary/30"
                      : "bg-muted text-muted-foreground ring-border"
                  }`}
                >
                  {accountType === "INTERNAL"
                    ? t("admin.annotators.internal")
                    : t("admin.annotators.vendor")}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ring-1 ${riskTone(
                    riskLevel
                  )}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {riskLevel === "HIGH"
                    ? locale === "zh" ? "高风险" : "High"
                    : riskLevel === "MEDIUM"
                    ? locale === "zh" ? "中风险" : "Med"
                    : locale === "zh" ? "低风险" : "Low"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-mono">{email}</span>
                <span>
                  {locale === "zh" ? "加入时间" : "Joined"} {joinedDate}
                </span>
              </div>
            </div>
          </div>

          {/* Integrity big number */}
          <div className="flex flex-col items-end">
            <div
              className={`flex h-20 w-20 items-center justify-center rounded-full ring-4 ${tone.ring}`}
            >
              <span className={`text-3xl font-bold tabular-nums ${tone.text}`}>
                {integrityScore ?? "—"}
              </span>
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {locale === "zh" ? "诚信分" : "Integrity"}
            </div>
            <div className={`text-[11px] font-medium ${tone.text}`}>
              {tone.label(locale)}
            </div>
          </div>
        </div>
      </div>

      {/* 4 metric cells */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCell
          label={locale === "zh" ? "完成评测" : "Completed"}
          value={`${completed}/${total}`}
          hint={`${completedPct}%`}
          tone="primary"
        />
        <MetricCell
          label={locale === "zh" ? "均分 · 标准差" : "Mean · Stddev"}
          value={avgScore != null ? avgScore.toFixed(2) : "—"}
          hint={
            stddev != null
              ? `σ = ${stddev.toFixed(2)}`
              : locale === "zh"
              ? "暂无数据"
              : "No data"
          }
          tone="neutral"
        />
        <MetricCell
          label={locale === "zh" ? "可疑评分" : "Suspicious"}
          value={suspiciousCount.toString()}
          hint={
            locale === "zh" ? `占比 ${suspPct}%` : `${suspPct}% of total`
          }
          tone={suspiciousCount > 0 ? "warn" : "neutral"}
        />
        <MetricCell
          label={locale === "zh" ? "严重事件" : "Critical events"}
          value={criticalLast7Days.toString()}
          hint={locale === "zh" ? "最近 7 天" : "Last 7 days"}
          tone={criticalLast7Days > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Distribution + 14-day activity */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-sm font-medium">
              {locale === "zh" ? "评分分布" : "Score distribution"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {locale === "zh"
                ? `共 ${totalScores} 条`
                : `${totalScores} scores`}
            </div>
          </div>
          <div>
            <div className="flex h-28 items-end gap-3">
              {distribution.map((n, i) => {
                const score = i + 1;
                const ratio = distMax > 0 ? n / distMax : 0;
                const barPx = n === 0 ? 4 : Math.max(12, Math.round(ratio * 112));
                const color =
                  score === 1
                    ? "bg-rose-500"
                    : score === 2
                    ? "bg-orange-500"
                    : score === 3
                    ? "bg-amber-500"
                    : score === 4
                    ? "bg-green-500"
                    : "bg-emerald-500";
                return (
                  <div
                    key={score}
                    className={`flex-1 rounded-md ${color} transition-all`}
                    style={{ height: `${barPx}px` }}
                    title={`${score}: ${n}`}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex gap-3">
              {distribution.map((n, i) => {
                const score = i + 1;
                return (
                  <div
                    key={score}
                    className="flex-1 text-center text-[11px] tabular-nums text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">{score}</span>
                    <span className="mx-1">·</span>
                    {n}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-sm font-medium">
              {locale === "zh" ? "近 14 天活跃度" : "Last 14 days"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {locale === "zh"
                ? `峰值 ${trendMax}`
                : `peak ${trendMax}`}
            </div>
          </div>
          <div className="flex h-20 items-stretch gap-1.5">
            {trend14.map((n, i) => {
              const ratio = trendMax > 0 ? n / trendMax : 0;
              const intensity =
                n === 0
                  ? "bg-muted/60 dark:bg-muted/40"
                  : ratio < 0.33
                  ? "bg-primary/30"
                  : ratio < 0.66
                  ? "bg-primary/60"
                  : "bg-primary";
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-md ${intensity} transition-all`}
                  title={`day -${13 - i}: ${n}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>{formatMonthDay(new Date(Date.now() - 13 * 24 * 60 * 60 * 1000))}</span>
            <span>{formatMonthDay(new Date())}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "neutral" | "primary" | "warn" | "danger";
}) {
  const border =
    tone === "primary"
      ? "border-l-primary"
      : tone === "warn"
      ? "border-l-amber-500"
      : tone === "danger"
      ? "border-l-rose-500"
      : "border-l-border";
  const valueTone =
    tone === "warn"
      ? "text-amber-600 dark:text-amber-400"
      : tone === "danger"
      ? "text-rose-600 dark:text-rose-400"
      : tone === "primary"
      ? "text-primary"
      : "text-foreground";
  return (
    <div className={`rounded-xl border border-l-4 bg-card p-4 ${border}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
