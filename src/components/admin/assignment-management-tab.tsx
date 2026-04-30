"use client";

import { useState, useMemo, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Clock,
  AlertCircle,
  Users,
  Layers,
  TrendingUp,
  Inbox,
  Settings2,
  ArrowRight,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/context";
import { batchRemoveFromPackage } from "@/app/(main)/admin/annotators/assignment-action";
import { PackageMemberAdjustDialog } from "@/components/admin/package-member-adjust-dialog";
import {
  AssignmentMemberRowView,
  type AssignmentMemberRow as SharedAssignmentMemberRow,
} from "@/components/admin/assignment-member-row";
import {
  PackageFiltersBar,
  DEFAULT_FILTERS,
  type FilterState,
} from "@/components/admin/package-filters-bar";

/* ---------------- Public Types ---------------- */

// Legacy flat row — retained for backwards-compatible data plumbing. Not used
// by the Bold UI's primary layout, but kept so consumers that import this
// type still type-check.
export interface AssignmentAnnotatorRow {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  riskLevel: string;
  groupName: string | null;
  isGroupAdmin: boolean;
  completed: number;
  total: number;
  capability: SharedAssignmentMemberRow["capability"];
}

export interface AssignmentPkgGroup {
  packageId: string;
  packageName: string;
  taskType: string;
  evaluationMode: string;
  deadline: Date | null;
  startAt: Date | null;
  createdAt: Date;
  annotatorTypeMix: "INTERNAL" | "VENDOR" | "MIXED" | "NONE";
  members: AssignmentMemberRow[];
}

// Re-export from the shared module so existing consumers (annotators/page.tsx)
// keep their import paths. The canonical definition lives in assignment-member-row.tsx.
export type AssignmentMemberRow = SharedAssignmentMemberRow;

interface PackageInfo {
  id: string;
  name: string;
  taskType: string;
}

interface AvailableUser {
  id: string;
  name: string;
  email: string;
  accountType: string;
}

interface Props {
  rows: AssignmentAnnotatorRow[];
  pkgGroups: AssignmentPkgGroup[];
  packages: PackageInfo[];
  selectedPackageId: string | null;
  availableUsers: AvailableUser[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* ---------------- Main Component ---------------- */

export function AssignmentManagementTab({
  pkgGroups,
  packages,
  selectedPackageId,
  availableUsers,
}: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<string>("ALL");
  const [pkgFilters, setPkgFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  // Filter by package (from URL), search query, and risk level. We filter
  // per-group so a package with no matching members can be hidden entirely,
  // preventing "ghost headers" cluttering the ledger.
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = pkgFilters.startFrom
      ? new Date(pkgFilters.startFrom).getTime()
      : -Infinity;
    const toTs = pkgFilters.startTo
      ? new Date(pkgFilters.startTo + "T23:59:59+08:00").getTime()
      : Infinity;
    const out: AssignmentPkgGroup[] = [];
    for (const g of pkgGroups) {
      if (selectedPackageId && g.packageId !== selectedPackageId) continue;
      // Package-level filters (task type, evaluation mode, time window, annotator mix).
      if (pkgFilters.taskType !== "ALL" && g.taskType !== pkgFilters.taskType) continue;
      if (
        pkgFilters.evaluationMode !== "ALL" &&
        g.evaluationMode !== pkgFilters.evaluationMode
      )
        continue;
      if (
        pkgFilters.annotatorType !== "ALL" &&
        g.annotatorTypeMix !== pkgFilters.annotatorType
      )
        continue;
      if (pkgFilters.startFrom || pkgFilters.startTo) {
        const windowStart = (g.startAt ?? g.createdAt).getTime();
        const windowEnd = g.deadline ? g.deadline.getTime() : Infinity;
        if (windowEnd < fromTs || windowStart > toTs) continue;
      }
      const members = g.members.filter((m) => {
        if (riskFilter !== "ALL" && m.riskLevel !== riskFilter) return false;
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.groupName ?? "").toLowerCase().includes(q)
        );
      });
      if (members.length === 0) continue;
      out.push({ ...g, members });
    }
    return out;
  }, [pkgGroups, selectedPackageId, search, riskFilter, pkgFilters]);

  // Global hero stats: derived from unfiltered pkgGroups so the "big picture"
  // stays visible when filters narrow the view.
  const heroStats = useMemo(() => {
    let totalAssignments = 0;
    let totalCompleted = 0;
    let overduePackages = 0;
    const activeUserIds = new Set<string>();
    const now = Date.now();
    for (const g of pkgGroups) {
      let pkgHasPending = false;
      for (const m of g.members) {
        totalAssignments += m.total;
        totalCompleted += m.completed;
        activeUserIds.add(m.userId);
        if (m.completed < m.total) pkgHasPending = true;
      }
      if (pkgHasPending && g.deadline && g.deadline.getTime() < now) {
        overduePackages += 1;
      }
    }
    const avgCompletion =
      totalAssignments > 0
        ? Math.round((totalCompleted / totalAssignments) * 100)
        : 0;
    return {
      totalAssignments,
      pkgCount: pkgGroups.length,
      activeUsers: activeUserIds.size,
      avgCompletion,
      totalCompleted,
      overduePackages,
    };
  }, [pkgGroups]);

  const currentMembersByPkg = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; name: string; email: string; accountType: string; completed: number; total: number }>
    >();
    for (const g of pkgGroups) {
      map.set(
        g.packageId,
        g.members.map((m) => ({
          id: m.userId,
          name: m.name,
          email: m.email,
          accountType: m.accountType,
          completed: m.completed,
          total: m.total,
        }))
      );
    }
    return map;
  }, [pkgGroups]);

  const handlePackageChange = (pkgId: string) => {
    const url = new URL(window.location.href);
    if (pkgId) url.searchParams.set("pkg", pkgId);
    else url.searchParams.delete("pkg");
    router.push(`${url.pathname}${url.search}`);
  };

  const handleRemoveOne = async (group: AssignmentPkgGroup, member: AssignmentMemberRow) => {
    const confirmText = t("admin.annotators.assignment.confirmRemoveOne", {
      name: member.name,
      pkg: group.packageName,
    });
    if (!window.confirm(confirmText)) return;
    setBusyUserId(`${group.packageId}::${member.userId}`);
    setMessage(null);
    try {
      const res = await batchRemoveFromPackage(group.packageId, [member.userId]);
      if (res.status === "ok") {
        setMessage({
          text:
            locale === "zh"
              ? `已移除 ${res.data.removed} 个待评测项${res.data.skippedCompleted > 0 ? `（保留 ${res.data.skippedCompleted} 个已完成项）` : ""}`
              : `Removed ${res.data.removed} pending item(s)${res.data.skippedCompleted > 0 ? ` (preserved ${res.data.skippedCompleted} completed)` : ""}`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Legacy migration banner — this page's actions have been embedded
          into Package Detail. Keep this surface working for now so admins
          who know the old route can still complete their tasks, but steer
          them toward the new location. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
        <div className="flex items-start gap-2">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            strokeWidth={1.75}
          />
          <div>
            <div className="font-medium text-amber-900 dark:text-amber-100">
              {t("admin.annotators.assignment.legacyBanner.title")}
            </div>
            <div className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-100/70">
              {t("admin.annotators.assignment.legacyBanner.desc")}
            </div>
          </div>
        </div>
        <Link
          href="/admin/samples"
          className="inline-flex items-center gap-1 rounded-md bg-amber-600/90 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 dark:bg-amber-500/80 dark:hover:bg-amber-500"
        >
          {t("admin.annotators.assignment.legacyBanner.cta")}
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </div>

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {t("admin.annotators.assignment.title")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("admin.annotators.assignment.subtitle")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setAdjustDialogOpen(true)}
          disabled={packages.length === 0}
          className="gap-1.5"
        >
          <Settings2 className="h-3.5 w-3.5" />
          {t("admin.annotators.assignment.adjustByPackage")}
        </Button>
      </div>

      {/* Package-level filter bar (replicated from Task Management so admins
          on the legacy surface get parity with the new primary page). */}
      <PackageFiltersBar value={pkgFilters} onChange={setPkgFilters} />

      {/* Hero strip — 4 cells */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroCell
          icon={<Layers className="h-4 w-4" />}
          label={t("admin.annotators.assignment.hero.totalAssignments")}
          value={heroStats.totalAssignments.toLocaleString()}
          hint={t("admin.annotators.assignment.hero.totalAssignmentsHint", {
            pkgCount: heroStats.pkgCount,
          })}
          tone="primary"
        />
        <HeroCell
          icon={<Users className="h-4 w-4" />}
          label={t("admin.annotators.assignment.hero.activeAnnotators")}
          value={heroStats.activeUsers.toLocaleString()}
          hint={t("admin.annotators.assignment.hero.activeAnnotatorsHint", {
            total: heroStats.activeUsers,
          })}
          tone="secondary"
        />
        <HeroCell
          icon={<TrendingUp className="h-4 w-4" />}
          label={t("admin.annotators.assignment.hero.avgCompletion")}
          value={`${heroStats.avgCompletion}%`}
          hint={t("admin.annotators.assignment.hero.avgCompletionHint", {
            completed: heroStats.totalCompleted.toLocaleString(),
            total: heroStats.totalAssignments.toLocaleString(),
          })}
          tone="success"
        />
        <HeroCell
          icon={<AlertCircle className="h-4 w-4" />}
          label={t("admin.annotators.assignment.hero.overdue")}
          value={heroStats.overduePackages.toLocaleString()}
          hint={t("admin.annotators.assignment.hero.overdueHint")}
          tone={heroStats.overduePackages > 0 ? "danger" : "neutral"}
        />
      </div>

      {/* Toolbar */}
      <div className="rounded-lg border bg-card/50 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {locale === "zh" ? "搜索" : "Search"}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("admin.annotators.assignment.search")}
                className="h-9 pl-8"
              />
            </div>
          </div>
          <div className="min-w-[180px] space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("admin.annotators.assignment.filterByPackage")}
            </label>
            <select
              value={selectedPackageId ?? ""}
              onChange={(e) => handlePackageChange(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="">{locale === "zh" ? "全部任务" : "All packages"}</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} ({pkg.taskType})
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px] space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t("admin.annotators.assignment.riskFilter")}
            </label>
            <select
              value={riskFilter}
              onChange={(e) => setRiskFilter(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <option value="ALL">{t("admin.annotators.assignment.riskAll")}</option>
              <option value="HIGH_RISK">
                {locale === "zh" ? "高风险" : "High"}
              </option>
              <option value="MEDIUM_RISK">
                {locale === "zh" ? "中风险" : "Medium"}
              </option>
              <option value="LOW_RISK">
                {locale === "zh" ? "低风险" : "Low"}
              </option>
            </select>
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

      {/* Package-grouped ledger */}
      {filteredGroups.length === 0 ? (
        <div className="rounded-lg border bg-card py-16">
          <EmptyState
            title={
              locale === "zh"
                ? pkgGroups.length === 0
                  ? t("admin.annotators.assignment.emptyAll")
                  : "无匹配的任务"
                : pkgGroups.length === 0
                  ? t("admin.annotators.assignment.emptyAll")
                  : "No packages match filters"
            }
            hint={
              locale === "zh"
                ? "尝试清空搜索或切换筛选条件"
                : "Try clearing filters or search"
            }
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => (
            <PackageGroupCard
              key={group.packageId}
              group={group}
              busyUserId={busyUserId}
              onRemoveOne={(member) => handleRemoveOne(group, member)}
              locale={locale}
              t={t}
            />
          ))}
        </div>
      )}

      {/* Bulk-adjust dialog */}
      <PackageMemberAdjustDialog
        open={adjustDialogOpen}
        onClose={() => setAdjustDialogOpen(false)}
        packages={packages}
        currentMembersByPkg={currentMembersByPkg}
        allUsers={availableUsers}
        initialPackageId={selectedPackageId ?? undefined}
      />
    </div>
  );
}

/* ---------------- Package Group Card ---------------- */

function PackageGroupCard({
  group,
  busyUserId,
  onRemoveOne,
  locale,
  t,
}: {
  group: AssignmentPkgGroup;
  busyUserId: string | null;
  onRemoveOne: (member: AssignmentMemberRow) => void;
  locale: "zh" | "en";
  t: (key: Parameters<ReturnType<typeof useLocale>["t"]>[0], vars?: Record<string, string | number>) => string;
}) {
  const now = Date.now();
  const hasPending = group.members.some((m) => m.completed < m.total);
  const isOverdue =
    hasPending && group.deadline != null && group.deadline.getTime() < now;
  const daysToDeadline = group.deadline
    ? Math.ceil((group.deadline.getTime() - now) / MS_PER_DAY)
    : null;

  const duePillContent = (() => {
    if (!group.deadline) {
      return {
        label: t("admin.annotators.assignment.noDeadline"),
        tone: "neutral" as const,
      };
    }
    if (isOverdue) {
      return {
        label: t("admin.annotators.assignment.overdueTag"),
        tone: "danger" as const,
      };
    }
    if (daysToDeadline != null && daysToDeadline <= 0) {
      return {
        label: t("admin.annotators.assignment.dueToday"),
        tone: "warning" as const,
      };
    }
    return {
      label: t("admin.annotators.assignment.dueIn", {
        days: daysToDeadline ?? 0,
      }),
      tone: (daysToDeadline != null && daysToDeadline <= 3
        ? "warning"
        : "neutral") as "neutral" | "warning",
    };
  })();

  const pillClass =
    duePillContent.tone === "danger"
      ? "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30"
      : duePillContent.tone === "warning"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
        : "bg-muted/40 text-muted-foreground border-border";

  // Package-level completion rollup displayed in the header card.
  const pkgCompleted = group.members.reduce((acc, m) => acc + m.completed, 0);
  const pkgTotal = group.members.reduce((acc, m) => acc + m.total, 0);
  const pkgPct = pkgTotal > 0 ? Math.round((pkgCompleted / pkgTotal) * 100) : 0;

  return (
    <div
      className={`overflow-hidden rounded-lg border bg-card ${
        isOverdue ? "border-red-500/40" : ""
      }`}
    >
      {/* Header card */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] font-mono uppercase"
          >
            {group.taskType}
          </Badge>
          <Badge
            variant={group.evaluationMode === "ARENA" ? "default" : "secondary"}
            className="shrink-0 text-[10px] uppercase"
          >
            {group.evaluationMode === "ARENA"
              ? "Arena"
              : locale === "zh"
                ? "评分"
                : "Scoring"}
          </Badge>
          <span className="truncate text-sm font-semibold" title={group.packageName}>
            {group.packageName}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>
              {group.deadline
                ? group.deadline.toISOString().slice(0, 10)
                : locale === "zh"
                  ? "无"
                  : "—"}
            </span>
          </div>
          <Badge variant="outline" className={`text-[10px] ${pillClass}`}>
            {duePillContent.label}
          </Badge>
          <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-foreground">
            <span>
              {pkgCompleted}
              <span className="text-muted-foreground">/{pkgTotal}</span>
            </span>
            <span className="text-muted-foreground">· {pkgPct}%</span>
          </div>
        </div>
      </div>

      {/* Member rows */}
      <div className="divide-y">
        {group.members.map((m) => (
          <AssignmentMemberRowView
            key={`${group.packageId}::${m.userId}`}
            member={m}
            busy={busyUserId === `${group.packageId}::${m.userId}`}
            onRemove={() => onRemoveOne(m)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------- Hero Cell ---------------- */

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
  hint: string;
  tone?: "neutral" | "primary" | "secondary" | "success" | "danger";
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/30 bg-primary/5"
      : tone === "secondary"
        ? "border-border bg-muted/30"
        : tone === "success"
          ? "border-emerald-500/30 bg-emerald-500/5"
          : tone === "danger"
            ? "border-red-500/30 bg-red-500/5"
            : "border-border bg-card";
  const iconClass =
    tone === "primary"
      ? "text-primary"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "danger"
          ? "text-red-600 dark:text-red-400"
          : "text-muted-foreground";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className={iconClass}>{icon}</span>
      </div>
      <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

/* ---------------- Empty State ---------------- */

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
