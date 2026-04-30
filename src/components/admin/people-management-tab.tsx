"use client";

import { Fragment, useState, useMemo, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Search,
  Users,
  Inbox,
  User,
  Calendar,
  MapPin,
  GraduationCap,
  Pencil,
  ArrowLeftRight,
  Activity,
  AlertTriangle,
  Gauge,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/context";
import { AnnotatorTagEditor, type UserTagRow } from "@/components/admin/annotator-tag-editor";
import { InlineBatchAnnotatorForm } from "@/components/admin/inline-batch-annotator-form";
import { updatePersonalInfo } from "@/app/(main)/admin/annotators/assignment-action";
import { toggleAccountType } from "@/app/(main)/admin/samples/package/[packageId]/action";
import { runTagSuggestions } from "@/app/(main)/admin/annotators/tag-action";
import { Sparkles } from "lucide-react";

// Preset options for the editable dropdowns.
// Stored value === display label (no separate canonical key), so free-text
// legacy entries keep working and locale toggle stays graceful: a value
// that doesn't match any preset for the current locale simply falls into
// "其他/Other" mode, preserving the original text for the admin to edit.
const GENDER_OPTIONS_ZH = ["男", "女", "不愿透露"];
const GENDER_OPTIONS_EN = ["Male", "Female", "Prefer not to say"];
const AGE_OPTIONS = ["16-25", "26-35", "36-45", "46-55"];
const EDUCATION_OPTIONS_ZH = ["高中", "大专", "本科", "硕士", "博士"];
const EDUCATION_OPTIONS_EN = ["High school", "Associate", "Bachelor", "Master", "PhD"];

function presetListFor(key: "gender" | "ageRange" | "education", locale: string): string[] {
  if (key === "gender") return locale === "zh" ? GENDER_OPTIONS_ZH : GENDER_OPTIONS_EN;
  if (key === "education") return locale === "zh" ? EDUCATION_OPTIONS_ZH : EDUCATION_OPTIONS_EN;
  return AGE_OPTIONS;
}

// Resolve whether a stored value is one of the known presets for the
// current locale. Empty string counts as "preset" (nothing chosen yet).
function resolveMode(value: string, presets: string[]): "preset" | "other" {
  if (!value) return "preset";
  return presets.includes(value) ? "preset" : "other";
}

export interface PeopleRow {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  groupName: string | null;
  riskLevel: string;
  completed: number;
  total: number;
  // Composite score (0-10) from latest CapabilityAssessment; null when the
  // annotator hasn't been assessed yet.
  compositeScore: number | null;
  // Avg Likert score across this annotator's submissions, and count of
  // suspicious evals flagged by anti-cheat. Both are null when the
  // annotator has no completed work yet.
  avgScore: number | null;
  suspiciousCount: number;
  // Derived 0-100 integrity score (compositeScore * 10). null when
  // unassessed.
  integrity: number | null;
  // 14-day submission trend (oldest → newest). Placeholder zeros until
  // Phase 9 wires in the real histogram.
  trend: number[];
  tags: UserTagRow[];
  personalInfo: {
    gender: string | null;
    ageRange: string | null;
    city: string | null;
    education: string | null;
  };
}

interface Props {
  rows: PeopleRow[];
  isAdmin: boolean;
}

export function PeopleManagementTab({ rows, isAdmin }: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    gender: "",
    ageRange: "",
    city: "",
    education: "",
  });
  // UI-only state — tracks whether each select field is showing a preset
  // or the "其他 / Other" free-text input. Stored separately from the
  // canonical value so toggling modes doesn't need to mutate the draft.
  const [editMode, setEditMode] = useState<{
    gender: "preset" | "other";
    ageRange: "preset" | "other";
    education: "preset" | "other";
  }>({ gender: "preset", ageRange: "preset", education: "preset" });
  const [busy, setBusy] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);
  const [runningSuggestions, setRunningSuggestions] = useState(false);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const handleRunSuggestions = useCallback(async () => {
    if (runningSuggestions) return;
    setRunningSuggestions(true);
    setMessage(null);
    try {
      const res = await runTagSuggestions();
      if (res.status === "ok") {
        const { created, updated, skippedManual, evaluated } = res.data;
        setMessage({
          type: "ok",
          text:
            locale === "zh"
              ? `Tag 推荐完成：新增 ${created}、更新 ${updated}、跳过 MANUAL ${skippedManual}（共评估 ${evaluated} 组）`
              : `Suggestions done: created ${created}, updated ${updated}, skipped manual ${skippedManual} (evaluated ${evaluated} buckets)`,
        });
        refresh();
      } else {
        setMessage({ type: "error", text: res.message });
      }
    } finally {
      setRunningSuggestions(false);
    }
  }, [runningSuggestions, locale, refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.groupName ?? "").toLowerCase().includes(q) ||
        r.tags.some(
          (tg) =>
            tg.name.toLowerCase().includes(q) ||
            (tg.nameEn ?? "").toLowerCase().includes(q)
        )
    );
  }, [rows, search]);

  // Global stats — show headline counts above the table.
  const stats = useMemo(() => {
    const total = rows.length;
    const internal = rows.filter((r) => r.accountType === "INTERNAL").length;
    const vendor = total - internal;
    // "Active" = annotator has any assigned work (total > 0). Real
    // 7-day activity histogram is deferred to Phase 9 (server-side
    // aggregation of recent submissions).
    const active = rows.filter((r) => r.total > 0).length;
    // "At risk" = MEDIUM or HIGH, mirroring assignment-management-tab.
    const atRisk = rows.filter(
      (r) => r.riskLevel === "MEDIUM" || r.riskLevel === "HIGH"
    ).length;
    // Average composite score across annotators that have been assessed.
    // Integrity proxy: scales compositeScore (0-10) to 0-100. Real
    // integrity model will replace this in Phase 9 once anti-cheat
    // rollup lands.
    const assessed = rows.filter((r) => r.compositeScore !== null);
    const avgIntegrity =
      assessed.length === 0
        ? null
        : (assessed.reduce((s, r) => s + (r.compositeScore ?? 0), 0) /
            assessed.length) *
          10;
    return { total, internal, vendor, active, atRisk, avgIntegrity };
  }, [rows]);

  const toggleExpand = (userId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
        // If we're collapsing the row currently being edited, discard the draft.
        if (editingUserId === userId) {
          setEditingUserId(null);
        }
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const startEdit = (r: PeopleRow) => {
    const gender = r.personalInfo.gender ?? "";
    const ageRange = r.personalInfo.ageRange ?? "";
    const education = r.personalInfo.education ?? "";
    setEditingUserId(r.userId);
    setEditDraft({
      gender,
      ageRange,
      city: r.personalInfo.city ?? "",
      education,
    });
    setEditMode({
      gender: resolveMode(gender, presetListFor("gender", locale)),
      ageRange: resolveMode(ageRange, presetListFor("ageRange", locale)),
      education: resolveMode(education, presetListFor("education", locale)),
    });
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setEditDraft({ gender: "", ageRange: "", city: "", education: "" });
    setEditMode({ gender: "preset", ageRange: "preset", education: "preset" });
  };

  const saveEdit = async () => {
    if (!editingUserId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await updatePersonalInfo(editingUserId, {
        gender: editDraft.gender || null,
        ageRange: editDraft.ageRange || null,
        city: editDraft.city || null,
        education: editDraft.education || null,
      });
      if (res.status === "ok") {
        setEditingUserId(null);
        setMessage({
          text: locale === "zh" ? "个人信息已保存" : "Personal info saved",
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggleAccountType = async (userId: string) => {
    setTogglingUserId(userId);
    setMessage(null);
    try {
      const res = await toggleAccountType(userId);
      if (res.status === "ok") {
        setMessage({
          text:
            locale === "zh"
              ? `已切换为${res.newType === "INTERNAL" ? "内部" : "外包"}`
              : `Switched to ${res.newType}`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setTogglingUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Page header: title + bold hero strip + primary actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {locale === "zh" ? "人员管理" : "People"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {locale === "zh"
              ? "评测员档案、标签与个人信息"
              : "Annotator profile, tags, and personal info"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={runningSuggestions}
              onClick={handleRunSuggestions}
              className="gap-1.5"
              title={
                locale === "zh"
                  ? "根据评测员评分历史生成 AUTO_SUGGESTED 标签"
                  : "Generate AUTO_SUGGESTED tags from scoring history"
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
              {runningSuggestions
                ? locale === "zh"
                  ? "推荐中…"
                  : "Running…"
                : locale === "zh"
                  ? "运行 Tag 推荐"
                  : "Run tag suggestions"}
            </Button>
          )}
          <InlineBatchAnnotatorForm />
        </div>
      </div>

      {/* Hero metric strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroCell
          icon={<Users className="h-4 w-4" />}
          label={locale === "zh" ? "总评测员" : "Total annotators"}
          value={String(stats.total)}
          hint={
            locale === "zh"
              ? `内部 ${stats.internal} · 外包 ${stats.vendor}`
              : `Internal ${stats.internal} · Vendor ${stats.vendor}`
          }
          tone="neutral"
        />
        <HeroCell
          icon={<Activity className="h-4 w-4" />}
          label={locale === "zh" ? "活跃中" : "Active"}
          value={String(stats.active)}
          hint={
            locale === "zh"
              ? `占比 ${stats.total === 0 ? 0 : Math.round((stats.active / stats.total) * 100)}%`
              : `${stats.total === 0 ? 0 : Math.round((stats.active / stats.total) * 100)}% of total`
          }
          tone="primary"
        />
        <HeroCell
          icon={<AlertTriangle className="h-4 w-4" />}
          label={locale === "zh" ? "风险评测员" : "At risk"}
          value={String(stats.atRisk)}
          hint={
            locale === "zh" ? "MEDIUM + HIGH" : "MEDIUM + HIGH"
          }
          tone={stats.atRisk > 0 ? "danger" : "neutral"}
        />
        <HeroCell
          icon={<Gauge className="h-4 w-4" />}
          label={locale === "zh" ? "平均诚信分" : "Avg integrity"}
          value={
            stats.avgIntegrity === null
              ? "—"
              : stats.avgIntegrity.toFixed(1)
          }
          hint={
            stats.avgIntegrity === null
              ? locale === "zh"
                ? "暂无评估"
                : "No assessments yet"
              : locale === "zh"
                ? "满分 100"
                : "out of 100"
          }
          tone="accent"
        />
      </div>

      {/* Card-wrapped search bar */}
      <div className="rounded-lg border bg-card/50 p-4">
        <div className="space-y-1.5 max-w-xl">
          <label className="text-xs font-medium text-muted-foreground">
            {locale === "zh" ? "搜索" : "Search"}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                locale === "zh"
                  ? "按姓名、邮箱、组、标签搜索…"
                  : "Search name, email, group, tag…"
              }
              className="h-9 pl-8"
            />
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            message.type === "ok"
              ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Bold-design grid: avatar | who | 完成进度 | 均分·可疑 | 诚信分·趋势 | 风险 | chev */}
      <div className="rounded-lg border bg-card overflow-hidden">
        {/* Column header */}
        <div
          className="grid gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: "36px 1.6fr 1fr 1fr 1.4fr 100px 32px" }}
        >
          <div />
          <div>{locale === "zh" ? "评测员" : "Annotator"}</div>
          <div>{locale === "zh" ? "完成进度" : "Progress"}</div>
          <div>{locale === "zh" ? "均分 · 可疑" : "Avg · Susp."}</div>
          <div>{locale === "zh" ? "诚信分 & 趋势" : "Integrity & Trend"}</div>
          <div>{locale === "zh" ? "风险" : "Risk"}</div>
          <div />
        </div>

        {filtered.length === 0 ? (
          <div className="py-12">
            <EmptyState
              title={locale === "zh" ? "无匹配结果" : "No matches"}
              hint={locale === "zh" ? "试试清空搜索词" : "Try clearing the search"}
            />
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map((r) => {
              const expanded = expandedIds.has(r.userId);
              const editing = editingUserId === r.userId;
              const toggling = togglingUserId === r.userId;
              const pct = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0;
              return (
                <Fragment key={r.userId}>
                  <div
                    data-expanded={expanded || undefined}
                    className="group grid items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30 data-[expanded]:bg-accent/20"
                    style={{ gridTemplateColumns: "36px 1.6fr 1fr 1fr 1.4fr 100px 32px" }}
                  >
                    {/* Avatar */}
                    <Avatar name={r.name} />

                    {/* Who: name + email + type chip */}
                    <div className="min-w-0">
                      <div
                        className="cursor-pointer truncate text-sm font-medium leading-tight hover:text-primary"
                        onClick={() => router.push(`/admin/annotators/${r.userId}?from=people`)}
                      >
                        {r.name}
                      </div>
                      <div className="truncate text-[11px] font-mono text-muted-foreground">
                        {r.email}
                      </div>
                      <button
                        type="button"
                        disabled={toggling}
                        onClick={() => handleToggleAccountType(r.userId)}
                        title={
                          locale === "zh"
                            ? "点击切换内部/外包"
                            : "Click to toggle internal/vendor"
                        }
                        className="mt-1 inline-flex items-center gap-1 transition hover:opacity-80 disabled:opacity-50"
                      >
                        <Badge
                          variant={r.accountType === "INTERNAL" ? "default" : "secondary"}
                          className={`text-[10px] px-1.5 ${toggling ? "animate-pulse" : ""}`}
                        >
                          {r.accountType === "INTERNAL"
                            ? t("admin.annotators.internal")
                            : t("admin.annotators.vendor")}
                        </Badge>
                        <ArrowLeftRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </div>

                    {/* Progress: pct + bar + group name */}
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-sm font-semibold tabular-nums">
                          {r.completed}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          / {r.total}
                        </span>
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                          {pct}%
                        </span>
                      </div>
                      <SegmentedBar done={r.completed} total={r.total} />
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {r.groupName ?? (locale === "zh" ? "未分组" : "No group")}
                      </div>
                    </div>

                    {/* Avg score · suspicious */}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tabular-nums">
                        {r.avgScore == null ? "—" : r.avgScore.toFixed(2)}
                      </div>
                      <div
                        className={`text-[11px] tabular-nums ${
                          r.suspiciousCount > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {locale === "zh" ? "可疑" : "Susp."} {r.suspiciousCount}
                      </div>
                    </div>

                    {/* Integrity meter + 14-day sparkline */}
                    <div className="min-w-0">
                      <IntegrityMeter score={r.integrity} />
                      <div className="mt-1">
                        <MiniSparkline data={r.trend} />
                      </div>
                    </div>

                    {/* Risk pill */}
                    <div>
                      <RiskPill level={r.riskLevel} locale={locale} />
                    </div>

                    {/* Detail page link */}
                    <button
                      type="button"
                      onClick={() => router.push(`/admin/annotators/${r.userId}?from=people`)}
                      aria-label={locale === "zh" ? "查看详情" : "View details"}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronDown className="h-4 w-4 -rotate-90" />
                    </button>
                  </div>

                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function HeroCell({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "primary" | "danger" | "accent";
}) {
  // Tone drives left-border accent + icon tint. Background stays bg-card so
  // hero strip reads as part of the page, not a separate banner.
  const toneClass =
    tone === "primary"
      ? "border-l-primary [&_[data-icon]]:text-primary [&_[data-icon]]:bg-primary/10"
      : tone === "danger"
        ? "border-l-red-500 [&_[data-icon]]:text-red-600 dark:[&_[data-icon]]:text-red-400 [&_[data-icon]]:bg-red-500/10"
        : tone === "accent"
          ? "border-l-amber-500 [&_[data-icon]]:text-amber-600 dark:[&_[data-icon]]:text-amber-400 [&_[data-icon]]:bg-amber-500/10"
          : "border-l-border [&_[data-icon]]:text-muted-foreground [&_[data-icon]]:bg-muted";

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border border-l-4 bg-card p-3 shadow-xs ${toneClass}`}
    >
      <div
        data-icon
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
          {value}
        </div>
        {hint && (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Bold UI primitives ---------------- */

// CJK-aware initials: Chinese names → last 2 chars; Latin names → first letter of first 2 words.
function initials(name: string): string {
  if (!name) return "?";
  if (/[\u4e00-\u9fa5]/.test(name)) return [...name].slice(-2).join("");
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Stable 1-5 color bucket derived from name; avoids palette clashes.
function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 5;
  return h + 1;
}

function Avatar({ name }: { name: string }) {
  const hue = avatarHue(name);
  const palette: Record<number, string> = {
    1: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
    2: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    3: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    4: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    5: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  };
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${palette[hue]}`}
    >
      {initials(name)}
    </div>
  );
}

// Segmented progress bar: done in primary, remainder in muted.
function SegmentedBar({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    return <div className="mt-1 h-1.5 rounded-full bg-muted" />;
  }
  const donePct = Math.min(100, Math.max(0, (done / total) * 100));
  return (
    <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full bg-primary transition-all"
        style={{ width: `${donePct}%` }}
      />
    </div>
  );
}

// 0-100 integrity meter: gradient track + needle + numeric label.
function IntegrityMeter({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-full rounded-full bg-muted" />
        <span className="text-[11px] text-muted-foreground">—</span>
      </div>
    );
  }
  const s = Math.max(0, Math.min(100, score));
  const tone =
    s >= 80
      ? "text-emerald-600 dark:text-emerald-400"
      : s >= 60
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-gradient-to-r from-red-500/30 via-amber-500/30 to-emerald-500/40">
        <div
          className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-foreground"
          style={{ left: `calc(${s}% - 1px)` }}
        />
      </div>
      <span className={`shrink-0 text-xs font-semibold tabular-nums ${tone}`}>
        {s}
      </span>
    </div>
  );
}

// 14-day trend sparkline (pure SVG, ~60x18).
function MiniSparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2 || data.every((v) => v === 0)) {
    return (
      <div className="h-[18px] w-[60px] rounded bg-muted/40" aria-hidden />
    );
  }
  const w = 60;
  const h = 18;
  const max = Math.max(...data, 1);
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => [i * step, h - (v / max) * (h - 2) - 1] as const);
  const d = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <path d={area} className="fill-primary/15" />
      <path
        d={d}
        fill="none"
        strokeWidth={1.25}
        className="stroke-primary"
      />
    </svg>
  );
}

function RiskPill({ level, locale }: { level: string; locale: string }) {
  const l = (level || "LOW").toUpperCase();
  const map: Record<string, { cls: string; zh: string; en: string }> = {
    LOW: {
      cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      zh: "低",
      en: "LOW",
    },
    MEDIUM: {
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      zh: "中",
      en: "MED",
    },
    HIGH: {
      cls: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
      zh: "高",
      en: "HIGH",
    },
  };
  const c = map[l] ?? map.LOW;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${c.cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {locale === "zh" ? c.zh : c.en}
    </span>
  );
}

type SelectableKey = "gender" | "ageRange" | "education";

interface PersonalInfoPanelProps {
  personalInfo: PeopleRow["personalInfo"];
  editing: boolean;
  editDraft: { gender: string; ageRange: string; city: string; education: string };
  setEditDraft: React.Dispatch<
    React.SetStateAction<{ gender: string; ageRange: string; city: string; education: string }>
  >;
  editMode: { gender: "preset" | "other"; ageRange: "preset" | "other"; education: "preset" | "other" };
  setEditMode: React.Dispatch<
    React.SetStateAction<{
      gender: "preset" | "other";
      ageRange: "preset" | "other";
      education: "preset" | "other";
    }>
  >;
  busy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  locale: string;
}

const OTHER_SENTINEL = "__other__";

function PersonalInfoPanel({
  personalInfo,
  editing,
  editDraft,
  setEditDraft,
  editMode,
  setEditMode,
  busy,
  onStartEdit,
  onCancelEdit,
  onSave,
  locale,
}: PersonalInfoPanelProps) {
  const fieldDefs: Array<{
    key: keyof typeof editDraft;
    label: string;
    icon: React.ReactNode;
    value: string | null;
    selectable: boolean;
  }> = [
    {
      key: "gender",
      label: locale === "zh" ? "性别" : "Gender",
      icon: <User className="h-3.5 w-3.5" />,
      value: personalInfo.gender,
      selectable: true,
    },
    {
      key: "ageRange",
      label: locale === "zh" ? "年龄段" : "Age Range",
      icon: <Calendar className="h-3.5 w-3.5" />,
      value: personalInfo.ageRange,
      selectable: true,
    },
    {
      key: "city",
      label: locale === "zh" ? "城市" : "City",
      icon: <MapPin className="h-3.5 w-3.5" />,
      value: personalInfo.city,
      selectable: false,
    },
    {
      key: "education",
      label: locale === "zh" ? "学历" : "Education",
      icon: <GraduationCap className="h-3.5 w-3.5" />,
      value: personalInfo.education,
      selectable: true,
    },
  ];

  const otherLabel = locale === "zh" ? "其他" : "Other";
  const placeholderLabel = locale === "zh" ? "请选择" : "Select";
  const otherPlaceholder = locale === "zh" ? "自定义内容" : "Custom value";

  const handleSelectChange = (key: SelectableKey, raw: string) => {
    if (raw === OTHER_SENTINEL) {
      setEditMode((m) => ({ ...m, [key]: "other" }));
      setEditDraft((d) => ({ ...d, [key]: "" }));
      return;
    }
    setEditMode((m) => ({ ...m, [key]: "preset" }));
    setEditDraft((d) => ({ ...d, [key]: raw }));
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {locale === "zh" ? "个人信息" : "Personal Info"}
        </div>
        {!editing && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onStartEdit}
          >
            <Pencil className="mr-1 h-3 w-3" />
            {locale === "zh" ? "编辑" : "Edit"}
          </Button>
        )}
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {fieldDefs.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span className="text-muted-foreground/70">{f.icon}</span>
                  {f.label}
                </label>
                {f.selectable ? (
                  <SelectWithOther
                    fieldKey={f.key as SelectableKey}
                    mode={editMode[f.key as SelectableKey]}
                    value={editDraft[f.key]}
                    presets={presetListFor(f.key as SelectableKey, locale)}
                    otherLabel={otherLabel}
                    placeholderLabel={placeholderLabel}
                    otherPlaceholder={otherPlaceholder}
                    onSelectChange={handleSelectChange}
                    onOtherChange={(v) =>
                      setEditDraft((d) => ({ ...d, [f.key]: v }))
                    }
                  />
                ) : (
                  <Input
                    value={editDraft[f.key]}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, [f.key]: e.target.value }))
                    }
                    className="h-8"
                    placeholder={locale === "zh" ? "未填写" : "Not set"}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" disabled={busy} onClick={onSave}>
              {locale === "zh" ? "保存" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancelEdit} disabled={busy}>
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fieldDefs.map((f) => (
            <InfoBlock key={f.key} icon={f.icon} label={f.label} value={f.value} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SelectWithOtherProps {
  fieldKey: SelectableKey;
  mode: "preset" | "other";
  value: string;
  presets: string[];
  otherLabel: string;
  placeholderLabel: string;
  otherPlaceholder: string;
  onSelectChange: (key: SelectableKey, raw: string) => void;
  onOtherChange: (v: string) => void;
}

function SelectWithOther({
  fieldKey,
  mode,
  value,
  presets,
  otherLabel,
  placeholderLabel,
  otherPlaceholder,
  onSelectChange,
  onOtherChange,
}: SelectWithOtherProps) {
  // Native <select> styled to match Input height/border; lightweight and
  // avoids adding a new shadcn dependency for a simple field.
  const selectValue = mode === "other" ? OTHER_SENTINEL : value;
  return (
    <div className="space-y-1.5">
      <select
        value={selectValue}
        onChange={(e) => onSelectChange(fieldKey, e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{placeholderLabel}</option>
        {presets.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={OTHER_SENTINEL}>{otherLabel}</option>
      </select>
      {mode === "other" && (
        <Input
          value={value}
          onChange={(e) => onOtherChange(e.target.value)}
          className="h-8"
          placeholder={otherPlaceholder}
        />
      )}
    </div>
  );
}

function InfoBlock({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  const isEmpty = !value;
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-md border bg-background/50 px-3 py-2.5">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
          isEmpty
            ? "bg-muted text-muted-foreground/60"
            : "bg-primary/10 text-primary"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={`truncate text-sm ${
            isEmpty ? "text-muted-foreground" : "font-medium text-foreground"
          }`}
        >
          {value ?? "—"}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border bg-muted/30 text-muted-foreground">
        <Inbox className="h-5 w-5" />
      </div>
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
