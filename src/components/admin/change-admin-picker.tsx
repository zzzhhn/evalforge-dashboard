"use client";

import { useMemo, useState } from "react";
import { Crown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/context";

export interface AdminCandidate {
  userId: string;
  name: string;
  email: string;
  accountType: string;
  isCurrentAdmin: boolean;
  isMember: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  candidates: AdminCandidate[];
  currentAdminId: string | null;
  busy?: boolean;
  onConfirm: (userId: string) => void;
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const hasCJK = /[\u3400-\u9fff]/.test(trimmed);
  if (hasCJK) return [...trimmed].slice(-2).join("");
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

export function ChangeAdminPicker({
  open,
  onOpenChange,
  groupName,
  candidates,
  currentAdminId,
  busy = false,
  onConfirm,
}: Props) {
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...candidates];
    // Existing members first, alphabetical within each bucket.
    list.sort((a, b) => {
      if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  const handleClose = (next: boolean) => {
    if (!next) {
      setQuery("");
      setSelectedId(null);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" strokeWidth={1.75} />
            {locale === "zh" ? "更换组管理员" : "Change group admin"}
          </DialogTitle>
          <DialogDescription>
            {locale === "zh"
              ? `为「${groupName}」选择新的组管理员。如该用户尚未加入本组，系统会自动加入并置为管理员。`
              : `Pick a new admin for "${groupName}". If the user is not yet in the group, they will be added automatically.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
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
              autoFocus
            />
          </div>

          <div className="max-h-80 overflow-y-auto rounded-md border">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {locale === "zh" ? "无匹配的用户" : "No matching users"}
              </div>
            ) : (
              <ul className="divide-y">
                {filtered.map((c) => {
                  const selected = selectedId === c.userId;
                  const isCurrent = c.userId === currentAdminId;
                  return (
                    <li key={c.userId}>
                      <button
                        type="button"
                        onClick={() => !isCurrent && setSelectedId(c.userId)}
                        disabled={isCurrent}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          isCurrent
                            ? "cursor-not-allowed bg-muted/40 opacity-60"
                            : selected
                              ? "bg-primary/10"
                              : "hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{c.name}</span>
                            {isCurrent && (
                              <span className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                                <Crown className="h-2.5 w-2.5" strokeWidth={1.75} />
                                {locale === "zh" ? "现任" : "Current"}
                              </span>
                            )}
                            {!c.isMember && !isCurrent && (
                              <span className="rounded-sm bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
                                {locale === "zh" ? "非本组" : "Outside group"}
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {c.email}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {c.accountType === "INTERNAL"
                            ? locale === "zh" ? "内部" : "Internal"
                            : locale === "zh" ? "外包" : "Vendor"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {locale === "zh" ? "取消" : "Cancel"}
          </Button>
          <Button
            disabled={busy || !selectedId}
            onClick={() => selectedId && onConfirm(selectedId)}
          >
            {busy
              ? "…"
              : locale === "zh"
                ? "确认更换"
                : "Confirm change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
