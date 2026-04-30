"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  previewAnnotatorBatch,
  bulkCreateAnnotators,
  type BatchCreateSummaryRow,
  type BatchPreview,
} from "@/app/(main)/admin/annotators/batch-action";

type Step = "upload" | "preview" | "result";

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — plenty of room for thousands of rows
const ACCEPT =
  ".xlsx,.xls,.csv,text/csv,application/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/plain";

export function BatchAnnotatorUpload() {
  const { locale } = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [parseErrors, setParseErrors] = useState<BatchPreview["errors"]>([]);
  const [result, setResult] = useState<{
    created: BatchCreateSummaryRow[];
    skippedExisting: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("upload");
    setFileName(null);
    setPreview(null);
    setParseErrors([]);
    setResult(null);
    setBusy(false);
    setTopError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const closeAll = useCallback(() => {
    if (busy) return;
    setOpen(false);
    // Delay reset so the close animation doesn't flash the upload step.
    setTimeout(reset, 200);
  }, [busy, reset]);

  const onFilePicked = useCallback(async (file: File) => {
    setTopError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setTopError(
        locale === "zh"
          ? `文件大小超过 5MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`
          : `File exceeds 5MB (got ${(file.size / 1024 / 1024).toFixed(1)}MB)`,
      );
      return;
    }

    setBusy(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const base64 = bufferToBase64(new Uint8Array(buf));
      const mime = file.type || guessMimeFromName(file.name);
      const res = await previewAnnotatorBatch(base64, mime);
      if (res.status === "error") {
        setTopError(res.message);
        return;
      }
      setPreview(res.preview);
      setParseErrors(res.preview.errors);
      setStep("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to read file";
      setTopError(msg);
    } finally {
      setBusy(false);
    }
  }, [locale]);

  const handleConfirmImport = useCallback(async () => {
    if (!preview || preview.rows.length === 0) return;
    setBusy(true);
    setTopError(null);
    try {
      const res = await bulkCreateAnnotators(preview.rows);
      if (res.status === "error") {
        setTopError(res.message);
        if (res.errors && res.errors.length > 0) setParseErrors(res.errors);
        return;
      }
      setResult({ created: res.created, skippedExisting: res.skippedExisting });
      setStep("result");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }, [preview, router]);

  const downloadResultCsv = useCallback(() => {
    if (!result) return;
    const rows = [
      ["rowNumber", "name", "email", "accountType", "groupName", "password", "status", "message"],
      ...result.created.map((r) => [
        String(r.rowNumber),
        r.name,
        r.email,
        r.accountType,
        r.groupName ?? "",
        r.password,
        r.status,
        r.message ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotator-batch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const previewStats = preview?.stats;
  const hasBlockingErrors = parseErrors.length > 0;
  const createdCount = result?.created.filter((r) => r.status === "created").length ?? 0;
  const failedCount = result?.created.filter((r) => r.status === "error").length ?? 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        {locale === "zh" ? "批量添加评测员" : "Batch Add Annotators"}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {locale === "zh" ? "批量添加评测员" : "Batch Add Annotators"}
            </DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? "上传 xlsx 或 csv 文件，支持列：name / email / accountType / group。系统自动生成密码。"
                : "Upload an xlsx or csv file with columns: name / email / accountType / group. Passwords are auto-generated."}
            </DialogDescription>
          </DialogHeader>

          {step === "upload" && (
            <div className="space-y-4">
              <label
                htmlFor="batch-file-input"
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/20 px-6 py-10 text-center transition-colors hover:bg-muted/40 ${
                  busy ? "pointer-events-none opacity-60" : ""
                }`}
              >
                <FileSpreadsheet className="mb-2 h-8 w-8 text-muted-foreground" />
                <div className="text-sm font-medium">
                  {busy
                    ? (locale === "zh" ? "解析中…" : "Parsing…")
                    : (locale === "zh" ? "点击选择文件或拖拽到此" : "Click to choose a file")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {locale === "zh"
                    ? ".xlsx / .xls / .csv  ·  最大 5MB"
                    : ".xlsx / .xls / .csv  ·  max 5MB"}
                </div>
              </label>
              <input
                id="batch-file-input"
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFilePicked(f);
                }}
              />

              <details className="rounded-md border bg-card/50 p-3 text-xs">
                <summary className="cursor-pointer font-medium">
                  {locale === "zh" ? "列头格式说明" : "Column format"}
                </summary>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>
                    <code className="font-mono">name</code> ·{" "}
                    <span>{locale === "zh" ? "姓名 / name（必填）" : "Full name (required)"}</span>
                  </div>
                  <div>
                    <code className="font-mono">email</code> ·{" "}
                    <span>{locale === "zh" ? "邮箱 / email（必填，唯一）" : "Email (required, unique)"}</span>
                  </div>
                  <div>
                    <code className="font-mono">accountType</code> ·{" "}
                    <span>
                      INTERNAL / VENDOR{" "}
                      {locale === "zh" ? "（或 内部 / 外包，留空默认 INTERNAL）" : "(or 内部 / 外包, blank = INTERNAL)"}
                    </span>
                  </div>
                  <div>
                    <code className="font-mono">group</code> ·{" "}
                    <span>{locale === "zh" ? "分组名（可选，不存在会自动创建）" : "Group name (optional, auto-created if missing)"}</span>
                  </div>
                </div>
              </details>

              {topError && <ErrorBanner text={topError} />}
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {fileName}
                </Badge>
                {previewStats && (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {locale === "zh" ? "有效行" : "Valid rows"}:{" "}
                      <span className="font-mono font-medium text-foreground">{previewStats.totalRows}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {locale === "zh" ? "内部" : "Internal"}:{" "}
                      <span className="font-mono font-medium text-foreground">{previewStats.internal}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {locale === "zh" ? "外包" : "Vendor"}:{" "}
                      <span className="font-mono font-medium text-foreground">{previewStats.outsourced}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {locale === "zh" ? "带分组" : "With group"}:{" "}
                      <span className="font-mono font-medium text-foreground">{previewStats.withGroup}</span>
                    </span>
                  </>
                )}
              </div>

              {parseErrors.length > 0 && (
                <div className="space-y-1 rounded-md border border-red-500/30 bg-red-500/10 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-red-700 dark:text-red-400">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {locale === "zh"
                      ? `发现 ${parseErrors.length} 处错误，修正后重新上传`
                      : `Found ${parseErrors.length} error(s). Fix and re-upload.`}
                  </div>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto pl-5 text-xs text-red-600 dark:text-red-400">
                    {parseErrors.slice(0, 50).map((e, i) => (
                      <li key={i} className="list-disc">
                        {locale === "zh" ? "第" : "Row"} {e.row}
                        {e.column ? ` · ${e.column}` : ""}: {e.message}
                      </li>
                    ))}
                    {parseErrors.length > 50 && (
                      <li className="text-muted-foreground">
                        {locale === "zh" ? `（另有 ${parseErrors.length - 50} 条省略）` : `(${parseErrors.length - 50} more not shown)`}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {preview.rows.length > 0 && (
                <div className="max-h-[40vh] overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>{locale === "zh" ? "姓名" : "Name"}</TableHead>
                        <TableHead>{locale === "zh" ? "邮箱" : "Email"}</TableHead>
                        <TableHead>{locale === "zh" ? "类型" : "Type"}</TableHead>
                        <TableHead>{locale === "zh" ? "分组" : "Group"}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.rows.slice(0, 200).map((r) => (
                        <TableRow key={r.rowNumber}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                          <TableCell className="text-sm">{r.name}</TableCell>
                          <TableCell className="font-mono text-xs">{r.email}</TableCell>
                          <TableCell>
                            <Badge variant={r.accountType === "INTERNAL" ? "default" : "secondary"} className="text-[10px]">
                              {r.accountType === "INTERNAL"
                                ? (locale === "zh" ? "内部" : "Internal")
                                : (locale === "zh" ? "外包" : "Vendor")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.groupName ?? <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview.rows.length > 200 && (
                    <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                      {locale === "zh"
                        ? `只显示前 200 行（共 ${preview.rows.length} 行有效数据，全部会被导入）`
                        : `Showing first 200 rows (${preview.rows.length} valid total; all will be imported)`}
                    </div>
                  )}
                </div>
              )}

              {topError && <ErrorBanner text={topError} />}
            </div>
          )}

          {step === "result" && result && (
            <div className="space-y-3">
              <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3">
                <div className="flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {locale === "zh" ? "导入完成" : "Import complete"}
                </div>
                <div className="mt-1 text-xs text-green-700 dark:text-green-400">
                  {locale === "zh"
                    ? `新建 ${createdCount} 个账号，跳过 ${result.skippedExisting} 个已存在邮箱${failedCount > 0 ? `，失败 ${failedCount} 行` : ""}`
                    : `Created ${createdCount}, skipped ${result.skippedExisting} existing${failedCount > 0 ? `, ${failedCount} failed` : ""}`}
                </div>
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                {locale === "zh"
                  ? "密码仅在此次下载中可见。关闭对话框后无法再次查看，请立即下载 CSV。"
                  : "Passwords are shown only in this download. They cannot be re-retrieved after closing — download the CSV now."}
              </div>

              <div className="max-h-[40vh] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{locale === "zh" ? "姓名" : "Name"}</TableHead>
                      <TableHead>{locale === "zh" ? "邮箱" : "Email"}</TableHead>
                      <TableHead>{locale === "zh" ? "初始密码" : "Initial Password"}</TableHead>
                      <TableHead>{locale === "zh" ? "状态" : "Status"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.created.map((r) => (
                      <TableRow key={`${r.rowNumber}-${r.email}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{r.rowNumber}</TableCell>
                        <TableCell className="text-sm">{r.name}</TableCell>
                        <TableCell className="font-mono text-xs">{r.email}</TableCell>
                        <TableCell>
                          {r.password ? (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all">{r.password}</code>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.status === "created"
                                ? "default"
                                : r.status === "skipped"
                                  ? "secondary"
                                  : "destructive"
                            }
                            className="text-[10px]"
                          >
                            {r.status === "created"
                              ? (locale === "zh" ? "新建" : "Created")
                              : r.status === "skipped"
                                ? (locale === "zh" ? "已存在" : "Existing")
                                : (locale === "zh" ? "失败" : "Failed")}
                          </Badge>
                          {r.message && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground" title={r.message}>
                              {r.message}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            {step === "upload" && (
              <Button variant="outline" onClick={closeAll} disabled={busy}>
                {locale === "zh" ? "取消" : "Cancel"}
              </Button>
            )}

            {step === "preview" && preview && (
              <>
                <Button variant="outline" onClick={reset} disabled={busy}>
                  {locale === "zh" ? "重新上传" : "Re-upload"}
                </Button>
                <Button
                  onClick={handleConfirmImport}
                  disabled={busy || hasBlockingErrors || preview.rows.length === 0}
                >
                  {busy
                    ? (locale === "zh" ? "导入中…" : "Importing…")
                    : (locale === "zh" ? `确认导入 ${preview.rows.length} 行` : `Import ${preview.rows.length} rows`)}
                </Button>
              </>
            )}

            {step === "result" && (
              <>
                <Button variant="outline" onClick={downloadResultCsv}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {locale === "zh" ? "下载密码 CSV" : "Download passwords CSV"}
                </Button>
                <Button onClick={closeAll}>
                  {locale === "zh" ? "完成" : "Done"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------- small helpers ---------- */

function ErrorBanner({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

/**
 * Convert a Uint8Array into base64 without blowing the call stack on large files.
 * `btoa(String.fromCharCode(...arr))` would spread-explode on big arrays.
 */
function bufferToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
