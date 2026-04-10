"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLocale } from "@/lib/i18n/context";

interface AnnotatorProgress {
  name: string;
  completed: number;
  total: number;
}

interface PackageData {
  id: string;
  name: string;
  taskType: string;
  videoCount: number;
  annotatorCount: number;
  completedItems: number;
  totalItems: number;
  status: string;
  publishedAt: string | null;
  deadline: string | null;
  deadlineStatus: "ok" | "near" | "overdue" | null;
  modelCheckpoint: string | null;
  description: string | null;
  modelNames: string[];
  annotatorProgress: AnnotatorProgress[];
  createdAt: string;
}

interface Props {
  packages: PackageData[];
}

const STATUS_STYLES: Record<string, { zh: string; en: string; className: string }> = {
  DRAFT: { zh: "草稿", en: "Draft", className: "border-zinc-400/50 text-zinc-500 dark:text-zinc-400" },
  PUBLISHED: { zh: "已发布", en: "Published", className: "border-green-500/50 text-green-600 dark:text-green-400" },
  RECALLED: { zh: "已撤回", en: "Recalled", className: "border-amber-500/50 text-amber-600 dark:text-amber-400" },
  ARCHIVED: { zh: "已归档", en: "Archived", className: "border-zinc-400/50 text-zinc-400" },
};

const DEADLINE_STYLES: Record<string, string> = {
  ok: "text-muted-foreground",
  near: "text-amber-600 dark:text-amber-400",
  overdue: "text-red-600 dark:text-red-400",
};

const PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

export function PackageListClient({ packages }: Props) {
  const { locale, t } = useLocale();
  const [filterType, setFilterType] = useState<string>("ALL");
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filterType === "ALL") return packages;
    return packages.filter((p) => p.taskType === filterType);
  }, [packages, filterType]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "-";
    return new Date(iso).toLocaleString(
      locale === "zh" ? "zh-CN" : "en-US",
      { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    );
  };

  const deadlineLabel = (pkg: PackageData) => {
    if (!pkg.deadline) return locale === "zh" ? "未设置" : "Not set";
    const dt = new Date(pkg.deadline);
    const now = new Date();
    const diffMs = dt.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (24 * 3600_000));

    const dateStr = dt.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });

    if (diffMs < 0) {
      return locale === "zh" ? `${dateStr}（已过期）` : `${dateStr} (overdue)`;
    }
    if (diffDays <= 1) {
      return locale === "zh" ? `${dateStr}（即将截止）` : `${dateStr} (due soon)`;
    }
    return locale === "zh" ? `${dateStr}（剩余 ${diffDays} 天）` : `${dateStr} (${diffDays}d left)`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["ALL", "T2V", "I2V"].map((type) => (
          <Button
            key={type}
            variant={filterType === type ? "default" : "outline"}
            size="sm"
            onClick={() => { setFilterType(type); setPage(1); }}
          >
            {type === "ALL" ? t("common.all") : (
              <span className="flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-full ${type === "T2V" ? "bg-blue-500" : "bg-emerald-500"}`} />
                {type}
              </span>
            )}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paged.map((pkg) => {
          const progressPct = pkg.totalItems > 0
            ? Math.round((pkg.completedItems / pkg.totalItems) * 100)
            : 0;
          const isExpanded = expandedId === pkg.id;
          const statusInfo = STATUS_STYLES[pkg.status] ?? STATUS_STYLES.DRAFT;
          const dlStyle = pkg.deadlineStatus ? DEADLINE_STYLES[pkg.deadlineStatus] : "text-muted-foreground";

          return (
            <Card key={pkg.id} className="group transition-colors hover:border-primary/30">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg ${
                    pkg.taskType === "T2V"
                      ? "bg-blue-500/10 text-blue-500"
                      : "bg-emerald-500/10 text-emerald-500"
                  }`}>
                    📁
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/admin/samples/package/${pkg.id}`}>
                      <p className="text-sm font-medium truncate hover:text-primary transition-colors cursor-pointer">
                        {pkg.name}
                      </p>
                    </Link>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusInfo.className}`}>
                        {locale === "zh" ? statusInfo.zh : statusInfo.en}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                        pkg.taskType === "T2V"
                          ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                          : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {pkg.taskType}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === "zh" ? "模型" : "Model"}</span>
                    <span className="font-mono truncate ml-1">{pkg.modelNames.join(", ") || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === "zh" ? "版本" : "Ver."}</span>
                    <span className="font-mono truncate ml-1">{pkg.modelCheckpoint || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === "zh" ? "视频" : "Videos"}</span>
                    <span>{pkg.videoCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{locale === "zh" ? "评测员" : "Annotators"}</span>
                    <span>{pkg.annotatorCount}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{locale === "zh" ? "截止" : "Deadline"}</span>
                  <span className={`font-mono ${dlStyle}`}>
                    {deadlineLabel(pkg)}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{locale === "zh" ? "评测进度" : "Progress"}</span>
                    <span>{pkg.completedItems}/{pkg.totalItems} ({progressPct}%)</span>
                  </div>
                  <Progress value={progressPct} className="h-1.5" />
                </div>

                {isExpanded && (
                  <div className="border-t pt-3 space-y-3 text-xs animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-muted-foreground block">
                          {locale === "zh" ? "创建时间" : "Created"}
                        </span>
                        <span className="font-mono">{formatDateTime(pkg.createdAt)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">
                          {locale === "zh" ? "发布时间" : "Published"}
                        </span>
                        <span className="font-mono">{formatDateTime(pkg.publishedAt)}</span>
                      </div>
                    </div>

                    {pkg.description && (
                      <div>
                        <span className="text-muted-foreground block mb-0.5">
                          {locale === "zh" ? "描述" : "Description"}
                        </span>
                        <p className="text-foreground">{pkg.description}</p>
                      </div>
                    )}

                    {pkg.annotatorProgress.length > 0 && (
                      <div>
                        <span className="text-muted-foreground block mb-1.5">
                          {locale === "zh" ? "评测员进度" : "Annotator Progress"}
                        </span>
                        <div className="space-y-1.5">
                          {pkg.annotatorProgress.map((ap) => {
                            const pct = ap.total > 0 ? Math.round((ap.completed / ap.total) * 100) : 0;
                            return (
                              <div key={ap.name} className="flex items-center gap-2">
                                <span className="w-16 truncate">{ap.name}</span>
                                <div className="flex-1">
                                  <Progress value={pct} className="h-1" />
                                </div>
                                <span className="w-16 text-right font-mono text-muted-foreground">
                                  {ap.completed}/{ap.total}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <Link href={`/admin/samples/package/${pkg.id}`}>
                      <Button variant="outline" size="sm" className="w-full mt-1">
                        {locale === "zh" ? "查看样本" : "View Samples"} →
                      </Button>
                    </Link>
                  </div>
                )}

                <button
                  onClick={() => toggleExpand(pkg.id)}
                  className="flex w-full items-center justify-end gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
                >
                  {isExpanded
                    ? (locale === "zh" ? "收起 ⬆" : "Collapse ⬆")
                    : (locale === "zh" ? "详情 ⬇" : "Details ⬇")}
                </button>
              </CardContent>
            </Card>
          );
        })}

        {paged.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {t("common.noData")}
            </CardContent>
          </Card>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="flex items-center justify-end gap-4">
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
          <span className="text-sm text-muted-foreground">{safePage}/{totalPages}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              {t("common.prev")}
            </Button>
            <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
