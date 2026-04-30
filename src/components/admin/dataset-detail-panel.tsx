"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { deleteDataset } from "@/app/(main)/admin/datasets/action";

export interface DetailDataset {
  id: string;
  name: string;
  taskType: string;
  videoCount: number;
  videoOssPrefix: string;
  generatedAt: string;
  frames: number | null;
  resolution: string | null;
  duration: number | null;
  aspect: string | null;
  model: { id: string; name: string; provider: string | null; taskType: string };
  promptSuite: { id: string; name: string; taskType: string };
  imageSet: { id: string; name: string; imageCount: number } | null;
  packageCount: number;
  actualVideoCount: number;
}

interface Props {
  dataset: DetailDataset;
}

function fmt(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function DatasetDetailPanel({ dataset }: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteDataset(dataset.id);
      if (res.status === "ok") {
        router.refresh();
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-md border bg-card p-6">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="truncate text-xl font-bold">{dataset.name}</h2>
            <Badge variant="outline">{dataset.taskType}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("admin.datasets.generatedAt")}: {fmt(dataset.generatedAt)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {dataset.packageCount > 0 && (
            <Badge variant="secondary">
              {t("admin.datasets.usedByPackages", {
                count: String(dataset.packageCount),
              })}
            </Badge>
          )}
          {!confirm ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={dataset.packageCount > 0 || pending}
              onClick={() => setConfirm(true)}
              className="text-destructive hover:bg-destructive/10"
            >
              {t("admin.datasets.delete")}
            </Button>
          ) : (
            <div className="flex flex-col items-end gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2">
              <p className="text-xs text-destructive">
                {t("admin.datasets.deleteConfirm")}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirm(false)}
                  disabled={pending}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={pending}
                >
                  {pending ? t("common.loading") : t("admin.datasets.delete")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3 shrink-0 rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <dl className="mt-4 grid gap-4 md:grid-cols-2">
        <DetailRow
          label={t("admin.datasets.model")}
          value={
            <div className="flex items-center gap-2">
              <span className="font-medium">{dataset.model.name}</span>
              {dataset.model.provider && (
                <Badge variant="outline" className="text-[10px]">
                  {dataset.model.provider}
                </Badge>
              )}
            </div>
          }
        />
        <DetailRow
          label={t("admin.datasets.promptSuite")}
          value={<span className="font-medium">{dataset.promptSuite.name}</span>}
        />
        <DetailRow
          label={t("admin.datasets.videoCount")}
          value={
            <span className="font-mono">
              {dataset.actualVideoCount} / {dataset.videoCount}
            </span>
          }
        />
        {dataset.imageSet && (
          <DetailRow
            label={t("admin.datasets.imageSet")}
            value={
              <div>
                <div className="font-medium">{dataset.imageSet.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {dataset.imageSet.imageCount} images
                </div>
              </div>
            }
          />
        )}
      </dl>

      {(dataset.frames !== null ||
        dataset.resolution !== null ||
        dataset.duration !== null ||
        dataset.aspect !== null) && (
        <div className="mt-4 rounded-md border bg-muted/40 p-3">
          <div className="mb-2 text-xs font-medium text-muted-foreground">
            {t("admin.datasets.videoParams")}
          </div>
          <div className="flex flex-wrap gap-2">
            {dataset.frames !== null && (
              <Badge variant="outline" className="font-mono text-xs">
                {dataset.frames} frames
              </Badge>
            )}
            {dataset.resolution && (
              <Badge variant="outline" className="font-mono text-xs">
                {dataset.resolution}
              </Badge>
            )}
            {dataset.duration !== null && (
              <Badge variant="outline" className="font-mono text-xs">
                {dataset.duration}s
              </Badge>
            )}
            {dataset.aspect && (
              <Badge variant="outline" className="font-mono text-xs">
                {dataset.aspect}
              </Badge>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 rounded-md border bg-muted/40 p-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {t("admin.datasets.ossPrefix")}
        </div>
        <code className="block break-all font-mono text-xs">
          {dataset.videoOssPrefix}
        </code>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
