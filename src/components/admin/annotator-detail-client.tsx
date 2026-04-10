"use client";

import { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
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
  videoExternalId: string;
  createdAt: string;
}

interface IntegrityData {
  score: number;
  totalScores: number;
  suspiciousCount: number;
  invalidCount: number;
  criticalEvents: number;
  warningEvents: number;
  riskLevel: string;
}

interface Props {
  userName: string;
  scores: ScoreData[];
  antiCheatEvents?: AntiCheatEventData[];
  integrity?: IntegrityData;
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

const PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

export function AnnotatorDetailClient({ userName, scores, antiCheatEvents = [], integrity }: Props) {
  const { locale, t } = useLocale();
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"scores" | "events">("scores");

  const totalPages = Math.max(1, Math.ceil(scores.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = scores.slice((safePage - 1) * perPage, safePage * perPage);

  const buildExportData = useCallback(() => {
    return scores.map((s) => ({
      [locale === "zh" ? "视频 ID" : "Video ID"]: s.videoExternalId,
      [locale === "zh" ? "Prompt" : "Prompt"]: locale === "zh" ? s.promptZh : s.promptEn,
      [locale === "zh" ? "模型" : "Model"]: s.modelName,
      [locale === "zh" ? "类型" : "Type"]: s.taskType,
      [locale === "zh" ? "维度" : "Dimension"]: `${s.dimensionCode} ${locale === "zh" ? s.dimensionNameZh : s.dimensionNameEn}`,
      [locale === "zh" ? "评分" : "Score"]: s.value,
      [locale === "zh" ? "有效性" : "Validity"]: s.validity,
      [locale === "zh" ? "失败标签" : "Failure Tags"]: (locale === "zh" ? s.failureTagsZh : s.failureTagsEn).join(", "),
      [locale === "zh" ? "备注" : "Comment"]: s.comment ?? "",
      [locale === "zh" ? "提交时间" : "Submitted"]: new Date(s.createdAt).toLocaleString(
        locale === "zh" ? "zh-CN" : "en-US"
      ),
    }));
  }, [scores, locale]);

  const handleExportXlsx = useCallback(() => {
    const data = buildExportData();
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, userName);
    XLSX.writeFile(wb, `${userName}_scores.xlsx`, { bookSST: true });
  }, [buildExportData, userName]);

  const handleExportCsv = useCallback(() => {
    const data = buildExportData();
    const ws = XLSX.utils.json_to_sheet(data);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${userName}_scores.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [buildExportData, userName]);

  const integrityColor = integrity
    ? integrity.score >= 80 ? "text-green-600 dark:text-green-400"
      : integrity.score >= 60 ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400"
    : "";

  return (
    <div className="space-y-4">
      {integrity && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {locale === "zh" ? "诚信度" : "Integrity"}
              </div>
              <div className={`text-3xl font-bold font-mono ${integrityColor}`}>
                {integrity.score}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {locale === "zh" ? "可疑评分" : "Suspicious"}
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
                {locale === "zh" ? "严重事件" : "Critical"}
              </div>
              <div className={`text-lg font-mono ${integrity.criticalEvents > 0 ? "text-red-500" : ""}`}>
                {integrity.criticalEvents}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">
                {locale === "zh" ? "警告事件" : "Warnings"}
              </div>
              <div className={`text-lg font-mono ${integrity.warningEvents > 0 ? "text-amber-500" : ""}`}>
                {integrity.warningEvents}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            <Button
              variant={activeTab === "scores" ? "default" : "outline"}
              size="sm"
              onClick={() => { setActiveTab("scores"); setPage(1); }}
            >
              {locale === "zh" ? "评分记录" : "Scores"} ({scores.length})
            </Button>
            <Button
              variant={activeTab === "events" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("events")}
            >
              {locale === "zh" ? "反作弊事件" : "Events"} ({antiCheatEvents.length})
            </Button>
          </div>
          {activeTab === "scores" && scores.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {t("admin.annotators.avgScore")}:{" "}
              <span className="font-mono font-medium text-foreground">
                {(scores.reduce((s, sc) => s + sc.value, 0) / scores.length).toFixed(2)}
              </span>
            </span>
          )}
        </div>
        {activeTab === "scores" && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportXlsx}>
              {t("admin.annotators.exportXlsx")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              {t("admin.annotators.exportCsv")}
            </Button>
          </div>
        )}
      </div>

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
                {paged.map((s) => (
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
                      {s.failureTagsZh.length > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {(locale === "zh" ? s.failureTagsZh : s.failureTagsEn).join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(s.createdAt).toLocaleString(
                        locale === "zh" ? "zh-CN" : "en-US",
                        { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {paged.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                      {t("common.noData")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {scores.length > 0 && (
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
        </>
      )}

      {activeTab === "events" && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{locale === "zh" ? "事件类型" : "Event"}</TableHead>
                <TableHead>{locale === "zh" ? "严重程度" : "Severity"}</TableHead>
                <TableHead>{locale === "zh" ? "视频 ID" : "Video ID"}</TableHead>
                <TableHead>{locale === "zh" ? "详情" : "Details"}</TableHead>
                <TableHead>{locale === "zh" ? "时间" : "Time"}</TableHead>
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
                      {e.videoExternalId}
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
                    {locale === "zh" ? "无反作弊事件" : "No anti-cheat events"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

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
