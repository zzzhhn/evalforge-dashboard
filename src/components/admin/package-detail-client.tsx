"use client";

import { useState, useMemo, useCallback, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ExcelJS from "exceljs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/context";
import {
  fetchPackageScoresForExport,
  suspendAnnotator,
  resumeAnnotator,
  abortAnnotator,
  removeAnnotatorFromPackage,
  undoRemoveAnnotator,
  extendDeadline,
} from "@/app/(main)/admin/samples/package/[packageId]/action";
import { PasswordResetDialog } from "@/components/admin/password-reset-dialog";
import { CapabilityRadar } from "@/components/admin/capability-radar";
import { ShieldAlert, UserMinus, Crown } from "lucide-react";
import { useUndoToast } from "@/components/providers/undo-toast-provider";

// Risk pill palette. Mirrors assignment-member-row.tsx for cross-surface
// consistency — the same risk level always renders the same color.
const RISK_PILL_STYLES: Record<
  string,
  { labelZh: string; labelEn: string; className: string }
> = {
  HIGH_RISK: {
    labelZh: "高风险",
    labelEn: "High",
    className:
      "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  },
  MEDIUM_RISK: {
    labelZh: "中风险",
    labelEn: "Medium",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  LOW_RISK: {
    labelZh: "低风险",
    labelEn: "Low",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
};

interface AssetData {
  id: string;
  promptZh: string;
  promptEn: string;
  externalId: string;
  modelName: string;
  taskType: string;
  durationSec: number | null;
  completedItems: number;
  totalItems: number;
}

interface AnnotatorStat {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  assigned: number;
  completed: number;
  scoreCount: number;
  avgScore: number | null;
  lastSubmittedAt: string | null;
  isSuspended: boolean;
  // Fused-in from former Assignment section so all per-annotator signal
  // lives in one table.
  riskLevel: string;
  groupName: string | null;
  isGroupAdmin: boolean;
  suspiciousCount: number;
  capability: {
    accuracy: number;
    consistency: number;
    coverage: number;
    detailOriented: number;
    speed: number;
    compositeScore: number;
  } | null;
}

interface Props {
  packageId: string;
  packageName: string;
  deadline: string | null;
  assets: AssetData[];
  annotatorStats: AnnotatorStat[];
}

const PER_PAGE_OPTIONS = [10, 20, 50, 100, 200];

function ExportDropdown({
  exportKey,
  dropdownOpen,
  exporting,
  onToggle,
  onClose,
  onExport,
  label,
  locale,
}: {
  exportKey: string;
  dropdownOpen: string | null;
  exporting: string | null;
  onToggle: () => void;
  onClose: () => void;
  onExport: (format: "xlsx" | "csv") => void;
  label: string;
  locale: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isOpen = dropdownOpen === exportKey;
  const isExporting = exporting === exportKey;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, onClose]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        disabled={isExporting}
        onClick={onToggle}
        className="h-7 px-2 text-xs"
      >
        {isExporting ? (locale === "zh" ? "导出中…" : "Exporting…") : label}
        <svg className="ml-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </Button>
      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-28 rounded-md border bg-popover p-1 shadow-md">
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => onExport("xlsx")}
          >
            XLSX
          </button>
          <button
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
            onClick={() => onExport("csv")}
          >
            CSV
          </button>
        </div>
      )}
    </div>
  );
}

interface CredentialEntry {
  userId: string;
  name: string;
  email: string;
  password: string | null; // null = not yet revealed/reset
}

