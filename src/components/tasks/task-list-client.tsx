"use client";

import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

interface TaskItem {
  id: string;
  status: string;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType: string;
  packageName: string;
  packageId: string;
  evaluationMode: "SCORING" | "ARENA";
}

interface PackageSummary {
  id: string;
  name: string;
  deadline: string | null;
  total: number;
  completed: number;
}

interface Props {
  items: TaskItem[];
  packageSummaries: PackageSummary[];
}

const STATUS_KEYS: Record<string, { labelKey: TranslationKey; variant: "default" | "secondary" | "outline" }> = {
  PENDING: { labelKey: "common.pending", variant: "outline" },
  IN_PROGRESS: { labelKey: "common.inProgress", variant: "secondary" },
  COMPLETED: { labelKey: "common.completed", variant: "default" },
  EXPIRED: { labelKey: "common.expired", variant: "outline" },
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

function formatDeadline(deadline: string | null, locale: string): string {
  if (!deadline) return locale === "zh" ? "无截止" : "No deadline";
  const d = new Date(deadline);
  return d.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function TaskListClient({ items, packageSummaries }: Props) {
  const { locale, t } = useLocale();
  const [hideCompleted, setHideCompleted] = useState(true);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [selectedPkgId, setSelectedPkgId] = useState<string>(
    packageSummaries.length === 1 ? packageSummaries[0].id : "ALL"
  );
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);

  // Portal target for sidebar package cards
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.getElementById("sidebar-package-select"));
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (hideCompleted) {
      result = result.filter((i) => i.status !== "COMPLETED");
    }
    if (filterType !== "ALL") {
      result = result.filter((i) => i.taskType === filterType);
    }
    if (selectedPkgId !== "ALL") {
      result = result.filter((i) => i.packageId === selectedPkgId);
    }
    return result;
  }, [items, hideCompleted, filterType, selectedPkgId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  // Reset page when filters change
  const handleFilterChange = (type: string) => {
    setFilterType(type);
    setPage(1);
  };
  const handlePkgSelect = (pkgId: string) => {
    setSelectedPkgId(pkgId);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Sidebar portal: package selection cards */}
      {portalTarget && createPortal(
        <div className="flex flex-col">
          <div className="px-3 pt-2 pb-1">
            <p className="text-sm font-semibold text-muted-foreground">
              {locale === "zh" ? "任务选择" : "Select Package"}
            </p>
          </div>
          <div className="space-y-1.5 px-2 pb-2">
            {/* "All" option when multiple packages */}
            {packageSummaries.length > 1 && (
              <button
                onClick={() => handlePkgSelect("ALL")}
                className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  selectedPkgId === "ALL"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <div className="font-medium">
                  {locale === "zh" ? "全部任务" : "All Packages"}
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {items.filter((i) => i.status === "COMPLETED").length}/{items.length}
                  {" "}{locale === "zh" ? "已完成" : "completed"}
                </div>
              </button>
            )}
            {packageSummaries.map((pkg) => {
              const isActive = selectedPkgId === pkg.id;
              const allDone = pkg.completed === pkg.total;
              return (
                <button
                  key={pkg.id}
                  onClick={() => handlePkgSelect(pkg.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className={`font-medium truncate ${isActive ? "text-primary" : "text-foreground"}`}>
                    {pkg.name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                    <span className={allDone ? "text-green-600 dark:text-green-400 font-medium" : ""}>
                      {allDone
                        ? (locale === "zh" ? "已完成" : "Done")
                        : `${pkg.completed}/${pkg.total}`}
                    </span>
                    <span className="text-[10px]">·</span>
                    <span className="truncate">{formatDeadline(pkg.deadline, locale)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>,
        portalTarget
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Task type filter */}
        {["ALL", "T2V", "I2V"].map((type) => (
          <Button
            key={type}
            variant={filterType === type ? "default" : "outline"}
            size="sm"
            onClick={() => handleFilterChange(type)}
          >
            {type === "ALL" ? t("common.all") : (
              <span className="flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-full ${type === "T2V" ? "bg-blue-500" : "bg-emerald-500"}`} />
                {type}
              </span>
            )}
          </Button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {/* Hide/Show completed toggle */}
          <Button
            variant={hideCompleted ? "default" : "outline"}
            size="sm"
            onClick={() => { setHideCompleted((prev) => !prev); setPage(1); }}
          >
            {hideCompleted ? t("common.showCompleted") : t("common.hideCompleted")}
          </Button>
        </div>
      </div>

      {/* Task cards */}
      <div className="grid gap-3">
        {paged.map((item) => {
          const badge = STATUS_KEYS[item.status] ?? STATUS_KEYS.PENDING;
          return (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-center justify-between py-3">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium font-prompt">
                    {locale === "zh" ? item.promptZh : item.promptEn}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground font-prompt">
                    {item.modelName} · {locale === "zh" ? item.promptEn : item.promptZh}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Task type badge */}
                  <Badge
                    variant="outline"
                    className={
                      item.taskType === "T2V"
                        ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                        : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    {item.taskType}
                  </Badge>
                  {item.evaluationMode === "ARENA" && (
                    <Badge
                      variant="outline"
                      className="border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400"
                    >
                      Arena
                    </Badge>
                  )}
                  <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
                  <Link href={`/workstation/${item.id}?pkg=${item.packageId}`}>
                    <Button size="sm" variant={item.status === "COMPLETED" ? "outline" : "default"}>
                      {item.status === "COMPLETED" ? t("tasks.reviewEval") : t("tasks.startEval")}
                    </Button>
                  </Link>
                </div>
              </CardHeader>
            </Card>
          );
        })}

        {paged.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t("tasks.noTasks")}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pagination bar (bottom-right) */}
      {filtered.length > 0 && (
        <div className="flex items-center justify-end gap-4">
          {/* Per-page selector */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("common.perPage")}</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="rounded-md border bg-card px-2 py-1 text-sm"
            >
              {PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n} {t("common.items")}</option>
              ))}
            </select>
          </div>

          {/* Page info + navigation */}
          <span className="text-sm text-muted-foreground">
            {safePage}/{totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              {t("common.prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
