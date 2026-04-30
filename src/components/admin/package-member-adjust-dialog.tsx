"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, UserPlus, UserMinus, Search, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/context";
import { adjustPackageAssignment } from "@/app/(main)/admin/annotators/assignment-action";

interface Candidate {
  id: string;
  name: string;
  email: string;
  accountType: string;
}

interface CurrentMember extends Candidate {
  completed: number;
  total: number;
}

interface PackageOption {
  id: string;
  name: string;
  taskType: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  packages: PackageOption[];
  currentMembersByPkg: Map<string, CurrentMember[]>;
  allUsers: Candidate[];
  initialPackageId?: string;
}

/**
 * Two-column dialog to bulk add + remove annotators on a single package.
 *
 * Shape:
 * - Top: package selector (defaults to first pkg that has assignments)
 * - Left column: currently-assigned members — can be marked for removal
 * - Right column: unassigned candidates — can be marked for addition
 * - COMPLETED items on removed users are preserved server-side; the dialog
 *   shows a warning count if any of the selected removals have completed work
 *   so the operator explicitly acknowledges the partial-preservation semantics.
 */
export function PackageMemberAdjustDialog({
  open,
  onClose,
  packages,
  currentMembersByPkg,
  allUsers,
  initialPackageId,
}: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [packageId, setPackageId] = useState<string>(
    initialPackageId ?? packages[0]?.id ?? ""
  );
  const [removeSelected, setRemoveSelected] = useState<Set<string>>(new Set());
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "ok" | "error" } | null>(null);

  // Reset selection state when pkg changes so selections don't leak
  // across packages (common source of "I thought I removed them" bugs).
  const handlePackageChange = (pid: string) => {
    setPackageId(pid);
    setRemoveSelected(new Set());
    setAddSelected(new Set());
    setMessage(null);
  };

  const currentMembers = useMemo(
    () => currentMembersByPkg.get(packageId) ?? [],
    [currentMembersByPkg, packageId]
  );
  const currentMemberIds = useMemo(
    () => new Set(currentMembers.map((m) => m.id)),
    [currentMembers]
  );

  // Candidates = all annotators minus those already on the package
  const candidates = useMemo(
    () => allUsers.filter((u) => !currentMemberIds.has(u.id)),
    [allUsers, currentMemberIds]
  );

  const filteredLeft = useMemo(() => {
    const q = leftSearch.trim().toLowerCase();
    if (!q) return currentMembers;
    return currentMembers.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [currentMembers, leftSearch]);

  const filteredRight = useMemo(() => {
    const q = rightSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [candidates, rightSearch]);

  // Count members in remove set that have any COMPLETED work — these will be
  // preserved server-side but the user should see the cost of removal up front.
  const removeWithCompleted = useMemo(
    () =>
      currentMembers.filter(
        (m) => removeSelected.has(m.id) && m.completed > 0
      ),
    [currentMembers, removeSelected]
  );

  const toggleRemove = (id: string) => {
    setRemoveSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAdd = (id: string) => {
    setAddSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalChanges = removeSelected.size + addSelected.size;
  const canSubmit = !busy && packageId && totalChanges > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    // Surface the completed-work warning BEFORE the destructive action so the
    // operator acknowledges what they're preserving, not just what they're deleting.
    if (removeWithCompleted.length > 0) {
      const warnText =
        locale === "zh"
          ? `${removeWithCompleted.length} 名待移除评测员存在已完成项，这些记录将保留；仅删除未完成项。继续？`
          : `${removeWithCompleted.length} annotator(s) to remove have completed work; their completed items will be PRESERVED and only pending items deleted. Continue?`;
      if (!window.confirm(warnText)) return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const res = await adjustPackageAssignment(
        packageId,
        Array.from(addSelected),
        Array.from(removeSelected)
      );
      if (res.status === "ok") {
        const addedNew = res.data.added.filter((a) => !a.alreadyAssigned).length;
        const addedItems = res.data.added.reduce(
          (sum, a) => sum + a.itemCount,
          0
        );
        setMessage({
          text:
            locale === "zh"
              ? `已添加 ${addedNew} 人（新建 ${addedItems} 条），移除 ${res.data.removed} 条未完成项${res.data.skippedCompleted > 0 ? `（保留 ${res.data.skippedCompleted} 条已完成项）` : ""}`
              : `Added ${addedNew} user(s) (${addedItems} new items), removed ${res.data.removed} pending${res.data.skippedCompleted > 0 ? ` (preserved ${res.data.skippedCompleted} completed)` : ""}`,
          type: "ok",
        });
        setRemoveSelected(new Set());
        setAddSelected(new Set());
        startTransition(() => router.refresh());
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">
              {locale === "zh" ? "按任务批量调整成员" : "Adjust Package Members"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {locale === "zh"
                ? "为选中任务批量添加或移除评测员。已完成的评测条目将保留。"
                : "Bulk add or remove annotators for the selected package. Completed evaluation items are preserved."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Package selector */}
        <div className="border-b px-5 py-3">
          <label className="text-xs font-medium text-muted-foreground">
            {locale === "zh" ? "选择任务" : "Package"}
          </label>
          <select
            value={packageId}
            onChange={(e) => handlePackageChange(e.target.value)}
            className="mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {packages.length === 0 ? (
              <option value="">
                {locale === "zh" ? "暂无可调整的任务" : "No packages available"}
              </option>
            ) : (
              packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.taskType})
                </option>
              ))
            )}
          </select>
        </div>

        {/* Two-column picker */}
        <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden border-b md:grid-cols-2 md:divide-x">
          {/* Left: current members */}
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
              <div className="flex items-center gap-2">
                <UserMinus className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {locale === "zh" ? "当前成员" : "Current Members"}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {currentMembers.length}
                </Badge>
              </div>
              {removeSelected.size > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  {locale === "zh"
                    ? `待移除 ${removeSelected.size}`
                    : `${removeSelected.size} to remove`}
                </Badge>
              )}
            </div>
            <div className="border-b px-4 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={leftSearch}
                  onChange={(e) => setLeftSearch(e.target.value)}
                  placeholder={locale === "zh" ? "搜索..." : "Search..."}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredLeft.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {locale === "zh"
                    ? currentMembers.length === 0
                      ? "此任务尚无成员"
                      : "无匹配"
                    : currentMembers.length === 0
                      ? "No members yet"
                      : "No matches"}
                </div>
              ) : (
                filteredLeft.map((m) => {
                  const selected = removeSelected.has(m.id);
                  const pct =
                    m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0;
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center gap-2 border-b px-4 py-2 transition-colors hover:bg-accent/40 ${
                        selected ? "bg-red-500/5" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleRemove(m.id)}
                        className="h-4 w-4 cursor-pointer accent-red-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {m.name}
                          </span>
                          <Badge
                            variant={m.accountType === "INTERNAL" ? "default" : "secondary"}
                            className="shrink-0 text-[9px] px-1 py-0"
                          >
                            {m.accountType === "INTERNAL"
                              ? t("admin.annotators.internal")
                              : t("admin.annotators.vendor")}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="truncate font-mono">{m.email}</span>
                          <span className="shrink-0 font-mono tabular-nums">
                            {m.completed}/{m.total} · {pct}%
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: candidates */}
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
              <div className="flex items-center gap-2">
                <UserPlus className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {locale === "zh" ? "可添加候选人" : "Available Candidates"}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {candidates.length}
                </Badge>
              </div>
              {addSelected.size > 0 && (
                <Badge
                  variant="outline"
                  className="border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
                >
                  {locale === "zh"
                    ? `待添加 ${addSelected.size}`
                    : `${addSelected.size} to add`}
                </Badge>
              )}
            </div>
            <div className="border-b px-4 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={rightSearch}
                  onChange={(e) => setRightSearch(e.target.value)}
                  placeholder={locale === "zh" ? "搜索..." : "Search..."}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredRight.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {locale === "zh"
                    ? candidates.length === 0
                      ? "所有评测员均已分配"
                      : "无匹配"
                    : candidates.length === 0
                      ? "All annotators already assigned"
                      : "No matches"}
                </div>
              ) : (
                filteredRight.map((c) => {
                  const selected = addSelected.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-2 border-b px-4 py-2 transition-colors hover:bg-accent/40 ${
                        selected ? "bg-emerald-500/5" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleAdd(c.id)}
                        className="h-4 w-4 cursor-pointer accent-emerald-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">
                            {c.name}
                          </span>
                          <Badge
                            variant={c.accountType === "INTERNAL" ? "default" : "secondary"}
                            className="shrink-0 text-[9px] px-1 py-0"
                          >
                            {c.accountType === "INTERNAL"
                              ? t("admin.annotators.internal")
                              : t("admin.annotators.vendor")}
                          </Badge>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {c.email}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Warnings + message strip */}
        {(removeWithCompleted.length > 0 || message) && (
          <div className="space-y-2 border-b px-5 py-2">
            {removeWithCompleted.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {locale === "zh"
                    ? `${removeWithCompleted.length} 名待移除评测员存在已完成项，这些记录将保留。`
                    : `${removeWithCompleted.length} annotator(s) to remove have completed work — those items will be preserved.`}
                </span>
              </div>
            )}
            {message && (
              <div
                className={`rounded-md border px-3 py-2 text-xs ${
                  message.type === "ok"
                    ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                    : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
                }`}
              >
                {message.text}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {locale === "zh"
              ? `待提交变更：+${addSelected.size} / -${removeSelected.size}`
              : `Pending changes: +${addSelected.size} / -${removeSelected.size}`}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
              {busy
                ? locale === "zh"
                  ? "提交中..."
                  : "Submitting..."
                : locale === "zh"
                  ? "提交变更"
                  : "Apply Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
