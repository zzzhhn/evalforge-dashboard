"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  addAnnotatorToPackage,
  removeAnnotatorFromPackage,
  undoRemoveAnnotator,
  toggleAccountType,
} from "@/app/(main)/admin/samples/package/[packageId]/action";
import { PasswordResetDialog } from "@/components/admin/password-reset-dialog";

// ── Types ─────────────────────────────────────

interface PackageInfo {
  id: string;
  name: string;
  taskType: string;
  status: string;
}

interface AnnotatorInPackage {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  assigned: number;
  completed: number;
}

interface Props {
  packages: PackageInfo[];
  /** Map: packageId → annotators in that package */
  packageAnnotators: Record<string, AnnotatorInPackage[]>;
}

interface UndoEntry {
  userId: string;
  name: string;
  timer: ReturnType<typeof setTimeout>;
}

interface CredentialRow {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  assigned: number;
  completed: number;
  password: string | null;
}

export function AnnotatorMgmtPanel({ packages, packageAnnotators }: Props) {
  const { locale } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [selectedPkgId, setSelectedPkgId] = useState<string>(packages[0]?.id ?? "");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [resetDialog, setResetDialog] = useState<{
    open: boolean;
    userId: string | null;
    userName: string | null;
  }>({ open: false, userId: null, userName: null });
  const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  // Track newly revealed passwords (userId → plaintext)
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, string>>({});

  const annotators = packageAnnotators[selectedPkgId] ?? [];

  const rows: CredentialRow[] = annotators.map((a) => ({
    ...a,
    password: revealedPasswords[a.userId] ?? null,
  }));

  // ── Handlers ────────────────────────────────

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  const handleAdd = useCallback(async () => {
    if (!addName.trim() || !addEmail.trim() || !selectedPkgId) return;
    setAdding(true);
    setMessage(null);
    try {
      const res = await addAnnotatorToPackage(selectedPkgId, addName.trim(), addEmail.trim());
      if (res.status === "ok") {
        setRevealedPasswords((prev) => ({ ...prev, [res.userId]: res.password }));
        setAddName("");
        setAddEmail("");
        setMessage({
          text: locale === "zh"
            ? `${addName.trim()} 已添加，分配了 ${res.itemCount} 个评测任务`
            : `${addName.trim()} added with ${res.itemCount} items assigned`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setAdding(false);
    }
  }, [selectedPkgId, addName, addEmail, locale, refresh]);

  const handleRemove = useCallback(async (userId: string, name: string) => {
    setRemoving(userId);
    setMessage(null);
    try {
      const res = await removeAnnotatorFromPackage(selectedPkgId, userId);
      if (res.status === "ok") {
        const timer = setTimeout(() => {
          setUndoQueue((prev) => prev.filter((u) => u.userId !== userId));
        }, 30_000);
        setUndoQueue((prev) => [...prev, { userId, name, timer }]);
        setMessage({
          text: locale === "zh"
            ? `${name} 已移除（${res.deletedCount} 个未完成任务已删除），30秒内可撤销`
            : `${name} removed (${res.deletedCount} pending items deleted). Undo within 30s`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setRemoving(null);
    }
  }, [selectedPkgId, locale, refresh]);

  const handleUndo = useCallback(async (entry: UndoEntry) => {
    clearTimeout(entry.timer);
    setUndoQueue((prev) => prev.filter((u) => u.userId !== entry.userId));
    setMessage(null);
    const res = await undoRemoveAnnotator(selectedPkgId, entry.userId);
    if (res.status === "ok") {
      setMessage({
        text: locale === "zh"
          ? `已撤销移除 ${entry.name}，恢复了 ${res.itemCount} 个任务`
          : `Undone: restored ${entry.name} with ${res.itemCount} items`,
        type: "ok",
      });
      refresh();
    } else {
      setMessage({ text: res.message, type: "error" });
    }
  }, [selectedPkgId, locale, refresh]);

  const openResetDialog = useCallback((userId: string, name: string) => {
    setMessage(null);
    setResetDialog({ open: true, userId, userName: name });
  }, []);

  const handleResetSuccess = useCallback((userId: string, plaintext: string) => {
    setRevealedPasswords((prev) => ({ ...prev, [userId]: plaintext }));
    setMessage({
      text: locale === "zh" ? "密码已更新" : "Password updated",
      type: "ok",
    });
  }, [locale]);

  const handleToggleAccountType = useCallback(async (userId: string, name: string, currentType: string) => {
    const newType = currentType === "INTERNAL" ? "VENDOR" : "INTERNAL";
    const newLabel = locale === "zh"
      ? (newType === "INTERNAL" ? "内部" : "外包")
      : (newType === "INTERNAL" ? "Internal" : "Vendor");
    if (!window.confirm(
      locale === "zh"
        ? `确定将 ${name} 的归属改为「${newLabel}」？`
        : `Change ${name}'s account type to "${newLabel}"?`
    )) return;
    setToggling(userId);
    setMessage(null);
    try {
      const res = await toggleAccountType(userId);
      if (res.status === "ok") {
        setMessage({
          text: locale === "zh"
            ? `${name} 已改为${res.newType === "INTERNAL" ? "内部" : "外包"}`
            : `${name} changed to ${res.newType === "INTERNAL" ? "Internal" : "Vendor"}`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setToggling(null);
    }
  }, [locale, refresh]);

  // ── When switching package, clear transient state ──
  const handlePkgChange = useCallback((pkgId: string) => {
    // Clear undo timers
    for (const entry of undoQueue) clearTimeout(entry.timer);
    setSelectedPkgId(pkgId);
    setUndoQueue([]);
    setMessage(null);
    setRevealedPasswords({});
  }, [undoQueue]);

  // ── Render ──────────────────────────────────

  if (packages.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
        {locale === "zh" ? "暂无评测任务" : "No evaluation packages"}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Package selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">
          {locale === "zh" ? "评测任务" : "Package"}
        </label>
        <select
          value={selectedPkgId}
          onChange={(e) => handlePkgChange(e.target.value)}
          className="rounded-md border bg-card px-3 py-1.5 text-sm"
        >
          {packages.map((pkg) => (
            <option key={pkg.id} value={pkg.id}>
              {pkg.name} ({pkg.taskType})
              {pkg.status !== "PUBLISHED" ? ` [${pkg.status}]` : ""}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          {locale === "zh"
            ? `${rows.length} 名评测员`
            : `${rows.length} annotator${rows.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Status message */}
      {message && (
        <div className={`rounded-md px-3 py-2 text-sm ${
          message.type === "ok"
            ? "bg-green-500/10 text-green-700 dark:text-green-400"
            : "bg-red-500/10 text-red-700 dark:text-red-400"
        }`}>
          {message.text}
        </div>
      )}

      {/* Undo banners */}
      {undoQueue.map((entry) => (
        <div
          key={entry.userId}
          className="flex items-center justify-between rounded-md bg-amber-500/10 px-3 py-2 text-sm"
        >
          <span className="text-amber-700 dark:text-amber-400">
            {locale === "zh" ? `${entry.name} 已移除` : `${entry.name} removed`}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
            onClick={() => handleUndo(entry)}
          >
            {locale === "zh" ? "撤销" : "Undo"}
          </Button>
        </div>
      ))}

      {/* Add annotator form */}
      <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-3">
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">
            {locale === "zh" ? "姓名" : "Name"}
          </label>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            placeholder={locale === "zh" ? "如 User 11" : "e.g. User 11"}
            className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
        </div>
        <div className="flex-1 space-y-1">
          <label className="text-xs text-muted-foreground">
            {locale === "zh" ? "邮箱" : "Email"}
          </label>
          <input
            type="email"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            placeholder="user11@example.com"
            className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
        </div>
        <Button
          size="sm"
          disabled={adding || !addName.trim() || !addEmail.trim()}
          onClick={handleAdd}
          className="h-8 shrink-0"
        >
          {adding
            ? (locale === "zh" ? "添加中…" : "Adding…")
            : (locale === "zh" ? "添加评测员" : "Add Annotator")}
        </Button>
      </div>

      {/* Credentials table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{locale === "zh" ? "类型" : "Type"}</TableHead>
              <TableHead>{locale === "zh" ? "姓名" : "Name"}</TableHead>
              <TableHead>{locale === "zh" ? "邮箱" : "Email"}</TableHead>
              <TableHead>{locale === "zh" ? "密码" : "Password"}</TableHead>
              <TableHead className="text-center">
                {locale === "zh" ? "进度" : "Progress"}
              </TableHead>
              <TableHead className="text-right w-44">
                {locale === "zh" ? "操作" : "Actions"}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
                  {locale === "zh" ? "该任务暂无评测员" : "No annotators in this package"}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const isUndoing = undoQueue.some((u) => u.userId === row.userId);
                return (
                  <TableRow key={row.userId} className={isUndoing ? "opacity-40 pointer-events-none" : ""}>
                    <TableCell>
                      <button
                        disabled={toggling === row.userId}
                        onClick={() => handleToggleAccountType(row.userId, row.name, row.accountType)}
                        title={locale === "zh" ? "点击切换内部/外包" : "Click to toggle Internal/Vendor"}
                      >
                        <Badge
                          variant={row.accountType === "INTERNAL" ? "default" : "secondary"}
                          className="text-xs cursor-pointer hover:opacity-80 transition-opacity"
                        >
                          {toggling === row.userId
                            ? "…"
                            : row.accountType === "INTERNAL"
                              ? (locale === "zh" ? "内部" : "Internal")
                              : (locale === "zh" ? "外包" : "Vendor")}
                        </Badge>
                      </button>
                    </TableCell>
                    <TableCell className="font-medium text-sm">{row.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {row.email}
                    </TableCell>
                    <TableCell>
                      {row.password ? (
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono select-all">
                          {row.password}
                        </code>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {locale === "zh" ? "点击「重置密码」获取" : "Click Reset to reveal"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center text-sm">
                      <span className={
                        row.completed === row.assigned && row.assigned > 0
                          ? "text-green-600 dark:text-green-400 font-medium"
                          : ""
                      }>
                        {row.completed}/{row.assigned}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => openResetDialog(row.userId, row.name)}
                        >
                          {locale === "zh" ? "重置密码" : "Reset Pwd"}
                        </Button>
                        {row.completed === 0 && !isUndoing && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            disabled={removing === row.userId}
                            onClick={() => handleRemove(row.userId, row.name)}
                          >
                            {removing === row.userId
                              ? "…"
                              : (locale === "zh" ? "移除" : "Remove")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
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
