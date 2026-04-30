"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/context";
import {
  updatePackageStatus,
  updatePackageInfo,
  fetchPackageDetail,
  softDeletePackage,
  undoDeletePackage,
  type PackageDetailData,
} from "@/app/(main)/admin/samples/action";
import { PackageDetailClient } from "./package-detail-client";
import { useUndoToast } from "@/components/providers/undo-toast-provider";

export interface AnnotatorProgress {
  name: string;
  accountType: "INTERNAL" | "VENDOR";
  completed: number;
  total: number;
}

export interface DetailPackage {
  id: string;
  name: string;
  taskType: string;
  evaluationMode: "SCORING" | "ARENA";
  videoCount: number;
  annotatorCount: number;
  completedItems: number;
  totalItems: number;
  status: string;
  publishedAt: string | null;
  startAt: string | null;
  deadline: string | null;
  deadlineStatus: "ok" | "near" | "overdue" | null;
  modelCheckpoint: string | null;
  description: string | null;
  modelNames: string[];
  annotatorProgress: AnnotatorProgress[];
  createdAt: string;
}

interface Props {
  pkg: DetailPackage | null;
}

const STATUS_STYLES: Record<
  string,
  { zh: string; en: string; className: string }
> = {
  DRAFT: {
    zh: "草稿",
    en: "Draft",
    className: "border-zinc-400/50 text-zinc-500 dark:text-zinc-400",
  },
  PUBLISHED: {
    zh: "已发布",
    en: "Published",
    className:
      "border-green-500/50 text-green-600 dark:text-green-400",
  },
  RECALLED: {
    zh: "已撤回",
    en: "Recalled",
    className: "border-amber-500/50 text-amber-600 dark:text-amber-400",
  },
  ARCHIVED: {
    zh: "已归档",
    en: "Archived",
    className: "border-zinc-400/50 text-zinc-400",
  },
};

const DEADLINE_STYLES: Record<string, string> = {
  ok: "text-muted-foreground",
  near: "text-amber-600 dark:text-amber-400",
  overdue: "text-red-600 dark:text-red-400",
};

