"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Download,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  bulkCreateAnnotators,
  type BatchCreateSummaryRow,
} from "@/app/(main)/admin/annotators/batch-action";
import { BatchAnnotatorUpload } from "@/components/admin/batch-annotator-upload";

type AccountType = "INTERNAL" | "VENDOR";

interface DraftRow {
  // Stable client-side id so React keys survive row removal without reshuffling.
  id: string;
  name: string;
  email: string;
  accountType: AccountType;
  groupName: string;
}

interface RowError {
  rowId: string;
  field: "name" | "email";
  message: string;
}

type Step = "edit" | "result";

const MAX_ROWS = 100;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function makeEmptyRow(): DraftRow {
  // crypto.randomUUID is available in all modern browsers and Node 19+.
  // Fallback for older runtimes is unnecessary here (admin UI in browser).
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `r-${Math.random().toString(36).slice(2)}`,
    name: "",
    email: "",
    accountType: "INTERNAL",
    groupName: "",
  };
}

export function InlineBatchAnnotatorForm() {
  const { locale } = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("edit");
  const [rows, setRows] = useState<DraftRow[]>(() => [
    makeEmptyRow(),
    makeEmptyRow(),
    makeEmptyRow(),
  ]);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    created: BatchCreateSummaryRow[];
    skippedExisting: number;
  } | null>(null);

  const reset = useCallback(() => {
    setStep("edit");
    setRows([makeEmptyRow(), makeEmptyRow(), makeEmptyRow()]);
    setRowErrors([]);
    setTopError(null);
    setBusy(false);
    setResult(null);
  }, []);

  const closeAll = useCallback(() => {
    if (busy) return;
    setOpen(false);
    // Let the close animation finish before wiping state.
    setTimeout(reset, 200);
  }, [busy, reset]);

  const addRow = useCallback(() => {
    setRows((prev) => {
      if (prev.length >= MAX_ROWS) return prev;
      return [...prev, makeEmptyRow()];
    });
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      // Keep at least one row so the table never collapses to empty.
      if (prev.length <= 1) return [makeEmptyRow()];
      return prev.filter((r) => r.id !== id);
    });
    setRowErrors((prev) => prev.filter((e) => e.rowId !== id));
  }, []);

  const updateRow = useCallback(
    <K extends keyof Omit<DraftRow, "id">>(
      id: string,
      field: K,
      value: DraftRow[K],
    ) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
      );
      // Clear per-field error as soon as the user edits that field.
      setRowErrors((prev) =>
        prev.filter((e) => !(e.rowId === id && e.field === field)),
      );
    },
    [],
  );

  // Derive "non-empty" row count. A row is considered filled-in only when
  // it has any of (name, email, groupName) — fully-empty trailing rows are
  // ignored at submit time so admins don't have to prune them manually.
  const activeRows = useMemo(
    () =>
      rows.filter(
        (r) => r.name.trim() || r.email.trim() || r.groupName.trim(),
      ),
    [rows],
  );

  const validateBeforeSubmit = useCallback((): RowError[] => {
    const errs: RowError[] = [];
    const emailLower = new Map<string, string>(); // lowercased email → rowId

    for (const r of activeRows) {
      const name = r.name.trim();
      const email = r.email.trim().toLowerCase();

      if (!name) {
        errs.push({
          rowId: r.id,
          field: "name",
          message: locale === "zh" ? "姓名不能为空" : "Name required",
        });
      }
      if (!email) {
        errs.push({
          rowId: r.id,
          field: "email",
          message: locale === "zh" ? "邮箱不能为空" : "Email required",
        });
        continue;
      }
      if (!EMAIL_REGEX.test(email)) {
        errs.push({
          rowId: r.id,
          field: "email",
          message: locale === "zh" ? "邮箱格式错误" : "Invalid email format",
        });
        continue;
      }
      if (emailLower.has(email)) {
        errs.push({
          rowId: r.id,
          field: "email",
          message:
            locale === "zh"
              ? `邮箱与其他行重复: ${email}`
              : `Duplicate email: ${email}`,
        });
      } else {
        emailLower.set(email, r.id);
      }
    }
    return errs;
  }, [activeRows, locale]);

  const handleSubmit = useCallback(async () => {
    setTopError(null);
    if (activeRows.length === 0) {
      setTopError(
        locale === "zh"
          ? "请至少填写一行有效数据"
          : "Please fill at least one row",
      );
      return;
    }
    const errs = validateBeforeSubmit();
    if (errs.length > 0) {
      setRowErrors(errs);
      setTopError(
        locale === "zh"
          ? `发现 ${errs.length} 处错误，修正后重试`
          : `Found ${errs.length} error(s). Fix and retry.`,
      );
      return;
    }

    setBusy(true);
    try {
      const payload = activeRows.map((r, idx) => ({
        rowNumber: idx + 1,
        name: r.name.trim(),
        email: r.email.trim().toLowerCase(),
        accountType: r.accountType,
        groupName: r.groupName.trim() || null,
      }));
      const res = await bulkCreateAnnotators(payload);
      if (res.status === "error") {
        setTopError(res.message);
        if (res.errors && res.errors.length > 0) {
          // Map server-side errors back onto row ids using rowNumber order.
          const mapped: RowError[] = res.errors.map((e) => ({
            rowId: activeRows[e.row - 1]?.id ?? "",
            field: (e.column as "name" | "email") === "email" ? "email" : "name",
            message: e.message,
          }));
          setRowErrors(mapped.filter((m) => m.rowId));
        }
        return;
      }
      setResult({ created: res.created, skippedExisting: res.skippedExisting });
      setStep("result");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unexpected error";
      setTopError(msg);
    } finally {
      setBusy(false);
    }
  }, [activeRows, locale, validateBeforeSubmit, router]);

  const downloadResultCsv = useCallback(() => {
    if (!result) return;
    const header = [
      "rowNumber",
      "name",
      "email",
      "accountType",
      "groupName",
      "password",
      "status",
      "message",
    ];
    const body = result.created.map((r) => [
      String(r.rowNumber),
      r.name,
      r.email,
      r.accountType,
      r.groupName ?? "",
      r.password,
      r.status,
      r.message ?? "",
    ]);
    const csv = [header, ...body].map((r) => r.map(csvEscape).join(",")).join("\n");
    // UTF-8 BOM keeps Chinese characters legible in Excel.
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `annotator-batch-${new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [result]);

  const rowErrorsById = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    for (const e of rowErrors) {
      if (!map.has(e.rowId)) map.set(e.rowId, new Map());
      map.get(e.rowId)!.set(e.field, e.message);
    }
    return map;
  }, [rowErrors]);

  const createdCount = result?.created.filter((r) => r.status === "created").length ?? 0;
  const failedCount = result?.created.filter((r) => r.status === "error").length ?? 0;

  return (
    <>
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1.5 h-3.5 w-3.5" />
        {locale === "zh" ? "批量添加评测员" : "Batch Add Annotators"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) closeAll();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {locale === "zh" ? "批量添加评测员" : "Batch Add Annotators"}
            </DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? "直接在表格中填写评测员信息，系统自动生成初始密码。分组名不存在时会自动创建。"
                : "Fill annotator rows directly in the table. Passwords are auto-generated; unknown groups are created on the fly."}
            </DialogDescription>
          </DialogHeader>

          {step === "edit" && (
            <div className="space-y-3">
              <div className="overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-10 pl-3 text-xs">#</TableHead>
                      <TableHead className="min-w-[140px] text-xs">
                        {locale === "zh" ? "姓名" : "Name"}{" "}
                        <span className="text-red-500">*</span>
                      </TableHead>
                      <TableHead className="min-w-[200px] text-xs">
                        {locale === "zh" ? "邮箱" : "Email"}{" "}
                        <span className="text-red-500">*</span>
                      </TableHead>
                      <TableHead className="min-w-[110px] text-xs">
                        {locale === "zh" ? "类型" : "Type"}
                      </TableHead>
                      <TableHead className="min-w-[140px] text-xs">
                        {locale === "zh" ? "分组" : "Group"}
                      </TableHead>
                      <TableHead className="w-10 pr-3" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, idx) => {
                      const errs = rowErrorsById.get(r.id);
                      const nameErr = errs?.get("name");
                      const emailErr = errs?.get("email");
                      return (
                        <TableRow key={r.id} className="align-top">
                          <TableCell className="pl-3 pt-3 font-mono text-xs text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="py-2">
                            <Input
                              value={r.name}
                              onChange={(e) =>
                                updateRow(r.id, "name", e.target.value)
                              }
                              className={`h-8 ${nameErr ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                              placeholder={locale === "zh" ? "张三" : "Alice"}
                            />
                            {nameErr && (
                              <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                                {nameErr}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2">
                            <Input
                              type="email"
                              value={r.email}
                              onChange={(e) =>
                                updateRow(r.id, "email", e.target.value)
                              }
                              className={`h-8 font-mono text-xs ${emailErr ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                              placeholder="user@example.com"
                            />
                            {emailErr && (
                              <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">
                                {emailErr}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="py-2">
                            <select
                              value={r.accountType}
                              onChange={(e) =>
                                updateRow(
                                  r.id,
                                  "accountType",
                                  e.target.value as AccountType,
                                )
                              }
                              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              <option value="INTERNAL">
                                {locale === "zh" ? "内部" : "Internal"}
                              </option>
                              <option value="VENDOR">
                                {locale === "zh" ? "外包" : "Vendor"}
                              </option>
                            </select>
                          </TableCell>
                          <TableCell className="py-2">
                            <Input
                              value={r.groupName}
                              onChange={(e) =>
                                updateRow(r.id, "groupName", e.target.value)
                              }
                              className="h-8"
                              placeholder={
                                locale === "zh" ? "可选" : "Optional"
                              }
                            />
                          </TableCell>
                          <TableCell className="pr-3 pt-3">
                            <button
                              type="button"
                              onClick={() => removeRow(r.id)}
                              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                              title={locale === "zh" ? "删除该行" : "Remove row"}
                              aria-label={locale === "zh" ? "删除该行" : "Remove row"}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addRow}
                  disabled={rows.length >= MAX_ROWS}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {locale === "zh" ? "增加一行" : "Add row"}
                </Button>
                <div className="text-xs text-muted-foreground">
                  {locale === "zh"
                    ? `待导入有效行：${activeRows.length} / ${rows.length}（上限 ${MAX_ROWS}）`
                    : `Ready to import: ${activeRows.length} / ${rows.length} (max ${MAX_ROWS})`}
                </div>
              </div>

              {topError && (
                <div className="flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-400">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{topError}</span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {locale === "zh"
                    ? "需要一次导入大量数据？"
                    : "Importing a lot at once?"}
                </span>
                <BatchAnnotatorUpload />
              </div>
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
                  ? "密码仅在此次可见。关闭对话框后无法再次查看，请立即下载 CSV。"
                  : "Passwords are visible only now. Close the dialog and they are gone — download the CSV immediately."}
              </div>

              <div className="max-h-[45vh] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{locale === "zh" ? "姓名" : "Name"}</TableHead>
                      <TableHead>{locale === "zh" ? "邮箱" : "Email"}</TableHead>
                      <TableHead>
                        {locale === "zh" ? "初始密码" : "Initial Password"}
                      </TableHead>
                      <TableHead>{locale === "zh" ? "状态" : "Status"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.created.map((r) => (
                      <TableRow key={`${r.rowNumber}-${r.email}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.rowNumber}
                        </TableCell>
                        <TableCell className="text-sm">{r.name}</TableCell>
                        <TableCell className="font-mono text-xs">{r.email}</TableCell>
                        <TableCell>
                          {r.password ? (
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs select-all">
                              {r.password}
                            </code>
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
                              ? locale === "zh"
                                ? "新建"
                                : "Created"
                              : r.status === "skipped"
                                ? locale === "zh"
                                  ? "已存在"
                                  : "Existing"
                                : locale === "zh"
                                  ? "失败"
                                  : "Failed"}
                          </Badge>
                          {r.message && (
                            <div
                              className="mt-0.5 text-[10px] text-muted-foreground"
                              title={r.message}
                            >
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
            {step === "edit" && (
              <>
                <Button variant="outline" onClick={closeAll} disabled={busy}>
                  {locale === "zh" ? "取消" : "Cancel"}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={busy || activeRows.length === 0}
                >
                  {busy
                    ? locale === "zh"
                      ? "创建中…"
                      : "Creating…"
                    : locale === "zh"
                      ? `创建 ${activeRows.length} 个账号`
                      : `Create ${activeRows.length} account${activeRows.length === 1 ? "" : "s"}`}
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

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