export function PackageDetailClient({ packageId, packageName, deadline: initialDeadline, assets, annotatorStats }: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [perPage, setPerPage] = useState(20);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);

  // ─── Deadline Extension State ───────────────────
  const [showExtendDeadline, setShowExtendDeadline] = useState(false);
  const [newDeadlineInput, setNewDeadlineInput] = useState("");
  const [extendingDeadline, setExtendingDeadline] = useState(false);
  const [currentDeadline, setCurrentDeadline] = useState(initialDeadline);

  // ─── Annotator Management State ─────────────────
  const [showMgmt, setShowMgmt] = useState(false);
  const [credentials, setCredentials] = useState<CredentialEntry[]>(
    () => annotatorStats.map((a) => ({
      userId: a.userId,
      name: a.name,
      email: a.email,
      password: null,
    }))
  );
  const undoToastApi = useUndoToast();
  const [resetDialog, setResetDialog] = useState<{
    open: boolean;
    userId: string | null;
    userName: string | null;
  }>({ open: false, userId: null, userName: null });
  const [removing, setRemoving] = useState<string | null>(null);
  const [mgmtMessage, setMgmtMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  const handleAnnotatorAction = useCallback(
    async (action: "suspend" | "resume" | "abort", userId: string, name: string) => {
      const msgs = {
        suspend: locale === "zh"
          ? `确定暂停 ${name} 的评测任务？`
          : `Suspend ${name}'s evaluation tasks?`,
        resume: locale === "zh"
          ? `确定恢复 ${name} 的评测任务？`
          : `Resume ${name}'s evaluation tasks?`,
        abort: locale === "zh"
          ? `确定终止 ${name} 的评测任务？此操作不可撤销。`
          : `Abort ${name}'s tasks? This cannot be undone.`,
      };
      if (!window.confirm(msgs[action])) return;

      const fn = action === "suspend" ? suspendAnnotator
        : action === "resume" ? resumeAnnotator
        : abortAnnotator;

      const res = await fn(packageId, userId);
      if (res.status === "ok") {
        startTransition(() => router.refresh());
      } else {
        alert(res.message);
      }
    },
    [packageId, locale, router, startTransition]
  );

  const closeDropdown = useCallback(() => setDropdownOpen(null), []);

  // ─── Deadline Extension Handler ─────────────────
  const handleExtendDeadline = useCallback(async (iso: string) => {
    if (!iso) return;
    setExtendingDeadline(true);
    setMgmtMessage(null);
    try {
      const res = await extendDeadline(packageId, iso);
      if (res.status === "ok") {
        setCurrentDeadline(res.deadline);
        setShowExtendDeadline(false);
        setNewDeadlineInput("");
        setMgmtMessage({
          text: locale === "zh" ? "截止时间已调整" : "Deadline updated",
          type: "ok",
        });
        startTransition(() => router.refresh());
      } else {
        setMgmtMessage({ text: res.message, type: "error" });
      }
    } finally {
      setExtendingDeadline(false);
    }
  }, [packageId, locale, router, startTransition]);

  // ─── Management Handlers ────────────────────────
  const handleRemoveAnnotator = useCallback(async (userId: string, name: string) => {
    setRemoving(userId);
    setMgmtMessage(null);
    try {
      const res = await removeAnnotatorFromPackage(packageId, userId);
      if (res.status === "ok") {
        // Push into the GLOBAL undo stack. Survives route changes and
        // stacks with other pending undos (multiple members deleted in
        // quick succession each get their own card + timer).
        undoToastApi.push({
          label:
            locale === "zh"
              ? `已移除 ${name}（${res.deletedCount} 项）`
              : `Removed ${name} (${res.deletedCount} items)`,
          onUndo: async () => {
            const r = await undoRemoveAnnotator(packageId, userId);
            if (r.status !== "ok") {
              setMgmtMessage({ text: r.message, type: "error" });
              throw new Error(r.message);
            }
            setMgmtMessage({
              text:
                locale === "zh"
                  ? `已撤销移除 ${name}，恢复了 ${r.itemCount} 个任务`
                  : `Undone: ${name} restored with ${r.itemCount} items`,
              type: "ok",
            });
            startTransition(() => router.refresh());
          },
        });
        setMgmtMessage({
          text:
            locale === "zh"
              ? `${name} 已移除（${res.deletedCount} 个任务已删除），30秒内可撤销`
              : `${name} removed (${res.deletedCount} items deleted), undo within 30s`,
          type: "ok",
        });
        startTransition(() => router.refresh());
      } else {
        setMgmtMessage({ text: res.message, type: "error" });
      }
    } finally {
      setRemoving(null);
    }
  }, [packageId, locale, router, startTransition, undoToastApi]);

  const openResetDialog = useCallback((userId: string, name: string) => {
    setMgmtMessage(null);
    setResetDialog({ open: true, userId, userName: name });
  }, []);

  const handleResetSuccess = useCallback((userId: string, plaintext: string) => {
    setCredentials((prev) =>
      prev.map((c) => (c.userId === userId ? { ...c, password: plaintext } : c))
    );
    setMgmtMessage({
      text: locale === "zh" ? "密码已更新" : "Password updated",
      type: "ok",
    });
  }, [locale]);

  const totalPages = Math.max(1, Math.ceil(assets.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paged = assets.slice((safePage - 1) * perPage, safePage * perPage);

  const totalAssigned = useMemo(() => annotatorStats.reduce((s, a) => s + a.assigned, 0), [annotatorStats]);
  const totalCompleted = useMemo(() => annotatorStats.reduce((s, a) => s + a.completed, 0), [annotatorStats]);

  const doExport = useCallback(
    async (format: "xlsx" | "csv", exportKey: string, userId?: string, exportName?: string) => {
      setDropdownOpen(null);
      setExporting(exportKey);
      try {
        const result = await fetchPackageScoresForExport(packageId, userId);
        if (result.status === "error") {
          alert(
            (locale === "zh" ? "导出失败：" : "Export failed: ") +
              result.message,
          );
          return;
        }
        const allScores = result.data;
        if (allScores.length === 0) {
          alert(
            locale === "zh"
              ? "导出失败：当前任务还没有任何已提交的评分（请确认评测员已完成至少一题）。"
              : "Export failed: no submitted scores yet for this package.",
          );
          return;
        }

        const h = {
          videoId: locale === "zh" ? "视频ID" : "Video ID",
          prompt: "Prompt",
          model: locale === "zh" ? "模型" : "Model",
          taskType: locale === "zh" ? "类型" : "Type",
          annotator: locale === "zh" ? "评测人" : "Annotator",
          l1: locale === "zh" ? "一级维度" : "L1 Dimension",
          l2: locale === "zh" ? "二级维度" : "L2 Dimension",
          l3: locale === "zh" ? "三级维度" : "L3 Dimension",
          score: locale === "zh" ? "分数" : "Score",
          validity: locale === "zh" ? "有效性" : "Validity",
          failureTags: locale === "zh" ? "失败标签" : "Failure Tags",
          comment: locale === "zh" ? "备注" : "Comment",
          time: locale === "zh" ? "提交时间" : "Submitted At",
        };

        const fmtDim = (code: string, name: string) =>
          name.startsWith(code) ? name : `${code} ${name}`;

        const rows = allScores.map((s) => ({
          [h.videoId]: s.videoExternalId,
          [h.prompt]: locale === "zh" ? s.promptZh : s.promptEn,
          [h.model]: s.modelName,
          [h.taskType]: s.taskType,
          [h.annotator]: s.annotatorName,
          [h.l1]: fmtDim(s.l1Code, locale === "zh" ? s.l1NameZh : s.l1NameEn),
          [h.l2]: s.l2Code ? (locale === "zh" ? (s.l2NameZh ?? "") : (s.l2NameEn ?? "")) : "",
          [h.l3]: fmtDim(s.l3Code, locale === "zh" ? s.l3NameZh : s.l3NameEn),
          [h.score]: s.value,
          [h.validity]: s.validity,
          [h.failureTags]: (locale === "zh" ? s.failureTagsZh : s.failureTagsEn).join(", "),
          [h.comment]: s.comment ?? "",
          [h.time]: new Date(s.createdAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"),
        }));

        const headerKeys = Object.keys(rows[0]);
        const fileName = exportName ?? `${packageName}_scores`;

        if (format === "xlsx") {
          const wb = new ExcelJS.Workbook();
          const ws = wb.addWorksheet(exportName ?? packageName);
          ws.addRow(headerKeys);
          ws.getRow(1).eachCell((cell) => { cell.font = { bold: true, size: 11 }; });
          for (const row of rows) ws.addRow(headerKeys.map((k) => row[k]));
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
          a.download = `${fileName}.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          const csvRows = [headerKeys.join(",")];
          for (const row of rows) {
            csvRows.push(headerKeys.map((k) => {
              const val = String(row[k] ?? "");
              return val.includes(",") || val.includes('"') || val.includes("\n")
                ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(","));
          }
          const blob = new Blob(["\uFEFF" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${fileName}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } finally {
        setExporting(null);
      }
    },
    [packageId, packageName, locale]
  );

  return (
    <div className="space-y-6">
      {/* Annotator Statistics */}
      {annotatorStats.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {locale === "zh" ? "评测人员统计" : "Annotator Statistics"}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {locale === "zh"
                  ? `${annotatorStats.length} 人 · ${totalCompleted}/${totalAssigned} 已完成`
                  : `${annotatorStats.length} annotators · ${totalCompleted}/${totalAssigned} completed`}
              </span>
            </h3>
            <ExportDropdown
              exportKey="all"
              dropdownOpen={dropdownOpen}
              exporting={exporting}
              onToggle={() => setDropdownOpen((v) => v === "all" ? null : "all")}
              onClose={closeDropdown}
              onExport={(fmt) => doExport(fmt, "all")}
              label={locale === "zh" ? "全量导出" : "Export All"}
              locale={locale}
            />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === "zh" ? "评测人" : "Annotator"}</TableHead>
                  <TableHead>{locale === "zh" ? "分组" : "Group"}</TableHead>
                  <TableHead>{locale === "zh" ? "类型" : "Type"}</TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "已完成/分配" : "Completed/Assigned"}
                  </TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "完成率" : "Completion %"}
                  </TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "评分数" : "Scores"}
                  </TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "平均分" : "Avg Score"}
                  </TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "可疑" : "Suspicious"}
                  </TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "风险" : "Risk"}
                  </TableHead>
                  <TableHead className="text-center">
                    {locale === "zh" ? "能力" : "Capability"}
                  </TableHead>
                  <TableHead>
                    {locale === "zh" ? "最近提交" : "Last Submitted"}
                  </TableHead>
                  <TableHead className="text-right">
                    {locale === "zh" ? "操作" : "Actions"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {annotatorStats.map((a) => {
                  const pct = a.assigned > 0 ? Math.round((a.completed / a.assigned) * 100) : 0;
                  const riskPill = RISK_PILL_STYLES[a.riskLevel] ?? RISK_PILL_STYLES.LOW_RISK;
                  return (
                    <TableRow key={a.userId}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/annotators/${a.userId}`}
                            className="hover:underline"
                          >
                            {a.name}
                          </Link>
                          {a.isGroupAdmin && (
                            <span
                              title={locale === "zh" ? "Group 管理员" : "Group Admin"}
                              className="inline-flex items-center gap-0.5 rounded-sm bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary"
                            >
                              <Crown className="h-2.5 w-2.5" strokeWidth={2} />
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {a.groupName ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.accountType === "INTERNAL" ? "default" : "secondary"}>
                          {a.accountType === "INTERNAL"
                            ? (locale === "zh" ? "内部" : "Internal")
                            : (locale === "zh" ? "外包" : "Vendor")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {a.completed}/{a.assigned}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={
                            pct === 100
                              ? "text-green-600 dark:text-green-400 font-medium"
                              : pct >= 50
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-muted-foreground"
                          }
                        >
                          {pct}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-sm">{a.scoreCount}</TableCell>
                      <TableCell className="text-center">
                        {a.avgScore !== null ? (
                          <span className="font-mono text-sm">
                            {a.avgScore.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`font-mono text-sm ${
                            a.suspiciousCount > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          }`}
                        >
                          {a.suspiciousCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={`gap-1 px-1.5 text-[10px] ${riskPill.className}`}
                        >
                          <ShieldAlert className="h-2.5 w-2.5" strokeWidth={2} />
                          {locale === "zh" ? riskPill.labelZh : riskPill.labelEn}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center">
                          <CapabilityRadar scores={a.capability} size="sm" />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.lastSubmittedAt
                          ? new Date(a.lastSubmittedAt).toLocaleString(
                              locale === "zh" ? "zh-CN" : "en-US",
                              { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                            )
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {a.isSuspended ? (
                            <Button
                              size="sm"
                              disabled={isPending}
                              className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => handleAnnotatorAction("resume", a.userId, a.name)}
                            >
                              {locale === "zh" ? "恢复" : "Resume"}
                            </Button>
                          ) : a.completed < a.assigned ? (
                            <Button
                              size="sm"
                              disabled={isPending}
                              className="h-7 px-2 text-xs bg-amber-500 hover:bg-amber-600 text-white"
                              onClick={() => handleAnnotatorAction("suspend", a.userId, a.name)}
                            >
                              {locale === "zh" ? "暂停" : "Suspend"}
                            </Button>
                          ) : null}
                          {a.completed < a.assigned && (
                            <Button
                              size="sm"
                              disabled={isPending}
                              variant="destructive"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleAnnotatorAction("abort", a.userId, a.name)}
                            >
                              {locale === "zh" ? "终止" : "Abort"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={removing === a.userId}
                            onClick={() => handleRemoveAnnotator(a.userId, a.name)}
                            title={locale === "zh" ? "从本任务移除" : "Remove from package"}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                          </Button>
                          <ExportDropdown
                            exportKey={a.userId}
                            dropdownOpen={dropdownOpen}
                            exporting={exporting}
                            onToggle={() => setDropdownOpen((v) => v === a.userId ? null : a.userId)}
                            onClose={closeDropdown}
                            onExport={(fmt) => doExport(fmt, a.userId, a.userId, `${packageName}_${a.name}`)}
                            label={locale === "zh" ? "导出" : "Export"}
                            locale={locale}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Extend Deadline */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">
            {locale === "zh" ? "截止时间" : "Deadline"}
          </h3>
          <span className="text-sm text-muted-foreground">
            {currentDeadline
              ? new Date(currentDeadline).toLocaleString(
                  locale === "zh" ? "zh-CN" : "en-US",
                  { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
                )
              : (locale === "zh" ? "未设置" : "Not set")}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => setShowExtendDeadline((v) => !v)}
          >
            {locale === "zh" ? "调整时间" : "Adjust"}
          </Button>
        </div>
        {showExtendDeadline && (
          <DeadlineAdjustRow
            locale={locale}
            defaultIso={currentDeadline}
            submitting={extendingDeadline}
            onCancel={() => { setShowExtendDeadline(false); setNewDeadlineInput(""); }}
            onSubmit={(iso) => handleExtendDeadline(iso)}
          />
        )}
      </div>

      {/* Legacy "Annotator Management Panel" was here. Removed
          2026-04-27 because credential reveal/reset has moved to the
          dedicated "评测员管理 → 密码管理" tab; keeping a duplicate
          here caused divergent state and admin confusion. The block
          below (assigned-members table) stays — that's progress
          tracking, not credential management.

          The Sheet markup below (`{showMgmt && ...`) is preserved
          temporarily but rendered behind a permanently-false flag so
          the surrounding helper functions / state don't need to be
          ripped out in the same PR. They'll be cleaned up in F.6. */}
      <div className="hidden">
        <button
          onClick={() => setShowMgmt((v) => !v)}
          className="flex items-center gap-2 text-sm font-semibold hover:text-foreground/80"
        >
          <svg
            className={`h-4 w-4 transition-transform ${showMgmt ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {locale === "zh" ? "评测员管理" : "Annotator Management"}
        </button>

        {showMgmt && (
          <div className="space-y-4 rounded-lg border p-4">
            {/* Status message */}
            {mgmtMessage && (
              <div className={`rounded-md px-3 py-2 text-sm ${
                mgmtMessage.type === "ok"
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-red-500/10 text-red-700 dark:text-red-400"
              }`}>
                {mgmtMessage.text}
              </div>
            )}

            {/* Undo cards are now rendered globally via
                UndoToastProvider — see src/components/providers/
                undo-toast-provider.tsx. Survives route changes, stacks
                multiple deletions, each with its own 30-second timer. */}

            {/* Credentials table */}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{locale === "zh" ? "类型" : "Type"}</TableHead>
                    <TableHead>{locale === "zh" ? "姓名" : "Name"}</TableHead>
                    <TableHead>{locale === "zh" ? "邮箱" : "Email"}</TableHead>
                    <TableHead>{locale === "zh" ? "密码" : "Password"}</TableHead>
                    <TableHead className="text-right">{locale === "zh" ? "操作" : "Actions"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((cred) => {
                    const stat = annotatorStats.find((a) => a.userId === cred.userId);
                    return (
                      <TableRow key={cred.userId}>
                        <TableCell>
                          <Badge variant="default" className="text-xs">INTERNAL</Badge>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{cred.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{cred.email}</TableCell>
                        <TableCell>
                          {cred.password ? (
                            <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono select-all">
                              {cred.password}
                            </code>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {locale === "zh" ? "已隐藏" : "Hidden"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => openResetDialog(cred.userId, cred.name)}
                            >
                              {locale === "zh" ? "重置密码" : "Reset Pwd"}
                            </Button>
                            {stat && stat.completed === 0 && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 px-2 text-xs"
                                disabled={removing === cred.userId}
                                onClick={() => handleRemoveAnnotator(cred.userId, cred.name)}
                              >
                                {removing === cred.userId
                                  ? "…"
                                  : (locale === "zh" ? "移除" : "Remove")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>

      {/* Video Samples Table */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          {locale === "zh" ? "评测题目管理" : "Evaluation Samples"}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {locale === "zh"
              ? `共 ${assets.length} 题`
              : `${assets.length} samples`}
          </span>
        </h3>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">ID</TableHead>
                <TableHead>{t("admin.samples.prompt")}</TableHead>
                <TableHead>{t("admin.samples.model")}</TableHead>
                <TableHead>{t("admin.samples.duration")}</TableHead>
                <TableHead>{t("admin.samples.evalProgress")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.map((asset) => {
                const primary = locale === "zh" ? asset.promptZh : asset.promptEn;
                const secondary = locale === "zh" ? asset.promptEn : asset.promptZh;
                return (
                  <TableRow key={asset.id} className="cursor-pointer hover:bg-accent/50">
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {asset.externalId}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <Link href={`/admin/samples/${asset.id}`} className="block">
                        <p className="text-sm font-medium truncate">{primary}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {secondary}
                        </p>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{asset.modelName}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {asset.durationSec ? `${asset.durationSec}s` : "-"}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {asset.completedItems}/{asset.totalItems}
                      </span>
                      {asset.completedItems === asset.totalItems && asset.totalItems > 0 && (
                        <Badge variant="default" className="ml-2">
                          {t("admin.samples.done")}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {assets.length > 0 && (
          <div className="flex items-center justify-end gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("common.perPage")}</span>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="rounded-md border bg-card px-2 py-1 text-sm"
              >
                {PER_PAGE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n} {t("common.items")}
                  </option>
                ))}
              </select>
            </div>
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

      <PasswordResetDialog
        open={resetDialog.open}
        userId={resetDialog.userId}
        userName={resetDialog.userName}
        onClose={() => setResetDialog({ open: false, userId: null, userName: null })}
        onSuccess={handleResetSuccess}
      />
    </div>
  );
}

/**
 * Inline row for the "调整时间" (extend deadline) modal. Splits the datetime
 * into a native date picker + three independent numeric HH/MM/SS fill-in
 * inputs so admins can set second-precision values with keyboard entry,
 * instead of the browser's datetime-local picker which typically rounds to
 * minutes and hides the seconds spinner.
 */
function DeadlineAdjustRow({
  locale,
  defaultIso,
  submitting,
  onCancel,
  onSubmit,
}: {
  locale: "zh" | "en";
  defaultIso: string | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (iso: string) => void;
}) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const init = defaultIso ? new Date(defaultIso) : new Date();
  const [datePart, setDatePart] = useState(
    `${init.getFullYear()}-${pad(init.getMonth() + 1)}-${pad(init.getDate())}`,
  );
  const [hh, setHH] = useState(pad(init.getHours()));
  const [mm, setMM] = useState(pad(init.getMinutes()));
  const [ss, setSS] = useState(pad(init.getSeconds()));

  const clamp = (raw: string, max: number) => {
    const n = parseInt(raw, 10);
    if (isNaN(n)) return "00";
    return pad(Math.min(Math.max(n, 0), max));
  };

  const buildIso = (): string | null => {
    if (!datePart) return null;
    const h = clamp(hh, 23);
    const m = clamp(mm, 59);
    const s = clamp(ss, 59);
    const d = new Date(`${datePart}T${h}:${m}:${s}`);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const numField = (
    value: string,
    setter: (v: string) => void,
    max: number,
    label: string,
  ) => (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      value={value}
      aria-label={label}
      onChange={(e) => setter(e.target.value.replace(/\D/g, "").slice(0, 2))}
      onBlur={(e) => setter(clamp(e.target.value, max))}
      className="w-12 rounded-md border bg-card px-2 py-1.5 text-center font-mono text-sm"
    />
  );

  return (
    <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex-1 space-y-1">
        <label className="text-xs text-muted-foreground">
          {locale === "zh" ? "调整为" : "Set to"}
        </label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={datePart}
            onChange={(e) => setDatePart(e.target.value)}
            className="rounded-md border bg-card px-3 py-1.5 text-sm"
          />
          <div className="flex items-center gap-1">
            {numField(hh, setHH, 23, "HH")}
            <span className="text-sm font-mono text-muted-foreground">:</span>
            {numField(mm, setMM, 59, "MM")}
            <span className="text-sm font-mono text-muted-foreground">:</span>
            {numField(ss, setSS, 59, "SS")}
          </div>
          <span className="text-xs text-muted-foreground">
            {locale === "zh" ? "时:分:秒" : "HH:MM:SS"}
          </span>
        </div>
      </div>
      <Button
        size="sm"
        disabled={submitting || !datePart}
        onClick={() => {
          const iso = buildIso();
          if (iso) onSubmit(iso);
        }}
        className="h-8 shrink-0"
      >
        {submitting
          ? (locale === "zh" ? "提交中…" : "Saving…")
          : (locale === "zh" ? "确认调整" : "Confirm")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onCancel}
        className="h-8 shrink-0"
      >
        {locale === "zh" ? "取消" : "Cancel"}
      </Button>
    </div>
  );
}
