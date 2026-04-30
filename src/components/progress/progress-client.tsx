"use client";

import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLocale } from "@/lib/i18n/context";

interface PackageSummary {
  id: string;
  name: string;
  deadline: string | null;
  total: number;
  completed: number;
}

interface PackageStats {
  packageId: string;
  total: number;
  completed: number;
  scoreDistribution: [number, number, number, number, number];
}

interface Props {
  packageSummaries: PackageSummary[];
  packageStats: PackageStats[];
  globalStats: {
    total: number;
    completed: number;
    scoreDistribution: [number, number, number, number, number];
  };
}

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

export function ProgressClient({ packageSummaries, packageStats, globalStats }: Props) {
  const { locale, t } = useLocale();
  const [selectedPkgId, setSelectedPkgId] = useState<string>(
    packageSummaries.length === 1 ? packageSummaries[0].id : "ALL"
  );

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.getElementById("sidebar-package-select"));
  }, []);

  const stats = useMemo(() => {
    if (selectedPkgId === "ALL") return globalStats;
    const pkg = packageStats.find((p) => p.packageId === selectedPkgId);
    if (!pkg) return globalStats;
    return {
      total: pkg.total,
      completed: pkg.completed,
      scoreDistribution: pkg.scoreDistribution,
    };
  }, [selectedPkgId, packageStats, globalStats]);

  const pending = stats.total - stats.completed;
  const progressPct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const maxCount = Math.max(...stats.scoreDistribution, 1);

  return (
    <div className="space-y-6">
      {/* Sidebar portal: package selection cards */}
      {portalTarget && createPortal(
        <div className="flex flex-col">
          <div className="px-3 pt-2 pb-1">
            <p className="text-sm font-semibold text-muted-foreground">
              {locale === "zh" ? "任务选择" : "Select Package"}
            </p>
          </div>
          <div className="space-y-1.5 px-2 pb-2">
            {packageSummaries.length > 1 && (
              <button
                onClick={() => setSelectedPkgId("ALL")}
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
                  {globalStats.completed}/{globalStats.total}
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
                  onClick={() => setSelectedPkgId(pkg.id)}
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

      <h1 className="text-2xl font-bold">{t("progress.title")}</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("progress.completionRate")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{progressPct}%</div>
            <Progress value={progressPct} className="mt-2 h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("progress.completed")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.completed}</div>
            <p className="text-xs text-muted-foreground">
              {t("progress.totalTasks", { total: String(stats.total) })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              {t("progress.remaining")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{pending}</div>
            <p className="text-xs text-muted-foreground">
              {t("progress.remainingTasks")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Score Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("progress.scoreDistribution")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            {stats.scoreDistribution.map((count, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs text-muted-foreground">{count}</span>
                <div
                  className="w-full rounded-t bg-primary transition-all"
                  style={{ height: `${(count / maxCount) * 120}px` }}
                />
                <span className="text-sm font-medium">{i + 1}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
