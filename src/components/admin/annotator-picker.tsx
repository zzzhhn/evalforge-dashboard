"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createAnnotatorInline } from "@/app/(main)/admin/samples/create/action";

export interface AnnotatorOption {
  id: string;
  name: string;
  email: string;
  accountType: "INTERNAL" | "VENDOR";
  groups: string[];
  activePackageCount: number;
  compositeScore: number | null;
}

type SortMode = "name" | "capability_desc" | "capability_asc" | "workload_asc";
type AccountFilter = "ALL" | "INTERNAL" | "VENDOR";

interface Props {
  options: AnnotatorOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Called after a new annotator is inline-created so the parent page can
   *  refresh its list (e.g. via `router.refresh()`). */
  onCreated?: (newAnnotator: AnnotatorOption) => void;
}

const PAGE_SIZES = [10, 20, 50, 100];

export function AnnotatorPicker({
  options,
  selectedIds,
  onChange,
  onCreated,
}: Props) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [pageSize, setPageSize] = useState<number>(20);
  const [page, setPage] = useState<number>(1);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newAccountType, setNewAccountType] = useState<"INTERNAL" | "VENDOR">("INTERNAL");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = options.filter((o) => {
      if (accountFilter !== "ALL" && o.accountType !== accountFilter) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q) ||
        o.groups.some((g) => g.toLowerCase().includes(q))
      );
    });

    // Sort. `null` capability goes to the end regardless of direction so
    // unassessed annotators don't clutter the top.
    const byCap = (a: AnnotatorOption, b: AnnotatorOption, dir: 1 | -1) => {
      if (a.compositeScore == null && b.compositeScore == null) return 0;
      if (a.compositeScore == null) return 1;
      if (b.compositeScore == null) return -1;
      return (a.compositeScore - b.compositeScore) * dir;
    };
    list.sort((a, b) => {
      if (sortMode === "capability_desc") return byCap(a, b, -1);
      if (sortMode === "capability_asc") return byCap(a, b, 1);
      if (sortMode === "workload_asc") return a.activePackageCount - b.activePackageCount;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return list;
  }, [options, query, accountFilter, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageSlice = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, clampedPage, pageSize]);

  const selectedSet = new Set(selectedIds);

  const toggle = (id: string) => {
    const next = selectedSet.has(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange(next);
  };

  const selectAllVisible = () => {
    const merged = new Set([...selectedIds, ...pageSlice.map((f) => f.id)]);
    onChange([...merged]);
  };
  const clearVisible = () => {
    const visibleIds = new Set(pageSlice.map((f) => f.id));
    onChange(selectedIds.filter((id) => !visibleIds.has(id)));
  };

  const resetCreateForm = () => {
    setNewName("");
    setNewEmail("");
    setNewAccountType("INTERNAL");
    setCreateError(null);
    setCreatedPassword(null);
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createAnnotatorInline({
        name: newName,
        email: newEmail,
        accountType: newAccountType,
      });
      if (res.status === "error") {
        setCreateError(res.message);
        return;
      }
      // Auto-select the newly created annotator.
      onChange([...selectedIds, res.user.id]);
      onCreated?.({
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        accountType: res.user.accountType,
        groups: [],
        activePackageCount: 0,
        compositeScore: null,
      });
      setCreatedPassword(res.password);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b p-2">
        <Input
          placeholder={t("admin.create.searchAnnotator")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          className="h-8 w-48"
        />
        <select
          value={accountFilter}
          onChange={(e) => {
            setAccountFilter(e.target.value as AccountFilter);
            setPage(1);
          }}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="ALL">{t("admin.create.allTypes")}</option>
          <option value="INTERNAL">{t("admin.packages.internal")}</option>
          <option value="VENDOR">{t("admin.packages.vendor")}</option>
        </select>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
          title="排序"
        >
          <option value="name">按姓名</option>
          <option value="capability_desc">能力分 高→低</option>
          <option value="capability_asc">能力分 低→高</option>
          <option value="workload_asc">负载 低→高</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            resetCreateForm();
            setShowCreate((v) => !v);
          }}
          className="h-8"
        >
          {showCreate ? "取消新增" : "+ 新增评测员"}
        </Button>
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={selectAllVisible}
            className="rounded border px-2 py-0.5 hover:bg-muted"
          >
            {t("admin.create.selectAll")}
          </button>
          <button
            type="button"
            onClick={clearVisible}
            className="rounded border px-2 py-0.5 hover:bg-muted"
          >
            {t("admin.create.clear")}
          </button>
          <span>
            {t("admin.create.selectedCount", { count: String(selectedIds.length) })}
          </span>
        </div>
      </div>

      {showCreate && (
        <div className="space-y-2 border-b bg-muted/30 p-3">
          {createdPassword ? (
            <div className="space-y-2 rounded-md border border-emerald-500 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
              <div className="font-semibold text-emerald-900 dark:text-emerald-200">
                评测员已创建 — 请立即复制密码（仅显示一次）
              </div>
              <code className="block select-all rounded border bg-background px-2 py-1 text-sm">
                {createdPassword}
              </code>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(createdPassword);
                  }}
                >
                  复制密码
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => {
                    resetCreateForm();
                    setShowCreate(false);
                  }}
                >
                  完成
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={resetCreateForm}
                >
                  继续创建下一位
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-2 md:grid-cols-3">
                <Input
                  placeholder="姓名"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-8"
                />
                <Input
                  placeholder="邮箱"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="h-8"
                />
                <select
                  value={newAccountType}
                  onChange={(e) =>
                    setNewAccountType(e.target.value as "INTERNAL" | "VENDOR")
                  }
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="INTERNAL">内部</option>
                  <option value="VENDOR">外包</option>
                </select>
              </div>
              {createError && (
                <div className="text-xs text-destructive">{createError}</div>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  type="button"
                  onClick={handleCreate}
                  disabled={creating || !newName.trim() || !newEmail.trim()}
                >
                  {creating ? "创建中…" : "创建并自动勾选"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  密码将自动生成，只显示一次
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <div>
        {pageSlice.length === 0 && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("admin.create.noAnnotators")}
          </div>
        )}
        <ul className="divide-y">
          {pageSlice.map((o) => {
            const checked = selectedSet.has(o.id);
            return (
              <li key={o.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.id)}
                    className="h-4 w-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{o.name}</span>
                      <Badge variant={o.accountType === "INTERNAL" ? "default" : "secondary"}>
                        {o.accountType === "INTERNAL"
                          ? t("admin.packages.internal")
                          : t("admin.packages.vendor")}
                      </Badge>
                      {o.groups.map((g) => (
                        <Badge key={g} variant="outline" className="text-xs">
                          {g}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="truncate">{o.email}</span>
                      <span>
                        {t("admin.create.workload")}: {o.activePackageCount}
                      </span>
                      <span>
                        {t("admin.create.capability")}:{" "}
                        {o.compositeScore != null ? o.compositeScore.toFixed(1) : "--"}
                      </span>
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t p-2 text-xs text-muted-foreground">
        <span>
          共 {filtered.length} 位 · 第 {clampedPage}/{totalPages} 页
        </span>
        <button
          type="button"
          onClick={() => setPage(1)}
          disabled={clampedPage <= 1}
          className="rounded border px-2 py-0.5 disabled:opacity-40 hover:bg-muted"
        >
          «
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={clampedPage <= 1}
          className="rounded border px-2 py-0.5 disabled:opacity-40 hover:bg-muted"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={clampedPage >= totalPages}
          className="rounded border px-2 py-0.5 disabled:opacity-40 hover:bg-muted"
        >
          ›
        </button>
        <button
          type="button"
          onClick={() => setPage(totalPages)}
          disabled={clampedPage >= totalPages}
          className="rounded border px-2 py-0.5 disabled:opacity-40 hover:bg-muted"
        >
          »
        </button>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
          className="h-7 rounded-md border bg-background px-2"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}/页
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
