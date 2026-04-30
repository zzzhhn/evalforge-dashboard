"use client";

import { AlertTriangle, ArrowRight, Crown, MapPin } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";

export interface MemberEnrichment {
  integrity: number | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  completed: number; // proxy for 本月完成任务数 until monthly window is added
}

export interface GroupCardData {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  organization: string | null;
  monthlyQuota: number | null;
  members: {
    userId: string;
    name: string;
    email: string;
    accountType: string;
    isAdmin: boolean;
  }[];
}

interface Props {
  group: GroupCardData;
  enrichment: Map<string, MemberEnrichment>;
  onClick: () => void;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const hasCJK = /[\u3400-\u9fff]/.test(trimmed);
  if (hasCJK) return [...trimmed].slice(-1).join("");
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

function avatarHue(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 6;
  return h + 1;
}

const HUE_CLASS: Record<number, string> = {
  1: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  2: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  3: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  4: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  5: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
  6: "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
};

// Derive "group type" from member mix. Majority-of-members rule, ties break to
// 外包 because a hybrid group almost always contains external vendors and the
// stronger compliance bar is the safer default in the UI.
function deriveGroupType(
  members: GroupCardData["members"]
): "INTERNAL" | "VENDOR" {
  if (members.length === 0) return "INTERNAL";
  let internal = 0;
  let vendor = 0;
  for (const m of members) {
    if (m.accountType === "INTERNAL") internal++;
    else vendor++;
  }
  return internal > vendor ? "INTERNAL" : "VENDOR";
}

export function GroupGridCard({ group, enrichment, onClick }: Props) {
  const { locale } = useLocale();
  const admin = group.members.find((m) => m.isAdmin) ?? null;
  const memberCount = group.members.length;
  const groupType = deriveGroupType(group.members);

  // Aggregate stats from enrichment map; ignore members with missing enrichment
  // rather than guessing (mis-attribution is worse than "N/A").
  let integritySum = 0;
  let integrityN = 0;
  let completionSum = 0; // pseudo "完成率": mean of integrity/100 proxy when
  let completionN = 0; // true completion% not passed in; fallback below.
  let monthlyCompleted = 0;
  let riskyCount = 0;
  for (const m of group.members) {
    const e = enrichment.get(m.userId);
    if (!e) continue;
    if (e.integrity != null) {
      integritySum += e.integrity;
      integrityN++;
    }
    monthlyCompleted += e.completed;
    if (e.riskLevel === "MEDIUM" || e.riskLevel === "HIGH") riskyCount++;
  }
  // Completion rate proxy: quota usage (monthlyCompleted / monthlyQuota). If
  // quota unset, fall back to "任意有完成任务的成员占比" so the cell is always
  // meaningful rather than "—".
  if (group.monthlyQuota && group.monthlyQuota > 0) {
    completionSum = Math.round(
      Math.min(100, (monthlyCompleted / group.monthlyQuota) * 100)
    );
    completionN = 1;
  } else {
    let active = 0;
    for (const m of group.members) {
      const e = enrichment.get(m.userId);
      if (e && e.completed > 0) active++;
    }
    completionSum = memberCount > 0 ? Math.round((active / memberCount) * 100) : 0;
    completionN = memberCount > 0 ? 1 : 0;
  }
  const avgIntegrity = integrityN > 0 ? Math.round(integritySum / integrityN) : null;
  const completionRate = completionN > 0 ? completionSum : null;

  const visibleAvatars = group.members.slice(0, 4);
  const remaining = Math.max(0, memberCount - visibleAvatars.length);

  const typeChipClass =
    groupType === "INTERNAL"
      ? "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/30"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30";
  const typeLabel =
    groupType === "INTERNAL"
      ? locale === "zh"
        ? "内部"
        : "Internal"
      : locale === "zh"
        ? "外包"
        : "Vendor";

  const orgSubtitle = group.organization ?? group.description;

  return (
    <button
      onClick={onClick}
      className="group relative flex w-full flex-col rounded-xl border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30"
    >
      {/* Top row: type chip + location */}
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium ring-1 ${typeChipClass}`}
        >
          {typeLabel}
        </span>
        {group.location ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" strokeWidth={1.75} />
            {group.location}
          </span>
        ) : null}
      </div>

      {/* Group name */}
      <h3 className="truncate text-lg font-semibold leading-tight">{group.name}</h3>

      {/* Organization subtitle */}
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {orgSubtitle ?? (locale === "zh" ? "未填写组织信息" : "No organization info")}
      </p>

      {/* Admin card */}
      <div className="mt-3 rounded-lg border bg-muted/30 p-2.5">
        {admin ? (
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-white/10 ${HUE_CLASS[avatarHue(admin.name)]}`}
            >
              {initials(admin.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{admin.name}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  <Crown className="h-2.5 w-2.5" strokeWidth={2} />
                  {locale === "zh" ? "Group 管理员" : "Group admin"}
                </span>
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {admin.email}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
            {locale === "zh" ? "暂未指定组管理员" : "No admin assigned"}
          </div>
        )}
      </div>

      {/* 4-column stats grid */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Stat
          label={locale === "zh" ? "成员" : "Members"}
          value={String(memberCount)}
          tone="neutral"
        />
        <Stat
          label={locale === "zh" ? "完成率" : "Completion"}
          value={completionRate != null ? `${completionRate}%` : "—"}
          tone={
            completionRate == null
              ? "muted"
              : completionRate >= 80
                ? "good"
                : completionRate >= 60
                  ? "warn"
                  : "bad"
          }
        />
        <Stat
          label={locale === "zh" ? "均诚信" : "Integrity"}
          value={avgIntegrity != null ? String(avgIntegrity) : "—"}
          tone={
            avgIntegrity == null
              ? "muted"
              : avgIntegrity >= 80
                ? "good"
                : avgIntegrity >= 60
                  ? "warn"
                  : "bad"
          }
        />
        <Stat
          label={locale === "zh" ? "可疑" : "At risk"}
          value={String(riskyCount)}
          tone={riskyCount > 0 ? "bad" : "neutral"}
        />
      </div>

      {/* Member avatars row */}
      {memberCount > 0 && (
        <div className="mt-4 flex items-center">
          <div className="flex -space-x-1.5">
            {visibleAvatars.map((m) => (
              <div
                key={m.userId}
                title={m.name}
                className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ring-2 ring-card ${HUE_CLASS[avatarHue(m.name)]}`}
              >
                {initials(m.name)}
              </div>
            ))}
            {remaining > 0 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-card">
                +{remaining}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom row: monthly quota + view details */}
      <div className="mt-4 flex items-end justify-between border-t pt-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {locale === "zh" ? "月度配额" : "Monthly quota"}
          </div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums">
            {group.monthlyQuota != null
              ? group.monthlyQuota.toLocaleString()
              : "—"}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-primary">
          {locale === "zh" ? "查看详情" : "View details"}
          <ArrowRight
            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </span>
      </div>
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "muted" | "good" | "warn" | "bad";
}) {
  const valueTone =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-rose-600 dark:text-rose-400"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={`mt-0.5 text-xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </span>
    </div>
  );
}
