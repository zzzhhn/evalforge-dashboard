"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import { useLocale } from "@/lib/i18n/context";

export type SidebarRiskLevel = "HIGH_RISK" | "MEDIUM_RISK" | "LOW_RISK" | "NONE";

export interface SidebarPackage {
  id: string;
  name: string;
  taskType: string;
  evaluationMode: "SCORING" | "ARENA";
  status: string;
  completedItems: number;
  totalItems: number;
  maxRiskLevel: SidebarRiskLevel;
}

// Pill visuals per risk level. "NONE" (no members) renders nothing —
// showing a "low risk" pill would falsely reassure admins that an empty
// package has been vetted.
const RISK_PILL: Record<
  Exclude<SidebarRiskLevel, "NONE">,
  { labelZh: string; labelEn: string; className: string }
> = {
  HIGH_RISK: {
    labelZh: "高",
    labelEn: "High",
    className:
      "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
  },
  MEDIUM_RISK: {
    labelZh: "中",
    labelEn: "Med",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  LOW_RISK: {
    labelZh: "低",
    labelEn: "Low",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

interface Props {
  packages: SidebarPackage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  DRAFT: "bg-zinc-400",
  PUBLISHED: "bg-green-500",
  RECALLED: "bg-amber-500",
  ARCHIVED: "bg-zinc-300",
};

export function PackageSidebar({ packages, selectedId, onSelect }: Props) {
  const { locale, t } = useLocale();

  if (packages.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        {t("common.noData")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto pr-1">
      {packages.map((pkg) => {
        const pct =
          pkg.totalItems > 0
            ? Math.round((pkg.completedItems / pkg.totalItems) * 100)
            : 0;
        const isSelected = selectedId === pkg.id;

        return (
          <button
            key={pkg.id}
            onClick={() => onSelect(pkg.id)}
            className={`group flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
              isSelected
                ? "border-primary/60 bg-primary/5"
                : "border-border bg-card hover:border-primary/30 hover:bg-accent/40"
            }`}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                STATUS_DOT[pkg.status] ?? "bg-zinc-300"
              }`}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-1.5">
                <p
                  className={`truncate text-sm font-medium ${
                    isSelected ? "text-foreground" : "text-foreground/90"
                  }`}
                >
                  {pkg.name}
                </p>
                {pkg.evaluationMode === "ARENA" && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-fuchsia-500/50 px-1 py-0 text-[9px] text-fuchsia-600 dark:text-fuchsia-400"
                  >
                    Arena
                  </Badge>
                )}
                {pkg.maxRiskLevel !== "NONE" && (
                  <Badge
                    variant="outline"
                    className={`shrink-0 gap-0.5 px-1 py-0 text-[9px] ${RISK_PILL[pkg.maxRiskLevel].className}`}
                    title={
                      locale === "zh"
                        ? "任务内最高评测员风险等级"
                        : "Highest annotator risk in this package"
                    }
                  >
                    <ShieldAlert className="h-2.5 w-2.5" strokeWidth={2} />
                    {locale === "zh"
                      ? RISK_PILL[pkg.maxRiskLevel].labelZh
                      : RISK_PILL[pkg.maxRiskLevel].labelEn}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Progress value={pct} className="h-1 flex-1" />
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {pct}%
                </span>
              </div>
            </div>
            <span
              className={`ml-1 shrink-0 text-sm transition-transform ${
                isSelected
                  ? "translate-x-0 text-primary"
                  : "-translate-x-1 text-muted-foreground opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
              }`}
            >
              ›
            </span>
          </button>
        );
      })}
    </div>
  );
}
