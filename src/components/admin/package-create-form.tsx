"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AnnotatorPicker,
  type AnnotatorOption,
} from "@/components/admin/annotator-picker";
import { DatetimeRangePicker } from "@/components/admin/datetime-range-picker";
import { createPackage } from "@/app/(main)/admin/samples/create/action";

export interface DatasetOption {
  id: string;
  name: string;
  taskType: "T2V" | "I2V";
  videoCount: number;
  generatedAt: string;
  model: { id: string; name: string; provider: string | null };
  promptSuite: { id: string; name: string };
}

interface Props {
  datasets: DatasetOption[];
  annotators: AnnotatorOption[];
}

function autoSuggestName(taskType: string, mode: string, promptCount: number) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${taskType}_${mode === "ARENA" ? "Arena" : "Score"}_${promptCount || 0}_${date}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

export function PackageCreateForm({ datasets, annotators }: Props) {
  const { t } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [taskType, setTaskType] = useState<"T2V" | "I2V">("T2V");
  const [mode, setMode] = useState<"SCORING" | "ARENA">("SCORING");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState<string | null>(null);
  const [deadline, setDeadline] = useState<string | null>(null);
  const [datasetIds, setDatasetIds] = useState<string[]>([]);
  const [annotatorIds, setAnnotatorIds] = useState<string[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const availableDatasets = useMemo(
    () => datasets.filter((d) => d.taskType === taskType),
    [datasets, taskType],
  );

  const selectedDatasets = useMemo(
    () => datasets.filter((d) => datasetIds.includes(d.id)),
    [datasets, datasetIds],
  );

  // Suite mismatch (sticky once we have >1 dataset) → Arena impossible & submit blocked.
  const suiteIds = new Set(selectedDatasets.map((d) => d.promptSuite.id));
  const suiteMismatch = suiteIds.size > 1;
  const modelIds = new Set(selectedDatasets.map((d) => d.model.id));
  const arenaInvalid =
    mode === "ARENA" && (datasetIds.length !== 2 || modelIds.size !== 2);

  const suggestedName = useMemo(() => {
    const promptCount =
      selectedDatasets.length > 0
        ? Math.max(...selectedDatasets.map((d) => d.videoCount))
        : 0;
    return autoSuggestName(taskType, mode, promptCount);
  }, [taskType, mode, selectedDatasets]);

  const toggleDataset = (id: string) => {
    setDatasetIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Arena caps at 2 selections to keep the intent obvious.
      if (mode === "ARENA" && prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const canSubmit =
    name.trim().length > 0 &&
    datasetIds.length > 0 &&
    annotatorIds.length > 0 &&
    !suiteMismatch &&
    !arenaInvalid &&
    !pending;

  const handleSubmit = () => {
    setErrorMsg(null);
    setWarnings([]);

    // Prompt admin if they forgot to set startAt or deadline. Both matter
    // downstream (scheduling + anti-cheat deadline enforcement), so require
    // explicit acknowledgement before proceeding without them.
    if (!startAt || !deadline) {
      const ok = confirm(t("admin.create.confirmMissingDates"));
      if (!ok) return;
    }

    startTransition(async () => {
      const res = await createPackage({
        name: name.trim(),
        description: description.trim() || null,
        taskType,
        evaluationMode: mode,
        startAt,
        deadline,
        datasetIds,
        annotatorIds,
      });
      if (res.status === "ok") {
        if (res.warnings) setWarnings(res.warnings);
        router.push("/admin/samples");
      } else {
        setErrorMsg(res.message ?? "Unknown error");
      }
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/admin/samples")}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden>←</span>
            <span>{t("admin.create.back")}</span>
          </button>
        </div>
        <h1 className="text-2xl font-bold">{t("admin.create.title")}</h1>

        {errorMsg && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {errorMsg}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-semibold">{t("admin.create.warnings")}</div>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("admin.create.packageName")} <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder={suggestedName}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setName(suggestedName)}
              className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
            >
              {t("admin.create.useSuggested")}: {suggestedName}
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("admin.create.taskType")} <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {(["T2V", "I2V"] as const).map((tt) => (
                <button
                  key={tt}
                  type="button"
                  onClick={() => {
                    setTaskType(tt);
                    setDatasetIds([]);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    taskType === tt
                      ? "bg-primary text-primary-foreground"
                      : "bg-background"
                  }`}
                >
                  {tt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("admin.create.mode")} <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              {(["SCORING", "ARENA"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    if (m === "ARENA" && datasetIds.length > 2)
                      setDatasetIds(datasetIds.slice(0, 2));
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "bg-background"
                  }`}
                >
                  {m === "ARENA"
                    ? t("admin.packages.modeArena")
                    : t("admin.packages.modeScoring")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">
              {t("admin.create.description")}
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("admin.create.descriptionPlaceholder")}
            />
          </div>

          <DatetimeRangePicker
            label={t("admin.create.startAt")}
            value={startAt}
            onChange={setStartAt}
            timeDefault="00:00:00"
            required
          />
          <DatetimeRangePicker
            label={t("admin.create.deadline")}
            value={deadline}
            onChange={setDeadline}
            timeDefault="23:59:59"
            required
          />
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">
              {t("admin.create.dataset")} <span className="text-red-500">*</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {t("admin.create.datasetHint")}
              </span>
            </label>
            <a
              href="/admin/datasets"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary underline hover:text-primary/80"
            >
              {t("admin.create.datasetGotoNew")}
            </a>
          </div>

          {availableDatasets.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t("admin.create.noDatasets")}
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {availableDatasets.map((d) => {
                const selected = datasetIds.includes(d.id);
                const disabled =
                  mode === "ARENA" && !selected && datasetIds.length >= 2;
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleDataset(d.id)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : disabled
                          ? "cursor-not-allowed opacity-40"
                          : "border-border bg-card hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          selected ? "bg-primary" : "border border-muted-foreground/40"
                        }`}
                      />
                      <span className="truncate font-medium text-sm">
                        {d.name}
                      </span>
                      <Badge variant="outline" className="ml-auto text-[9px]">
                        {d.taskType}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-0.5 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span className="shrink-0">{t("admin.datasets.model")}:</span>
                        <span className="truncate font-medium text-foreground/80">
                          {d.model.name}
                        </span>
                        {d.model.provider && (
                          <Badge variant="outline" className="ml-1 text-[9px]">
                            {d.model.provider}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="shrink-0">
                          {t("admin.datasets.promptSuite")}:
                        </span>
                        <span className="truncate">{d.promptSuite.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{d.videoCount} videos</span>
                        <span>· {fmtDate(d.generatedAt)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {datasetIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("admin.create.datasetsSelected", {
                count: String(datasetIds.length),
              })}
            </p>
          )}
          {/* Multi-dataset SCORING warning. Model_I2V_Score_0_20260423 was
              built this way (2 datasets) and the resulting "1000 Model +
              1000 LTX 2.3 mixed" was reported as contamination — actually
              by design but visually surprising. Make it explicit. */}
          {mode === "SCORING" && selectedDatasets.length > 1 && !suiteMismatch && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t("admin.create.multiDatasetWarning", {
                modelCount: String(modelIds.size),
                datasetCount: String(selectedDatasets.length),
              })}
            </p>
          )}
          {suiteMismatch && (
            <p className="text-xs text-destructive">
              {t("admin.create.datasetsSuiteMismatch")}
            </p>
          )}
          {arenaInvalid && (
            <p className="text-xs text-destructive">
              {t("admin.create.datasetsArenaNeedTwo")}
            </p>
          )}
        </section>

        <section className="space-y-2">
          <label className="block text-sm font-medium">
            {t("admin.create.annotators")} <span className="text-red-500">*</span>
          </label>
          <AnnotatorPicker
            options={annotators}
            selectedIds={annotatorIds}
            onChange={setAnnotatorIds}
          />
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => router.push("/admin/samples")}
          >
            {t("admin.create.cancel")}
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
            {pending ? t("admin.create.submitting") : t("admin.create.submit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
