"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ExcelJS from "exceljs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/context";
import { fetchAllScoresForExport } from "@/app/(main)/admin/annotators/[userId]/action";

interface ScoreData {
  id: string;
  value: number;
  validity: string;
  failureTagsZh: string[];
  failureTagsEn: string[];
  comment: string | null;
  createdAt: string;
  dimensionCode: string;
  dimensionNameZh: string;
  dimensionNameEn: string;
  l1Code: string;
  l1NameZh: string;
  l1NameEn: string;
  l2Code: string | null;
  l2NameZh: string | null;
  l2NameEn: string | null;
  l3Code: string;
  l3NameZh: string;
  l3NameEn: string;
  videoExternalId: string;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType: string;
}

interface AntiCheatEventData {
  id: string;
  eventType: string;
  severity: string;
  payload: Record<string, unknown>;
  watchRatio: number | null;
  dwellTimeMs: number | null;
  videoExternalId: string | null;
  createdAt: string;
}

interface IntegrityData {
  score: number | null;
  totalScores: number;
  suspiciousCount: number;
  invalidCount: number;
  criticalEvents: number;
  warningEvents: number;
  riskLevel: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  totalScores: number;
  totalEvents: number;
}

interface Props {
  userId: string;
  userName: string;
  scores: ScoreData[];
  antiCheatEvents?: AntiCheatEventData[];
  integrity?: IntegrityData;
  pagination: PaginationData;
  activeTab: "scores" | "events";
}

const SCORE_COLORS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-yellow-500",
  4: "bg-lime-500",
  5: "bg-green-500",
};

const SEVERITY_STYLES: Record<string, string> = {
  INFO: "border-blue-500/50 text-blue-600 dark:text-blue-400",
  WARNING: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  CRITICAL: "border-red-500/50 text-red-600 dark:text-red-400",
};

const EVENT_LABELS: Record<string, { zh: string; en: string }> = {
  low_watch_ratio: { zh: "观看比例低", en: "Low watch ratio" },
  fixed_value_pattern: { zh: "评分固定模式", en: "Fixed value pattern" },
  low_score_variance: { zh: "评分方差低", en: "Low score variance" },
  high_frequency_submit: { zh: "高频提交", en: "High frequency submit" },
};

const LIMIT_OPTIONS = [10, 25, 50, 100, 200];

