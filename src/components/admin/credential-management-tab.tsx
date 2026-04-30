"use client";

// Credential management surface — SYSTEM admin only. Every row lists an
// annotator + their vault status. The eye button reveals the plaintext
// for 30 s then auto-hides; the rotate button opens a reset dialog. All
// actions hit server actions that audit-log every access BEFORE the
// plaintext crosses the wire, so nothing reaches the client without a
// trail.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Eye, EyeOff, RotateCcw, Search, Shield, Copy, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/context";
import {
  revealAnnotatorPassword,
  resetCredentialPassword,
} from "@/app/(main)/admin/annotators/credential-action";

interface CredentialRow {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  groupName: string | null;
  hasVault: boolean;
  lastResetAt: string | null;
}

interface Props {
  rows: CredentialRow[];
}

const AUTO_HIDE_MS = 30_000;

export function CredentialManagementTab({ rows: initialRows }: Props) {
  const { locale, t } = useLocale();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(initialRows);
  // Revealed plaintext keyed by userId; timer per entry.
  const [revealed, setRevealed] = useState<
    Record<string, { plaintext: string; expiresAt: number }>
  >({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { text: string; type: "ok" | "error" } | null
  >(null);
  const [resetDialog, setResetDialog] = useState<{
    open: boolean;
    userId: string | null;
    userName: string | null;
  }>({ open: false, userId: null, userName: null });

  useEffect(() => setRows(initialRows), [initialRows]);

  // Sweep expired reveals every second. Simple tick is fine — at most a
  // few dozen rows are revealed at once, React reconciliation is cheap.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setRevealed((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.groupName ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const handleReveal = useCallback(
    async (row: CredentialRow) => {
      if (revealed[row.userId]) {
        // Already visible — just hide.
        setRevealed((prev) => {
          const next = { ...prev };
          delete next[row.userId];
          return next;
        });
        return;
      }
      setBusyUserId(row.userId);
      setMessage(null);
      try {
        const res = await revealAnnotatorPassword(row.userId);
        if (res.status !== "ok") {
          setMessage({ text: res.message, type: "error" });
          return;
        }
        const data = res.data;
        if (!data.found) {
          const reason =
            data.reason === "no-vault"
              ? locale === "zh"
                ? "该评测员尚未入库（请先重置一次密码以填充）"
                : "Not yet vaulted — reset the password once to populate"
              : locale === "zh"
                ? "解密失败（密钥可能已轮换，请联系平台管理员）"
                : "Decryption failed (key may have rotated)";
          setMessage({ text: reason, type: "error" });
          return;
        }
        setRevealed((prev) => ({
          ...prev,
          [row.userId]: {
            plaintext: data.plaintext,
            expiresAt: Date.now() + AUTO_HIDE_MS,
          },
        }));
      } finally {
        setBusyUserId(null);
      }
    },
    [revealed, locale],
  );

  const handleResetRandom = useCallback(
    async (userId: string, userName: string) => {
      if (
        !confirm(
          locale === "zh"
            ? `确定为 ${userName} 生成新的随机密码？旧密码将立即失效。`
            : `Generate a new random password for ${userName}? The old one will stop working immediately.`,
        )
      )
        return;
      setBusyUserId(userId);
      setMessage(null);
      try {
        const res = await resetCredentialPassword(userId, { mode: "random" });
        if (res.status !== "ok") {
          setMessage({ text: res.message, type: "error" });
          return;
        }
        setRevealed((prev) => ({
          ...prev,
          [userId]: {
            plaintext: res.data.plaintext,
            expiresAt: Date.now() + AUTO_HIDE_MS,
          },
        }));
        setRows((prev) =>
          prev.map((r) =>
            r.userId === userId
              ? { ...r, hasVault: true, lastResetAt: new Date().toISOString() }
              : r,
          ),
        );
        setMessage({
          text:
            locale === "zh"
              ? "密码已重置并显示 30 秒"
              : "Password reset — shown for 30 s",
          type: "ok",
        });
        startTransition(() => {});
      } finally {
        setBusyUserId(null);
      }
    },
    [locale],
  );

  const handleCopy = async (plaintext: string) => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setMessage({
        text: locale === "zh" ? "已复制到剪贴板" : "Copied to clipboard",
        type: "ok",
      });
    } catch {
      setMessage({
        text: locale === "zh" ? "复制失败，请手动选择" : "Copy failed — select manually",
        type: "error",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Security banner */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <div className="font-medium text-amber-900 dark:text-amber-100">
            {locale === "zh"
              ? "密码管理 · 审计已开启"
              : "Credential management · audit enabled"}
          </div>
          <div className="mt-0.5 text-amber-800/80 dark:text-amber-100/70">
            {locale === "zh"
              ? "每次查看与重置都会写入带 IP / UA 的审计记录；明文 30 秒后自动隐藏。禁止截图或长期驻留。"
              : "Every view and reset is logged with IP and UA. Plaintext auto-hides after 30 s. No screenshots, no long retention."}
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {locale === "zh" ? "密码管理" : "Credentials"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {locale === "zh"
              ? `${filtered.length} 位评测员 · 其中 ${filtered.filter((r) => r.hasVault).length} 位可查看`
              : `${filtered.length} annotators · ${filtered.filter((r) => r.hasVault).length} viewable`}
          </p>
        </div>
        <div className="relative min-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={locale === "zh" ? "搜索姓名/邮箱/组" : "Search name/email/group"}
            className="h-9 pl-8"
          />
        </div>
      </div>

      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            message.type === "ok"
              ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">
                {locale === "zh" ? "评测员" : "Annotator"}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {locale === "zh" ? "分组 / 类型" : "Group / Type"}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {locale === "zh" ? "密码" : "Password"}
              </th>
              <th className="px-3 py-2 text-left font-medium">
                {locale === "zh" ? "最近更新" : "Last reset"}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {locale === "zh" ? "操作" : "Actions"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {locale === "zh" ? "无匹配" : "No matches"}
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const rev = revealed[row.userId];
              const remainingSec = rev
                ? Math.max(0, Math.ceil((rev.expiresAt - Date.now()) / 1000))
                : 0;
              return (
                <tr key={row.userId} className="hover:bg-accent/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {row.email}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={row.accountType === "INTERNAL" ? "default" : "secondary"}
                        className="text-[10px]"
                      >
                        {row.accountType === "INTERNAL"
                          ? locale === "zh"
                            ? "内部"
                            : "Internal"
                          : locale === "zh"
                            ? "外包"
                            : "Vendor"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {row.groupName ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {rev ? (
                      <div className="flex items-center gap-2">
                        <code className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                          {rev.plaintext}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => handleCopy(rev.plaintext)}
                          title={locale === "zh" ? "复制" : "Copy"}
                        >
                          <Copy className="h-3 w-3" strokeWidth={1.75} />
                        </Button>
                        <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">
                          {remainingSec}s
                        </span>
                      </div>
                    ) : row.hasVault ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        ••••••••
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                        <ShieldAlert className="h-3 w-3" strokeWidth={1.75} />
                        {locale === "zh" ? "未入库" : "Not vaulted"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.lastResetAt
                      ? new Date(row.lastResetAt).toLocaleString(
                          locale === "zh" ? "zh-CN" : "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busyUserId === row.userId || !row.hasVault}
                        onClick={() => handleReveal(row)}
                        title={
                          rev
                            ? locale === "zh" ? "隐藏" : "Hide"
                            : locale === "zh" ? "查看密码" : "Reveal"
                        }
                      >
                        {rev ? (
                          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                        ) : (
                          <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busyUserId === row.userId}
                        onClick={() => handleResetRandom(row.userId, row.name)}
                        title={locale === "zh" ? "重置为随机密码" : "Reset to random"}
                      >
                        <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={busyUserId === row.userId}
                        onClick={() =>
                          setResetDialog({
                            open: true,
                            userId: row.userId,
                            userName: row.name,
                          })
                        }
                      >
                        {locale === "zh" ? "自定义" : "Custom"}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CustomResetDialog
        open={resetDialog.open}
        userName={resetDialog.userName}
        onClose={() =>
          setResetDialog({ open: false, userId: null, userName: null })
        }
        onSubmit={async (newPassword) => {
          if (!resetDialog.userId) return;
          setBusyUserId(resetDialog.userId);
          try {
            const res = await resetCredentialPassword(resetDialog.userId, {
              mode: "custom",
              newPassword,
            });
            if (res.status !== "ok") {
              setMessage({ text: res.message, type: "error" });
              return;
            }
            setRevealed((prev) => ({
              ...prev,
              [resetDialog.userId!]: {
                plaintext: res.data.plaintext,
                expiresAt: Date.now() + AUTO_HIDE_MS,
              },
            }));
            setRows((prev) =>
              prev.map((r) =>
                r.userId === resetDialog.userId
                  ? {
                      ...r,
                      hasVault: true,
                      lastResetAt: new Date().toISOString(),
                    }
                  : r,
              ),
            );
            setResetDialog({ open: false, userId: null, userName: null });
            setMessage({
              text:
                locale === "zh"
                  ? "自定义密码已写入，并显示 30 秒"
                  : "Custom password set — shown for 30 s",
              type: "ok",
            });
          } finally {
            setBusyUserId(null);
          }
        }}
      />
    </div>
  );
}

function CustomResetDialog({
  open,
  userName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  userName: string | null;
  onClose: () => void;
  onSubmit: (pwd: string) => Promise<void>;
}) {
  const { locale } = useLocale();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPwd("");
      setConfirm("");
    }
  }, [open]);

  const canSubmit = pwd.length >= 8 && pwd === confirm && !submitting;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {locale === "zh" ? "设置自定义密码" : "Set custom password"}
          </DialogTitle>
          <DialogDescription>
            {userName
              ? locale === "zh"
                ? `为 ${userName} 设置新密码（≥ 8 字符，无空格）。`
                : `Set a new password for ${userName} (≥ 8 chars, no whitespace).`
              : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder={locale === "zh" ? "新密码" : "New password"}
            autoComplete="new-password"
          />
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={locale === "zh" ? "确认密码" : "Confirm"}
            autoComplete="new-password"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {locale === "zh" ? "取消" : "Cancel"}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onSubmit(pwd);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {locale === "zh" ? "确认" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
