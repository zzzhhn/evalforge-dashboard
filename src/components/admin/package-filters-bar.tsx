"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/context";

export type AnnotatorTypeFilter = "ALL" | "INTERNAL" | "VENDOR" | "MIXED";
export type EvaluationModeFilter = "ALL" | "SCORING" | "ARENA";
export type TaskTypeFilter = "ALL" | "T2V" | "I2V";

export interface FilterState {
  taskType: TaskTypeFilter;
  startFrom: string | null; // yyyy-mm-dd
  startTo: string | null;
  annotatorType: AnnotatorTypeFilter;
  evaluationMode: EvaluationModeFilter;
}

export const DEFAULT_FILTERS: FilterState = {
  taskType: "ALL",
  startFrom: null,
  startTo: null,
  annotatorType: "ALL",
  evaluationMode: "ALL",
};

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
}

export function PackageFiltersBar({ value, onChange }: Props) {
  const { t } = useLocale();

  const patch = (partial: Partial<FilterState>) =>
    onChange({ ...value, ...partial });

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border bg-card p-3">
      {/* Task type */}
      <div className="flex items-center gap-1.5">
        {(["ALL", "T2V", "I2V"] as const).map((type) => (
          <Button
            key={type}
            variant={value.taskType === type ? "default" : "outline"}
            size="sm"
            onClick={() => patch({ taskType: type })}
          >
            {type === "ALL" ? (
              t("common.all")
            ) : (
              <span className="flex items-center gap-1">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    type === "T2V" ? "bg-blue-500" : "bg-emerald-500"
                  }`}
                />
                {type}
              </span>
            )}
          </Button>
        ))}
      </div>

      <Divider />

      {/* Time window */}
      <FilterField label={t("admin.filters.startFrom")}>
        <Input
          type="date"
          value={value.startFrom ?? ""}
          onChange={(e) => patch({ startFrom: e.target.value || null })}
          className="h-8 w-36 text-xs"
        />
      </FilterField>
      <FilterField label={t("admin.filters.startTo")}>
        <Input
          type="date"
          value={value.startTo ?? ""}
          onChange={(e) => patch({ startTo: e.target.value || null })}
          className="h-8 w-36 text-xs"
        />
      </FilterField>

      <Divider />

      {/* Annotator type */}
      <FilterField label={t("admin.filters.annotatorType")}>
        <select
          value={value.annotatorType}
          onChange={(e) =>
            patch({ annotatorType: e.target.value as AnnotatorTypeFilter })
          }
          className="h-8 rounded-md border bg-card px-2 text-xs"
        >
          <option value="ALL">{t("common.all")}</option>
          <option value="INTERNAL">{t("admin.packages.internal")}</option>
          <option value="VENDOR">{t("admin.packages.vendor")}</option>
          <option value="MIXED">{t("admin.filters.mixed")}</option>
        </select>
      </FilterField>

      {/* Evaluation mode */}
      <FilterField label={t("admin.filters.evaluationMode")}>
        <select
          value={value.evaluationMode}
          onChange={(e) =>
            patch({ evaluationMode: e.target.value as EvaluationModeFilter })
          }
          className="h-8 rounded-md border bg-card px-2 text-xs"
        >
          <option value="ALL">{t("common.all")}</option>
          <option value="SCORING">{t("admin.packages.modeScoring")}</option>
          <option value="ARENA">{t("admin.packages.modeArena")}</option>
        </select>
      </FilterField>

      {/* Reset */}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto text-xs text-muted-foreground"
        onClick={() => onChange(DEFAULT_FILTERS)}
      >
        {t("admin.filters.reset")}
      </Button>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-8 w-px bg-border" />;
}
