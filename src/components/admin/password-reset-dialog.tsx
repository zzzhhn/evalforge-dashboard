"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/context";
import {
  resetAnnotatorPassword,
  setCustomAnnotatorPassword,
} from "@/app/(main)/admin/samples/package/[packageId]/action";

type Mode = "choose" | "random_confirm" | "custom_input" | "custom_confirm";

interface Props {
  open: boolean;
  userId: string | null;
  userName: string | null;
  onClose: () => void;
  onSuccess: (userId: string, plaintext: string) => void;
}

/**
 * Two-path password reset dialog:
 *   - Random: generate a fresh random password (existing behavior).
 *   - Custom: admin-supplied password with mandatory double-confirm to avoid typos.
 *
 * The plaintext is surfaced once via `onSuccess`; bcrypt hashes are one-way, so
 * there is no "view current password" path — by design.
 */
export function PasswordResetDialog({ open, userId, userName, onClose, onSuccess }: Props) {
  const { locale } = useLocale();
  const [mode, setMode] = useState<Mode>("choose");
  const [customPwd, setCustomPwd] = useState("");
  const [customPwd2, setCustomPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset transient state whenever the dialog opens for a new user.
  useEffect(() => {
    if (open) {
      setMode("choose");
      setCustomPwd("");
      setCustomPwd2("");
      setError(null);
      setBusy(false);
    }
  }, [open, userId]);

  const closeAll = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  const performRandom = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await resetAnnotatorPassword(userId);
      if (res.status === "ok") {
        onSuccess(userId, res.password);
        onClose();
      } else {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }, [userId, onSuccess, onClose]);

  const performCustom = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await setCustomAnnotatorPassword(userId, customPwd);
      if (res.status === "ok") {
        onSuccess(userId, res.password);
        onClose();
      } else {
        setError(res.message);
        setMode("custom_input");
      }
    } finally {
      setBusy(false);
    }
  }, [userId, customPwd, onSuccess, onClose]);

  // Lightweight client-side pre-check; the server revalidates.
  const customPwdError = (): string | null => {
    if (customPwd.length === 0) return null;
    if (customPwd.length < 8) {
      return locale === "zh" ? "密码至少 8 个字符" : "Password must be at least 8 characters";
    }
    if (customPwd.length > 128) {
      return locale === "zh" ? "密码最多 128 个字符" : "Password must be at most 128 characters";
    }
    if (/\s/.test(customPwd)) {
      return locale === "zh" ? "密码不能包含空格" : "Password must not contain whitespace";
    }
    return null;
  };

  const canAdvanceToConfirm =
    customPwd.length >= 8 &&
    customPwd.length <= 128 &&
    !/\s/.test(customPwd) &&
    customPwd === customPwd2;

  const title =
    locale === "zh"
      ? `重置密码 — ${userName ?? ""}`
      : `Reset Password — ${userName ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) closeAll(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {locale === "zh"
              ? "旧密码将立即失效。新密码在重置成功后仅显示一次，请妥善记录。"
              : "The current password will be invalidated immediately. The new password is shown only once — record it carefully."}
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" && (
          <div className="space-y-3 py-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("random_confirm")}
              className="w-full rounded-md border bg-card p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
            >
              <div className="text-sm font-medium">
                {locale === "zh" ? "随机重置" : "Random Reset"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {locale === "zh"
                  ? "系统自动生成安全强度密码"
                  : "System generates a strong random password"}
              </div>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("custom_input")}
              className="w-full rounded-md border bg-card p-3 text-left transition-colors hover:bg-accent disabled:opacity-50"
            >
              <div className="text-sm font-medium">
                {locale === "zh" ? "自定义密码" : "Custom Password"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {locale === "zh"
                  ? "手动输入（至少 8 位，不含空格）"
                  : "Enter manually (min 8 chars, no whitespace)"}
              </div>
            </button>
          </div>
        )}

        {mode === "random_confirm" && (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              {locale === "zh"
                ? `确认为 ${userName} 生成一条随机新密码？此操作不可撤销。`
                : `Generate a new random password for ${userName}? This cannot be undone.`}
            </div>
          </div>
        )}

        {mode === "custom_input" && (
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {locale === "zh" ? "新密码" : "New password"}
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={customPwd}
                onChange={(e) => { setCustomPwd(e.target.value); setError(null); }}
                placeholder={locale === "zh" ? "至少 8 位" : "at least 8 chars"}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {locale === "zh" ? "重复输入以确认" : "Repeat to confirm"}
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={customPwd2}
                onChange={(e) => { setCustomPwd2(e.target.value); setError(null); }}
                placeholder={locale === "zh" ? "再次输入" : "type again"}
              />
            </div>
            {customPwdError() && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {customPwdError()}
              </div>
            )}
            {customPwd.length > 0 && customPwd2.length > 0 && customPwd !== customPwd2 && (
              <div className="text-xs text-red-600 dark:text-red-400">
                {locale === "zh" ? "两次输入不一致" : "Passwords do not match"}
              </div>
            )}
          </div>
        )}

        {mode === "custom_confirm" && (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              {locale === "zh"
                ? `确认为 ${userName} 设置自定义密码？旧密码立刻失效。`
                : `Confirm setting custom password for ${userName}? Current password becomes invalid immediately.`}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {mode === "choose" && (
            <Button variant="outline" onClick={closeAll} disabled={busy}>
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
          )}

          {mode === "random_confirm" && (
            <>
              <Button variant="outline" onClick={() => setMode("choose")} disabled={busy}>
                {locale === "zh" ? "返回" : "Back"}
              </Button>
              <Button onClick={performRandom} disabled={busy}>
                {busy
                  ? (locale === "zh" ? "重置中…" : "Resetting…")
                  : (locale === "zh" ? "确认重置" : "Confirm Reset")}
              </Button>
            </>
          )}

          {mode === "custom_input" && (
            <>
              <Button variant="outline" onClick={() => setMode("choose")} disabled={busy}>
                {locale === "zh" ? "返回" : "Back"}
              </Button>
              <Button
                onClick={() => setMode("custom_confirm")}
                disabled={busy || !canAdvanceToConfirm}
              >
                {locale === "zh" ? "下一步" : "Next"}
              </Button>
            </>
          )}

          {mode === "custom_confirm" && (
            <>
              <Button variant="outline" onClick={() => setMode("custom_input")} disabled={busy}>
                {locale === "zh" ? "返回" : "Back"}
              </Button>
              <Button onClick={performCustom} disabled={busy}>
                {busy
                  ? (locale === "zh" ? "设置中…" : "Setting…")
                  : (locale === "zh" ? "确认" : "Confirm")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
