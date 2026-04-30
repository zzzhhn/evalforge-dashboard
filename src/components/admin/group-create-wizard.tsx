"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, Crown, Info, Search, Users as UsersIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/context";

export interface WizardCandidate {
  id: string;
  name: string;
  email: string;
  accountType: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: WizardCandidate[];
  busy: boolean;
  onSubmit: (args: {
    name: string;
    description: string | null;
    adminId: string;
    memberIds: string[];
  }) => Promise<void>;
}

type Step = 1 | 2 | 3;

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const hasCJK = /[\u3400-\u9fff]/.test(trimmed);
  if (hasCJK) return [...trimmed].slice(-2).join("");
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function GroupCreateWizard({
  open,
  onOpenChange,
  candidates,
  busy,
  onSubmit,
}: Props) {
  const { locale } = useLocale();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [adminId, setAdminId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const reset = () => {
    setStep(1);
    setName("");
    setDescription("");
    setAdminId(null);
    setMemberIds(new Set());
    setQuery("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !busy) reset();
    onOpenChange(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...candidates].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true })
    );
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  // Step 3 memberIds exclude the admin (admin auto-added on submit server-side,
  // but we visually surface that separately).
  const step3Candidates = useMemo(
    () => filtered.filter((c) => c.id !== adminId),
    [filtered, adminId]
  );

  const toggleMember = (id: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setMemberIds(new Set(step3Candidates.map((c) => c.id)));
  };
  const clearAll = () => {
    setMemberIds(new Set());
  };

  const canNext =
    (step === 1 && name.trim().length > 0) ||
    (step === 2 && adminId !== null) ||
    step === 3;

  const handleSubmit = async () => {
    if (!adminId || !name.trim()) return;
    // Dedup and strip admin from memberIds; server action re-adds admin in the
    // membership set anyway, but sending a clean list avoids confusion.
    const ids = Array.from(memberIds).filter((id) => id !== adminId);
    await onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      adminId,
      memberIds: ids,
    });
    reset();
  };

  const adminInfo = candidates.find((c) => c.id === adminId) ?? null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" strokeWidth={1.75} />
            {locale === "zh" ? "新建 Group" : "Create group"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? locale === "zh"
                ? "第 1 步 / 共 3 步：基础信息"
                : "Step 1 of 3: basic info"
              : step === 2
                ? locale === "zh"
                  ? "第 2 步 / 共 3 步：指定组管理员"
                  : "Step 2 of 3: pick an admin"
                : locale === "zh"
                  ? "第 3 步 / 共 3 步:选择成员"
                  : "Step 3 of 3: select members"}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 pb-2">
          {([1, 2, 3] as const).map((s, idx) => (
            <div key={s} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  s < step
                    ? "bg-emerald-500 text-white"
                    : s === step
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {s < step ? <Check className="h-3 w-3" strokeWidth={2.5} /> : s}
              </div>
              {idx < 2 && (
                <div
                  className={`h-px flex-1 ${
                    s < step ? "bg-emerald-500" : "bg-border"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3 py-2">
          {step === 1 && (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {locale === "zh" ? "组名" : "Name"}
                  <span className="ml-1 text-rose-500">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={locale === "zh" ? "如 动作评测组" : "e.g. Motion Team"}
                  autoFocus
                  maxLength={64}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {locale === "zh" ? "描述" : "Description"}
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={locale === "zh" ? "（可选）" : "(optional)"}
                  maxLength={256}
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    locale === "zh" ? "搜索姓名或邮箱…" : "Search name or email…"
                  }
                  className="pl-8 text-sm"
                />
              </div>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                {filtered.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {locale === "zh" ? "无匹配用户" : "No matches"}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {filtered.map((c) => {
                      const selected = adminId === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setAdminId(c.id)}
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                              selected ? "bg-primary/10" : "hover:bg-muted/40"
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                              {initials(c.name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{c.name}</div>
                              <div className="truncate font-mono text-[11px] text-muted-foreground">
                                {c.email}
                              </div>
                            </div>
                            {selected && (
                              <Crown
                                className="h-4 w-4 shrink-0 text-amber-500"
                                strokeWidth={1.75}
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {adminInfo && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                  <span>
                    {locale === "zh"
                      ? `组管理员 ${adminInfo.name} 会自动加入本组，无需在下方勾选。`
                      : `Admin ${adminInfo.name} will be added automatically.`}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      locale === "zh" ? "搜索姓名或邮箱…" : "Search name or email…"
                    }
                    className="pl-8 text-sm"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={selectAll}
                >
                  {locale === "zh" ? "全选" : "Select all"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 text-xs"
                  onClick={clearAll}
                >
                  {locale === "zh" ? "清空" : "Clear"}
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border">
                {step3Candidates.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {locale === "zh" ? "无匹配用户" : "No matches"}
                  </div>
                ) : (
                  <ul className="divide-y">
                    {step3Candidates.map((c) => {
                      const checked = memberIds.has(c.id);
                      return (
                        <li key={c.id}>
                          <label className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMember(c.id)}
                              className="h-4 w-4"
                            />
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                              {initials(c.name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{c.name}</div>
                              <div className="truncate font-mono text-[11px] text-muted-foreground">
                                {c.email}
                              </div>
                            </div>
                            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {c.accountType === "INTERNAL"
                                ? locale === "zh" ? "内部" : "Internal"
                                : locale === "zh" ? "外包" : "Vendor"}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {locale === "zh"
                  ? `已选 ${memberIds.size} 人（加上管理员共 ${memberIds.size + 1} 人）`
                  : `${memberIds.size} selected (plus admin = ${memberIds.size + 1} total)`}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {step > 1 && (
              <Button
                variant="ghost"
                onClick={() => setStep((s) => (s - 1) as Step)}
                disabled={busy}
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" strokeWidth={1.75} />
                {locale === "zh" ? "上一步" : "Back"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={busy}
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canNext || busy}
              >
                {locale === "zh" ? "下一步" : "Next"}
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={busy || !adminId}>
                {busy
                  ? "…"
                  : locale === "zh"
                    ? "创建"
                    : "Create"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