export function AnnotatorDetailClient({
  userId,
  userName,
  scores,
  antiCheatEvents = [],
  integrity,
  pagination,
  activeTab,
}: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [exporting, setExporting] = useState(false);

  const navigateTo = useCallback(
    (updates: Record<string, string | number>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        params.set(k, String(v));
      }
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handleTabChange = useCallback(
    (tab: "scores" | "events") => navigateTo({ tab, page: 1 }),
    [navigateTo]
  );

  const handlePageChange = useCallback(
    (newPage: number) => navigateTo({ page: newPage }),
    [navigateTo]
  );

  const handleLimitChange = useCallback(
    (newLimit: number) => navigateTo({ limit: newLimit, page: 1 }),
    [navigateTo]
  );

  const doExport = useCallback(
    async (format: "xlsx" | "csv") => {
      setExporting(true);
      try {
        const result = await fetchAllScoresForExport(userId);
        if (result.status === "error") return;
        const allScores = result.data;

        const l1Header = locale === "zh" ? "一级维度" : "L1 Dimension";
        const l2Header = locale === "zh" ? "二级维度" : "L2 Dimension";
        const l3Header = locale === "zh" ? "三级维度" : "L3 Dimension";

        // L1 nameZh already includes code prefix (e.g. "D1 指令遵循…"),
        // L2/L3 nameZh does not (e.g. "多条件同时满足"), so prepend code only when needed.
        const fmtDim = (code: string, name: string) =>
          name.startsWith(code) ? name : `${code} ${name}`;

        const data = allScores.map((s) => ({
          [t("admin.annotators.videoId")]: s.videoExternalId,
          [t("admin.annotators.prompt")]: locale === "zh" ? s.promptZh : s.promptEn,
          [t("admin.annotators.model")]: s.modelName,
          [t("admin.annotators.type")]: s.taskType,
          [l1Header]: fmtDim(s.l1Code, locale === "zh" ? s.l1NameZh : s.l1NameEn),
          [l2Header]: s.l2Code ? (locale === "zh" ? (s.l2NameZh ?? "") : (s.l2NameEn ?? "")) : "",
          [l3Header]: fmtDim(s.l3Code, locale === "zh" ? s.l3NameZh : s.l3NameEn),
          [t("admin.annotators.score")]: s.value,
          [t("admin.annotators.validity")]: s.validity,
          [t("admin.annotators.failureTags")]: (locale === "zh" ? s.failureTagsZh : s.failureTagsEn).join(", "),
          [t("admin.annotators.comment")]: s.comment ?? "",
          [t("admin.annotators.time")]: new Date(s.createdAt).toLocaleString(
            locale === "zh" ? "zh-CN" : "en-US"
          ),
        }));

        if (format === "xlsx") {
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet(userName);
          const headers = Object.keys(data[0]);
          ws.addRow(headers);
          // Bold header row
          ws.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, size: 11 };
          });
          for (const row of data) {
            ws.addRow(headers.map((h) => row[h]));
          }
          // Auto-width columns
          ws.columns.forEach((col) => {
            let maxLen = 10;
            col.eachCell?.({ includeEmpty: false }, (cell) => {
              const len = String(cell.value ?? "").length;
              if (len > maxLen) maxLen = Math.min(len, 50);
            });
            col.width = maxLen + 2;
          });
          const buffer = await wb.xlsx.writeBuffer();
          const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${userName}_scores.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          const headers = Object.keys(data[0]);
          const csvRows = [headers.join(",")];
          for (const row of data) {
            csvRows.push(headers.map((h) => {
              const val = String(row[h] ?? "");
              return val.includes(",") || val.includes('"') || val.includes("\n")
                ? `"${val.replace(/"/g, '""')}"`
                : val;
            }).join(","));
          }
          const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${userName}_scores.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } finally {
        setExporting(false);
      }
    },
    [userId, userName, locale, t]
  );

  const integrityColor = integrity && integrity.score != null
    ? integrity.score >= 80 ? "text-green-600 dark:text-green-400"
      : integrity.score >= 60 ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400"
    : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* Integrity overview */}
      {integrity && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {t("admin.annotators.integrity")}
              </div>
              <div className={`text-3xl font-bold font-mono ${integrityColor}`}>
                {integrity.score ?? "—"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {t("admin.annotators.suspicious")}
              </div>
              <div className="text-lg font-mono">
                {integrity.suspiciousCount}
                <span className="text-xs text-muted-foreground ml-1">
                  / {integrity.totalScores}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {t("admin.annotators.critical")}
              </div>
              <div className={`text-lg font-mono ${integrity.criticalEvents > 0 ? "text-red-500" : ""}`}>
                {integrity.criticalEvents}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {t("admin.annotators.warnings")}
              </div>
              <div className={`text-lg font-mono ${integrity.warningEvents > 0 ? "text-amber-500" : ""}`}>
                {integrity.warningEvents}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab switcher + summary + export */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            <Button
              variant={activeTab === "scores" ? "default" : "outline"}
              size="sm"
              onClick={() => handleTabChange("scores")}
            >
              {t("admin.annotators.scores")} ({pagination.totalScores})
            </Button>
            <Button
              variant={activeTab === "events" ? "default" : "outline"}
              size="sm"
              onClick={() => handleTabChange("events")}
            >
              {t("admin.annotators.events")} ({pagination.totalEvents})
            </Button>
          </div>
        </div>
        {activeTab === "scores" && pagination.totalScores > 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => doExport("xlsx")}
              disabled={exporting}
            >
              {exporting
                ? t("admin.annotators.exporting")
                : `${t("admin.annotators.exportXlsx")} (${t("common.all")} ${pagination.totalScores})`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => doExport("csv")}
              disabled={exporting}
            >
              {exporting
                ? t("admin.annotators.exporting")
                : `${t("admin.annotators.exportCsv")} (${t("common.all")} ${pagination.totalScores})`}
            </Button>
          </div>
        )}
      </div>

      {/* Scores tab */}
      {activeTab === "scores" && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.annotators.videoId")}</TableHead>
                  <TableHead>{t("admin.annotators.dimension")}</TableHead>
                  <TableHead>{t("admin.annotators.score")}</TableHead>
                  <TableHead>{t("admin.annotators.validity")}</TableHead>
                  <TableHead>{t("admin.annotators.failureTags")}</TableHead>
                  <TableHead>{t("admin.annotators.time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div>
                        <span className="font-mono text-xs">{s.videoExternalId}</span>
                        <Badge
                          variant="outline"
                          className={`ml-2 ${
                            s.taskType === "T2V"
                              ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                              : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {s.taskType}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-mono">{s.dimensionCode}</span>{" "}
                      <span className="text-muted-foreground">
                        {locale === "zh" ? s.dimensionNameZh : s.dimensionNameEn}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white ${SCORE_COLORS[s.value] ?? "bg-gray-500"}`}>
                        {s.value}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={s.validity === "VALID" ? "outline" : "destructive"}
                        className="text-xs"
                      >
                        {s.validity}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      {(() => {
                        const tags = locale === "zh" ? s.failureTagsZh : s.failureTagsEn;
                        if (tags.length === 0) {
                          return <span className="text-xs text-muted-foreground/50">-</span>;
                        }
                        const visible = tags.slice(0, 3);
                        const remaining = tags.length - 3;
                        return (
                          <span className="text-xs text-muted-foreground">
                            {visible.join(", ")}
                            {remaining > 0 && (
                              <span
                                className="ml-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium cursor-help"
                                title={tags.join(", ")}
                              >
                                +{remaining}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(s.createdAt).toLocaleString(
                        locale === "zh" ? "zh-CN" : "en-US",
                        { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {scores.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      {t("common.noData")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationControls
            pagination={pagination}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
          />
        </>
      )}

      {/* Anti-cheat events tab */}
      {activeTab === "events" && (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.annotators.eventType")}</TableHead>
                  <TableHead>{t("admin.annotators.severity")}</TableHead>
                  <TableHead>{t("admin.annotators.videoId")}</TableHead>
                  <TableHead>{t("admin.annotators.details")}</TableHead>
                  <TableHead>{t("admin.annotators.time")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {antiCheatEvents.map((e) => {
                  const label = EVENT_LABELS[e.eventType];
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-sm">
                        {label ? (locale === "zh" ? label.zh : label.en) : e.eventType}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${SEVERITY_STYLES[e.severity] ?? ""}`}>
                          {e.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.videoExternalId ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                        {formatPayload(e)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString(
                          locale === "zh" ? "zh-CN" : "en-US",
                          { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {antiCheatEvents.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      {t("admin.annotators.noEvents")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <PaginationControls
            pagination={pagination}
            onPageChange={handlePageChange}
            onLimitChange={handleLimitChange}
          />
        </>
      )}
    </div>
  );
}

function PaginationControls({
  pagination,
  onPageChange,
  onLimitChange,
}: {
  pagination: PaginationData;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}) {
  const { t } = useLocale();
  const { page, limit, total, totalPages } = pagination;

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">
        {total} {t("common.items")}
      </span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{t("common.perPage")}</span>
          <select
            value={limit}
            onChange={(e) => onLimitChange(Number(e.target.value))}
            className="rounded-md border bg-card px-2 py-1 text-sm"
          >
            {LIMIT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-muted-foreground">{page}/{totalPages}</span>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            {t("common.prev")}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            {t("common.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Format anti-cheat event payload into a human-readable string */
function formatPayload(event: AntiCheatEventData): string {
  const p = event.payload;
  switch (event.eventType) {
    case "low_watch_ratio":
      return `Watch: ${((p.watchRatio as number) * 100).toFixed(0)}%`;
    case "fixed_value_pattern":
      return `Dominant: ${((p.dominantRatio as number) * 100).toFixed(0)}% (n=${p.sampleSize})`;
    case "low_score_variance":
      return `σ=${(p.stddev as number).toFixed(2)}, μ=${(p.mean as number).toFixed(1)} (n=${p.sampleSize})`;
    case "high_frequency_submit":
      return `${p.submitsInLastHour} submits/hour`;
    default:
      return JSON.stringify(p);
  }
}