export function PackageDetailPanel({ pkg }: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [detail, setDetail] = useState<PackageDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const undoToastApi = useUndoToast();

  // ─── Edit-info dialog state ─────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{
    name: string;
    modelCheckpoint: string;
    description: string;
  }>({ name: "", modelCheckpoint: "", description: "" });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openEdit = () => {
    if (!pkg) return;
    setEditForm({
      name: pkg.name,
      modelCheckpoint: pkg.modelCheckpoint ?? "",
      description: pkg.description ?? "",
    });
    setEditError(null);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!pkg) return;
    setEditBusy(true);
    setEditError(null);
    const res = await updatePackageInfo(pkg.id, {
      name: editForm.name,
      modelCheckpoint: editForm.modelCheckpoint || null,
      description: editForm.description || null,
    });
    setEditBusy(false);
    if (res.status === "ok") {
      setEditOpen(false);
      // Force a server refresh so the parent list + this panel re-pull
      // canonical strings from the DB. Avoids the "I edited it but the
      // header still shows the old name" trap.
      router.refresh();
    } else {
      setEditError(res.message);
    }
  };

  // Fetch rich detail (assets, annotator stats, deadline) when selection changes.
  useEffect(() => {
    if (!pkg) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    fetchPackageDetail(pkg.id)
      .then((res) => {
        if (cancelled) return;
        if (res.status === "ok") {
          setDetail(res.data);
        } else {
          setDetail(null);
          setDetailError(res.message);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pkg]);

  if (!pkg) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        {t("admin.packages.selectPackage")}
      </div>
    );
  }

  const progressPct =
    pkg.totalItems > 0
      ? Math.round((pkg.completedItems / pkg.totalItems) * 100)
      : 0;
  const statusInfo = STATUS_STYLES[pkg.status] ?? STATUS_STYLES.DRAFT;
  const dlStyle = pkg.deadlineStatus
    ? DEADLINE_STYLES[pkg.deadlineStatus]
    : "text-muted-foreground";

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "-";
    const formatted = new Date(iso).toLocaleString(
      locale === "zh" ? "zh-CN" : "en-US",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Shanghai",
      },
    );
    return `${formatted} (UTC+8)`;
  };

  const handleStart = async () => {
    const res = await updatePackageStatus(pkg.id, "PUBLISHED");
    if (res.status === "ok") {
      startTransition(() => router.refresh());
    } else {
      alert(res.message);
    }
  };

  const handlePause = async () => {
    if (!confirm(t("admin.packages.confirmSuspend"))) return;
    const res = await updatePackageStatus(pkg.id, "RECALLED");
    if (res.status === "ok") {
      startTransition(() => router.refresh());
    } else {
      alert(res.message);
    }
  };

  const handleResume = async () => {
    const res = await updatePackageStatus(pkg.id, "PUBLISHED");
    if (res.status === "ok") {
      startTransition(() => router.refresh());
    } else {
      alert(res.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("admin.packages.confirmDelete"))) return;
    const deletedId = pkg.id;
    const deletedName = pkg.name;
    const res = await softDeletePackage(deletedId);
    if (res.status !== "ok") {
      alert(res.message);
      return;
    }
    // Push into the global undo stack so navigating away from this
    // package doesn't lose the undo affordance. Multiple deletes stack.
    undoToastApi.push({
      label:
        locale === "zh"
          ? `任务「${deletedName}」已删除`
          : `Package "${deletedName}" deleted`,
      onUndo: async () => {
        const r = await undoDeletePackage(deletedId);
        if (r.status !== "ok") {
          alert(r.message);
          throw new Error(r.message);
        }
        startTransition(() => router.refresh());
      },
    });
    startTransition(() => router.refresh());
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card">
      {/* Sticky header summary */}
      <div className="shrink-0 space-y-3 border-b bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{pkg.name}</h2>
              <button
                type="button"
                onClick={openEdit}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={locale === "zh" ? "修改任务信息" : "Edit package info"}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${statusInfo.className}`}
              >
                {statusInfo[locale]}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${
                  pkg.taskType === "T2V"
                    ? "border-blue-500/50 text-blue-600 dark:text-blue-400"
                    : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {pkg.taskType}
              </Badge>
              <Badge
                variant="outline"
                className={`text-[10px] px-1.5 py-0 ${
                  pkg.evaluationMode === "ARENA"
                    ? "border-fuchsia-500/50 text-fuchsia-600 dark:text-fuchsia-400"
                    : "border-sky-500/50 text-sky-600 dark:text-sky-400"
                }`}
              >
                {pkg.evaluationMode === "ARENA"
                  ? t("admin.packages.modeArena")
                  : t("admin.packages.modeScoring")}
              </Badge>
            </div>
            {pkg.description && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {pkg.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {pkg.status === "DRAFT" && (
              <Button
                size="sm"
                disabled={isPending}
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={handleStart}
              >
                {t("admin.packages.start")}
              </Button>
            )}
            {pkg.status === "PUBLISHED" && (
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={handlePause}
              >
                {t("admin.packages.suspend")}
              </Button>
            )}
            {pkg.status === "RECALLED" && (
              <Button
                size="sm"
                disabled={isPending}
                className="bg-green-600 text-white hover:bg-green-700"
                onClick={handleResume}
              >
                {t("admin.packages.resume")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              className="border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400"
              onClick={handleDelete}
            >
              {t("admin.packages.delete")}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("admin.packages.progress")}</span>
            <span className="font-mono">
              {pkg.completedItems}/{pkg.totalItems} ({progressPct}%)
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-3">
          <InfoRow
            label={t("admin.packages.model")}
            value={pkg.modelNames.join(", ") || "-"}
            mono
          />
          <InfoRow
            label={t("admin.packages.version")}
            value={pkg.modelCheckpoint || "-"}
            mono
          />
          <InfoRow
            label={t("admin.packages.videos")}
            value={String(pkg.videoCount)}
          />
          <InfoRow
            label={t("admin.packages.annotators")}
            value={String(pkg.annotatorCount)}
          />
          <InfoRow
            label={t("admin.packages.timeWindowStart")}
            value={formatDateTime(pkg.startAt)}
            mono
          />
          <InfoRow
            label={t("admin.packages.endTime")}
            value={formatDateTime(pkg.deadline)}
            mono
            valueClass={dlStyle}
          />
        </div>
      </div>

      {/* Scrollable detail body */}
      <div className="flex-1 overflow-y-auto p-5">
        {loadingDetail && (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            {locale === "zh" ? "加载详情…" : "Loading details…"}
          </div>
        )}
        {detailError && (
          <div className="rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-400">
            {detailError}
          </div>
        )}
        {detail && !loadingDetail && (
          <PackageDetailClient
            packageId={detail.packageId}
            packageName={detail.packageName}
            deadline={detail.deadline}
            assets={detail.assets}
            annotatorStats={detail.annotatorStats}
          />
        )}
      </div>

      {/* Edit-info dialog. Lives at the bottom of the panel so its
          DOM stays mounted regardless of which row is selected. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {locale === "zh" ? "修改任务信息" : "Edit Package Info"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {locale === "zh" ? "任务名称" : "Name"}
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {locale === "zh" ? "模型版本 / checkpoint" : "Model version / checkpoint"}
              </label>
              <input
                type="text"
                value={editForm.modelCheckpoint}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    modelCheckpoint: e.target.value,
                  })
                }
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
                placeholder={locale === "zh" ? "可选，例如 v6.1" : "Optional, e.g. v6.1"}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {locale === "zh" ? "描述 / 标签" : "Description / Tags"}
              </label>
              <textarea
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder={
                  locale === "zh"
                    ? "可选，简要说明任务用途、相关标签或备注"
                    : "Optional context, related tags, or notes"
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {locale === "zh"
                ? "模型实体本身、Prompt Suite、视频集合不可在此修改 — 这些影响题目身份，需要走删除重建流程。"
                : "Model entity, prompt suite, and video set are not editable here — those affect item identity and require a rebuild."}
            </p>
            {editError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {editError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={editBusy}
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button onClick={submitEdit} disabled={editBusy}>
              {editBusy
                ? locale === "zh"
                  ? "保存中…"
                  : "Saving…"
                : locale === "zh"
                  ? "保存"
                  : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={`truncate text-right ${mono ? "font-mono" : ""} ${valueClass ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}
