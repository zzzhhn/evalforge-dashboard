"use client";

// Shared assignment-row rendering. Used by both the legacy Assignment tab
// (cross-package ledger) and the Bold UI's Package Detail panel (single-
// package member list). Keeping them in sync visually is a feature, not a
// coincidence — admins switching surfaces shouldn't re-learn the layout.

import { ShieldAlert, UserMinus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilityRadar } from "@/components/admin/capability-radar";
import { useLocale } from "@/lib/i18n/context";

export interface AssignmentMemberRow {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  riskLevel: string;
  groupName: string | null;
  isGroupAdmin: boolean;
  completed: number;
  total: number;
  avgScore: number | null;
  suspiciousCount: number;
  capability: CapabilityScores | null;
}

interface CapabilityScores {
  accuracy: number;
  consistency: number;
  coverage: number;
  detailOriented: number;
  speed: number;
  compositeScore: number;
}

const RISK_STYLES: Record<
  string,
  { bar: string; pill: string; labelZh: string; labelEn: string }
> = {
  HIGH_RISK: {
    bar: "bg-red-500",
    pill: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
    labelZh: "高风险",
    labelEn: "High",
  },
  MEDIUM_RISK: {
    bar: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    labelZh: "中风险",
    labelEn: "Medium",
  },
  LOW_RISK: {
    bar: "bg-emerald-500/60",
    pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    labelZh: "低风险",
    labelEn: "Low",
  },
};

export function getRiskStyle(level: string) {
  return RISK_STYLES[level] ?? RISK_STYLES.LOW_RISK;
}

interface Props {
  member: AssignmentMemberRow;
  busy: boolean;
  onRemove: () => void;
}

export function AssignmentMemberRowView({ member, busy, onRemove }: Props) {
  const { locale, t } = useLocale();
  const risk = getRiskStyle(member.riskLevel);
  const pct = member.total > 0 ? Math.round((member.completed / member.total) * 100) : 0;
  const barColor =
    pct >= 100
      ? "bg-emerald-500"
      : pct >= 67
        ? "bg-emerald-500/80"
        : pct >= 34
          ? "bg-primary"
          : "bg-muted-foreground/40";

  return (
    <div className="group relative grid grid-cols-12 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/30">
      <span
        aria-hidden
        className={`pointer-events-none absolute left-0 top-1/2 h-[72%] w-[3px] -translate-y-1/2 rounded-r ${risk.bar}`}
      />

      <div className="col-span-12 flex min-w-0 items-center gap-2 md:col-span-4">
        <Badge
          variant={member.isGroupAdmin ? "default" : "outline"}
          className="shrink-0 text-[9px] px-1 py-0"
        >
          {member.isGroupAdmin
            ? t("admin.annotators.assignment.groupAdmin")
            : t("admin.annotators.assignment.worker")}
        </Badge>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium leading-tight">
            {member.name}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {member.email}
          </div>
        </div>
      </div>

      <div className="col-span-6 flex items-center gap-2 md:col-span-2">
        <Badge
          variant={member.accountType === "INTERNAL" ? "default" : "secondary"}
          className="shrink-0 text-[9px] px-1 py-0"
        >
          {member.accountType === "INTERNAL"
            ? t("admin.annotators.internal")
            : t("admin.annotators.vendor")}
        </Badge>
        <span className="truncate text-xs text-muted-foreground">
          {member.groupName ?? "—"}
        </span>
      </div>

      <div className="col-span-6 flex flex-col gap-1 md:col-span-3">
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="font-mono tabular-nums text-foreground">
            {member.completed}
            <span className="text-muted-foreground">/{member.total}</span>
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {pct}%
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      </div>

      <div className="col-span-4 flex flex-col text-[11px] md:col-span-1">
        <span className="font-mono tabular-nums text-foreground">
          {member.avgScore != null ? member.avgScore.toFixed(2) : "—"}
          <span className="ml-1 text-muted-foreground">
            {t("admin.annotators.assignment.avgScore")}
          </span>
        </span>
        <span
          className={`font-mono tabular-nums ${
            member.suspiciousCount > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }`}
        >
          {member.suspiciousCount}
          <span className="ml-1">
            {t("admin.annotators.assignment.suspicious")}
          </span>
        </span>
      </div>

      <div className="col-span-4 flex items-center justify-center md:col-span-1">
        <CapabilityRadar scores={member.capability} size="sm" />
      </div>

      <div className="col-span-4 flex items-center justify-end gap-2 md:col-span-1">
        <Badge variant="outline" className={`text-[10px] px-2 ${risk.pill}`}>
          <ShieldAlert className="mr-1 h-3 w-3" />
          {locale === "zh" ? risk.labelZh : risk.labelEn}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onRemove}
          title={t("admin.annotators.assignment.removeOne")}
          className="h-7 w-7 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 dark:hover:text-red-400"
        >
          <UserMinus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
