"use client";

import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/context";

export interface SidebarDataset {
  id: string;
  name: string;
  taskType: string;
  videoCount: number;
  modelName: string;
  packageCount: number;
}

interface Props {
  datasets: SidebarDataset[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNewClick: () => void;
  isCreating: boolean;
}

export function DatasetSidebar({
  datasets,
  selectedId,
  onSelect,
  onNewClick,
  isCreating,
}: Props) {
  const { t } = useLocale();

  return (
    <div className="flex h-full flex-col gap-2">
      <button
        type="button"
        onClick={onNewClick}
        className={`flex w-full shrink-0 items-center justify-center gap-2 rounded-md border-2 border-dashed px-3 py-2.5 text-sm font-medium transition-colors ${
          isCreating
            ? "border-primary bg-primary/10 text-primary"
            : "border-primary/40 text-primary hover:border-primary hover:bg-primary/5"
        }`}
      >
        <span className="text-base">+</span>
        {t("admin.datasets.new")}
      </button>

      {datasets.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            {t("admin.datasets.empty")}
          </p>
          <p className="text-xs text-muted-foreground/70">
            {t("admin.datasets.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {datasets.map((ds) => {
            const isSelected = selectedId === ds.id;
            return (
              <button
                key={ds.id}
                onClick={() => onSelect(ds.id)}
                className={`group flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                  isSelected && !isCreating
                    ? "border-primary/60 bg-primary/5"
                    : "border-border bg-card hover:border-primary/30 hover:bg-accent/40"
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-medium">{ds.name}</p>
                    <Badge
                      variant="outline"
                      className="shrink-0 px-1 py-0 text-[9px]"
                    >
                      {ds.taskType}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="truncate">{ds.modelName}</span>
                    <span className="shrink-0">
                      {ds.videoCount} videos
                    </span>
                    {ds.packageCount > 0 && (
                      <span className="shrink-0 font-mono text-amber-600 dark:text-amber-400">
                        × {ds.packageCount}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`ml-1 shrink-0 text-sm transition-transform ${
                    isSelected && !isCreating
                      ? "translate-x-0 text-primary"
                      : "-translate-x-1 text-muted-foreground opacity-0 group-hover:translate-x-0 group-hover:opacity-100"
                  }`}
                >
                  ›
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
