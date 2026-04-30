"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/lib/i18n/context";
import {
  createPromptSuiteFromXlsx,
  previewPromptSuiteXlsx,
} from "@/app/(main)/admin/samples/create/action";
import {
  createDataset,
  scanDatasetPreview,
  deletePromptSuite,
  updateModel,
  type DatasetScanPreview,
} from "@/app/(main)/admin/datasets/action";
import type { ParseResult } from "@/lib/prompt-suite-parser";
import { Trash2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export interface WizardPromptSuite {
  id: string;
  name: string;
  description?: string | null;
  taskType: "T2V" | "I2V";
  entryCount: number;
  dimensionCount?: number;
  createdAt?: string;
  linkedPackageCount?: number;
}

export interface WizardModel {
  id: string;
  name: string;
  provider: string | null;
  taskType: "T2V" | "I2V";
  description?: string | null;
}

export interface WizardExistingDataset {
  id: string;
  name: string;
  taskType: string;
  promptSuiteId: string;
  videoOssPrefix: string;
  modelName: string;
}

interface Props {
  promptSuites: WizardPromptSuite[];
  models: WizardModel[];
  existingDatasets?: WizardExistingDataset[];
  onCancel: () => void;
  onCreated: (datasetId: string) => void;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function autoDatasetName(
  modelName: string | undefined,
  taskType: string,
  promptCount: number,
) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  // Preserve dots so "Kling 3.0" → "Kling3.0" rather than collapsing to "Kling30".
  // Dots are valid in dataset names per @@unique on (modelId, promptSuiteId, imageSetId).
  const modelTag = modelName
    ? modelName.replace(/[^A-Za-z0-9.]+/g, "")
    : "Model";
  return `${modelTag}_${taskType}_${promptCount}_${date}`;
}

function autoImageSetName(taskType: string, promptCount: number) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ImageSet_${taskType}_${promptCount}_${date}`;
}

export function DatasetCreateWizard({
  promptSuites,
  models,
  existingDatasets = [],
  onCancel,
  onCreated,
}: Props) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [taskType, setTaskType] = useState<"T2V" | "I2V">("T2V");
  const [suiteMode, setSuiteMode] = useState<"existing" | "upload">("existing");
  const [suiteId, setSuiteId] = useState<string>("");
  const [modelMode, setModelMode] = useState<"existing" | "new">("existing");
  const [modelId, setModelId] = useState<string>("");
  const [newModelName, setNewModelName] = useState("");
  const [newModelProvider, setNewModelProvider] = useState("");
  const [newModelDesc, setNewModelDesc] = useState("");
  const [videoOssPrefix, setVideoOssPrefix] = useState("");
  const [imageOssPrefix, setImageOssPrefix] = useState("");
  const [imageSetName, setImageSetName] = useState("");
  const [name, setName] = useState("");

  // Phase D — optional per-dataset video generation metadata. Admins fill these
  // in if they know them; leaving any blank stores null so the dataset card
  // simply hides that chip. Strings (not numbers) because we want to preserve
  // placeholder/format semantics like "1080p" or "720x1280" verbatim.
  const [frames, setFrames] = useState("");
  const [resolution, setResolution] = useState("");
  const [duration, setDuration] = useState("");
  const [aspect, setAspect] = useState("");

  const [xlsxFile, setXlsxFile] = useState<File | null>(null);
  const [xlsxPreview, setXlsxPreview] = useState<ParseResult | null>(null);
  const [xlsxSuiteName, setXlsxSuiteName] = useState("");
  const [xlsxSuiteDesc, setXlsxSuiteDesc] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Multi-phase progress for the prompt-suite upload. Even after the
  // backend speedup the user still wants visible feedback for what's
  // happening, so we drive a 4-step bar:
  //   parse (fast, mostly client overhead) → preflight read → write → done
  //
  // Steps are deterministic phases the action goes through; we advance
  // them at known boundaries (file→base64 done, preview done, commit done).
  type SuiteUploadPhase =
    | "idle"
    | "encoding"   // base64-ifying the File
    | "preview"    // server parses xlsx + validates
    | "saving"     // server commits to DB
    | "done"
    | "error";
  const [suitePhase, setSuitePhase] = useState<SuiteUploadPhase>("idle");
  const [suiteRowCount, setSuiteRowCount] = useState<number>(0);

  const [scanPreview, setScanPreview] = useState<DatasetScanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Edit-existing-model dialog state. Tracks the modelId being edited; the
  // dialog reads initial values from `models` and writes via `updateModel`.
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const editingModel = editingModelId
    ? models.find((m) => m.id === editingModelId) ?? null
    : null;

  // Reset the edit form whenever a different model is opened.
  useEffect(() => {
    if (editingModel) {
      setEditName(editingModel.name);
      setEditProvider(editingModel.provider ?? "");
      setEditDesc(editingModel.description ?? "");
    }
  }, [editingModel]);

  const handleEditModelSave = async () => {
    if (!editingModelId) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setError(t("admin.datasets.editModelNameRequired") ?? "Model 名称不能为空");
      return;
    }
    setEditBusy(true);
    setError(null);
    try {
      const res = await updateModel({
        modelId: editingModelId,
        name: trimmed,
        provider: editProvider.trim() || null,
        description: editDesc.trim() || null,
      });
      if (res.status === "ok") {
        setEditingModelId(null);
        router.refresh();
      } else {
        setError(res.message);
      }
    } finally {
      setEditBusy(false);
    }
  };

  const availableSuites = useMemo(
    () => promptSuites.filter((s) => s.taskType === taskType),
    [promptSuites, taskType],
  );
  // Show every created model regardless of taskType — admins were getting
  // confused by the "I don't see Kling 3.0!" trap when a model existed under
  // the other taskType. Selecting a model now auto-syncs the wizard's
  // taskType (see onClick below) so the create action's downstream
  // taskType-consistency check still passes.
  const availableModels = useMemo(
    () =>
      [...models].sort((a, b) => {
        // Same-taskType first, then alphabetic.
        if (a.taskType !== b.taskType) {
          return a.taskType === taskType ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      }),
    [models, taskType],
  );

  const selectedSuite = availableSuites.find((s) => s.id === suiteId);
  const selectedModel = availableModels.find((m) => m.id === modelId);

  // Prefer pasted-new-model name when in "new" mode, else existing selection.
  const activeModelName =
    modelMode === "new" ? newModelName.trim() : selectedModel?.name;

  const suggestedName = useMemo(
    () =>
      autoDatasetName(
        activeModelName || undefined,
        taskType,
        selectedSuite?.entryCount ?? 0,
      ),
    [activeModelName, taskType, selectedSuite],
  );

  const suggestedImageSetName = useMemo(
    () => autoImageSetName(taskType, selectedSuite?.entryCount ?? 0),
    [taskType, selectedSuite],
  );

  // Quick-pick: distinct videoOssPrefix values across already-created datasets,
  // narrowed by taskType (and suite if chosen) so the list stays relevant.
  // Sorting by name keeps the list stable across renders.
  const recentPrefixes = useMemo(() => {
    const scope = existingDatasets.filter(
      (d) =>
        d.taskType === taskType && (!suiteId || d.promptSuiteId === suiteId),
    );
    const seen = new Map<
      string,
      { prefix: string; datasetName: string; modelName: string }
    >();
    for (const d of scope) {
      if (!seen.has(d.videoOssPrefix)) {
        seen.set(d.videoOssPrefix, {
          prefix: d.videoOssPrefix,
          datasetName: d.name,
          modelName: d.modelName,
        });
      }
    }
    return [...seen.values()].sort((a, b) =>
      a.datasetName.localeCompare(b.datasetName),
    );
  }, [existingDatasets, taskType, suiteId]);

  const handleXlsxSelect = async (file: File) => {
    setXlsxFile(file);
    setXlsxPreview(null);
    setBusy("preview");
    setSuitePhase("encoding");
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      setSuitePhase("preview");
      // Pass the wizard's task-type selection so parser picks the
      // matching sheet in multi-sheet workbooks (T2V_200 + I2V_200).
      const res = await previewPromptSuiteXlsx(base64, taskType);
      if (res.status === "ok") {
        setXlsxPreview(res.preview);
        setSuiteRowCount(res.preview.stats.totalRows);
        setSuitePhase("idle");
      } else {
        setError(res.message);
        setSuitePhase("error");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleXlsxCommit = async () => {
    if (!xlsxFile || !xlsxSuiteName.trim()) {
      setError(t("admin.create.needSuiteName"));
      return;
    }
    setBusy("commit-suite");
    setError(null);
    setSuitePhase("encoding");
    try {
      const base64 = await fileToBase64(xlsxFile);
      setSuitePhase("saving");
      const res = await createPromptSuiteFromXlsx({
        name: xlsxSuiteName.trim(),
        description: xlsxSuiteDesc.trim() || null,
        taskType,
        fileBase64: base64,
      });
      if (res.status === "ok") {
        setSuitePhase("done");
        setSuiteId(res.promptSuiteId);
        setSuiteMode("existing");
        router.refresh();
      } else {
        setError(res.message);
        setSuitePhase("error");
      }
    } finally {
      setBusy(null);
    }
  };

  const handleScan = async () => {
    if (!suiteId || !videoOssPrefix.trim()) return;
    setBusy("scan");
    setError(null);
    setScanPreview(null);
    try {
      const res = await scanDatasetPreview({
        promptSuiteId: suiteId,
        ossPrefix: videoOssPrefix.trim(),
        kind: "video",
      });
      if (res.status === "ok") setScanPreview(res.preview);
      else setError(res.message);
    } finally {
      setBusy(null);
    }
  };

  const modelReady =
    modelMode === "existing"
      ? !!modelId
      : newModelName.trim().length > 0; // provider is now optional

  const canSubmit =
    !!suiteId &&
    modelReady &&
    videoOssPrefix.trim().length > 0 &&
    (taskType !== "I2V" ||
      !imageOssPrefix.trim() ||
      imageSetName.trim().length > 0) &&
    !pending;

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createDataset({
        name: name.trim() || suggestedName,
        taskType,
        modelId: modelMode === "existing" ? modelId : undefined,
        newModel:
          modelMode === "new"
            ? {
                name: newModelName.trim(),
                provider: newModelProvider.trim() || null,
                description: newModelDesc.trim() || null,
              }
            : undefined,
        promptSuiteId: suiteId,
        videoOssPrefix: videoOssPrefix.trim(),
        imageOssPrefix: imageOssPrefix.trim() || null,
        imageSetName: imageSetName.trim() || null,
        // Coerce blank → null. parseFloat returns NaN on garbage, which we
        // also treat as null so the server never receives NaN.
        frames: frames.trim() ? Number.parseInt(frames.trim(), 10) || null : null,
        resolution: resolution.trim() || null,
        duration: duration.trim()
          ? Number.parseFloat(duration.trim()) || null
          : null,
        aspect: aspect.trim() || null,
      });
      if (res.status === "ok") {
        onCreated(res.datasetId);
        router.refresh();
      } else {
        if (res.multiMatched && res.multiMatched.length > 0) {
          const conflicts = res.multiMatched
            .map(
              (m) =>
                `${m.externalId}: ${m.ossKeys.join(", ")}`,
            )
            .join("\n");
          setError(`${res.message}\n\n${conflicts}`);
        } else {
          setError(res.message);
        }
      }
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-md border bg-card p-6">
      <div className="mb-4 shrink-0 border-b pb-3">
        <h2 className="text-xl font-bold">{t("admin.datasets.new")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("admin.datasets.subtitle")}
        </p>
      </div>

      {error && (
        <div className="mb-4 shrink-0 whitespace-pre-wrap rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Step 1: Task Type */}
        <section>
          <label className="mb-2 block text-sm font-semibold">
            {t("admin.datasets.stepType")}
          </label>
          <div className="flex gap-2">
            {(["T2V", "I2V"] as const).map((tt) => (
              <button
                key={tt}
                type="button"
                onClick={() => {
                  setTaskType(tt);
                  setSuiteId("");
                  setModelId("");
                  setScanPreview(null);
                }}
                className={`rounded-md border px-4 py-2 text-sm font-medium ${
                  taskType === tt
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                }`}
              >
                {tt}
              </button>
            ))}
          </div>
        </section>

        {/* Step 2: Prompt Suite */}
        <section>
          <label className="mb-2 block text-sm font-semibold">
            {t("admin.datasets.stepSuite")}
          </label>
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => setSuiteMode("existing")}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                suiteMode === "existing"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
            >
              {t("admin.create.useExistingSuite")}
            </button>
            <button
              type="button"
              onClick={() => setSuiteMode("upload")}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                suiteMode === "upload"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
            >
              {t("admin.create.uploadXlsx")}
            </button>
          </div>

          {suiteMode === "existing" ? (
            <PromptSuiteCardGrid
              suites={availableSuites}
              selectedId={suiteId}
              onSelect={(id) => {
                setSuiteId(id);
                setScanPreview(null);
              }}
              locale={locale}
            />
          ) : (
            <div className="space-y-2 rounded-md border bg-background p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  placeholder={t("admin.create.newSuiteName")}
                  value={xlsxSuiteName}
                  onChange={(e) => setXlsxSuiteName(e.target.value)}
                />
                <Input
                  placeholder={t("admin.create.newSuiteDesc")}
                  value={xlsxSuiteDesc}
                  onChange={(e) => setXlsxSuiteDesc(e.target.value)}
                />
              </div>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleXlsxSelect(file);
                }}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t("admin.create.xlsxHelp")}
              </p>
              {xlsxPreview && (
                <div className="rounded-md border bg-muted/40 p-2 text-xs">
                  {xlsxPreview.errors.length > 0 ? (
                    <div className="text-destructive">
                      <div className="font-semibold">
                        {t("admin.create.parseErrors", {
                          count: String(xlsxPreview.errors.length),
                        })}
                      </div>
                      <ul className="mt-1 list-disc pl-5">
                        {xlsxPreview.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>
                            Row {err.row}
                            {err.column ? ` · ${err.column}` : ""}: {err.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div>
                        {t("admin.create.parseSuccess", {
                          rows: String(xlsxPreview.stats.totalRows),
                        })}
                      </div>
                      <div className="text-muted-foreground">
                        L1: {xlsxPreview.stats.uniqueL1} · L2:{" "}
                        {xlsxPreview.stats.uniqueL2} · L3:{" "}
                        {xlsxPreview.stats.uniqueL3}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <Button
                type="button"
                size="sm"
                disabled={
                  !xlsxFile ||
                  !xlsxSuiteName.trim() ||
                  busy !== null ||
                  (xlsxPreview?.errors.length ?? 1) > 0
                }
                onClick={handleXlsxCommit}
              >
                {busy === "commit-suite"
                  ? t("admin.create.saving")
                  : t("admin.create.saveSuite")}
              </Button>

              {/* Multi-phase progress bar for the upload pipeline.
                  Backend is now batched (~10 queries vs ~700 before),
                  so total wall time for 200 rows is well under a second
                  — but the user explicitly asked for visible progress,
                  and a clear phase indicator beats a single spinner. */}
              {(busy === "preview" || busy === "commit-suite" || suitePhase === "done" || suitePhase === "error") && (
                <SuiteUploadProgressBar
                  phase={suitePhase}
                  rowCount={suiteRowCount}
                  locale={locale}
                />
              )}
            </div>
          )}
        </section>

        {/* Step 3: Model */}
        <section>
          <label className="mb-2 block text-sm font-semibold">
            {t("admin.datasets.stepModel")}
          </label>
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setModelMode("existing");
                setScanPreview(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                modelMode === "existing"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
            >
              {t("admin.datasets.modelModeExisting") ?? "选择已有 Model"}
            </button>
            <button
              type="button"
              onClick={() => {
                setModelMode("new");
                setModelId("");
                setScanPreview(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                modelMode === "new"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
            >
              {t("admin.datasets.modelModeNew") ?? "+ 新建 Model"}
            </button>
          </div>

          {modelMode === "existing" ? (
            <div className="flex flex-wrap gap-2">
              {availableModels.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  {t("admin.create.noModels")}
                </span>
              )}
              {availableModels.map((m) => {
                const selected = modelId === m.id;
                const mismatch = m.taskType !== taskType;
                return (
                  <div key={m.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setModelId(m.id);
                        setScanPreview(null);
                        // Auto-sync wizard taskType to the picked model so
                        // downstream PromptSuite/createDataset checks line up.
                        if (mismatch) {
                          setTaskType(m.taskType);
                          setSuiteId(""); // suite list will refilter on the new taskType
                        }
                      }}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      {m.name}
                      <Badge
                        variant={m.taskType === "T2V" ? "secondary" : "outline"}
                        className="ml-2 text-[10px]"
                      >
                        {m.taskType}
                      </Badge>
                      {m.provider && (
                        <Badge variant="outline" className="ml-1 text-[10px]">
                          {m.provider}
                        </Badge>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingModelId(m.id);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t("admin.datasets.editModel") ?? "编辑模型"}
                      aria-label={t("admin.datasets.editModel") ?? "编辑模型"}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2 rounded-md border bg-background p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    {t("admin.datasets.newModelName") ?? "Model 名称"}
                    <span className="ml-1 text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="e.g. Vidu Q3"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    {t("admin.datasets.newModelProvider") ?? "Provider"}
                    <span className="ml-1 text-muted-foreground text-[10px]">
                      ({t("admin.optional") ?? "选填"})
                    </span>
                  </label>
                  <Input
                    placeholder="e.g. Vidu / Kling / Runway"
                    value={newModelProvider}
                    onChange={(e) => setNewModelProvider(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  {t("admin.datasets.newModelDesc") ?? "备注（可选）"}
                </label>
                <Input
                  placeholder="e.g. Vidu Q3 T2V preview build, 2026-04"
                  value={newModelDesc}
                  onChange={(e) => setNewModelDesc(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t("admin.datasets.newModelHint") ??
                  "提交时将自动创建该 Model 记录，taskType 与当前选择一致。若名称已存在会报错。"}
              </p>
            </div>
          )}
        </section>

        {/* Step 4: Video OSS */}
        <section>
          <label className="mb-2 block text-sm font-semibold">
            {t("admin.datasets.stepVideo")}
          </label>
          <div className="flex gap-2">
            <Input
              placeholder={t("admin.datasets.videoPrefixPlaceholder")}
              value={videoOssPrefix}
              onChange={(e) => {
                setVideoOssPrefix(e.target.value);
                setScanPreview(null);
              }}
              className="flex-1 font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!suiteId || !videoOssPrefix.trim() || busy === "scan"}
              onClick={handleScan}
            >
              {busy === "scan"
                ? t("admin.datasets.scanning")
                : t("admin.datasets.scan")}
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("admin.datasets.videoPrefixHint")}
          </p>

          {recentPrefixes.length > 0 && (
            <div className="mt-2 rounded-md border bg-muted/30 p-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">
                {t("admin.datasets.reuseExisting")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentPrefixes.map((r) => (
                  <button
                    key={r.prefix}
                    type="button"
                    onClick={() => {
                      setVideoOssPrefix(r.prefix);
                      setScanPreview(null);
                    }}
                    className="group flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-left text-xs transition-colors hover:border-primary/60 hover:bg-primary/5"
                    title={r.prefix}
                  >
                    <span className="font-medium">{r.datasetName}</span>
                    <Badge variant="outline" className="text-[9px]">
                      {r.modelName}
                    </Badge>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {r.prefix}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {scanPreview && (
            <div className="mt-2 space-y-1.5 rounded-md border bg-muted/40 p-3 text-xs">
              <div className="font-semibold">
                {t("admin.datasets.scanResult")} ({scanPreview.totalPrompts} prompts)
              </div>
              <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
                <StatTile
                  label={t("admin.datasets.matched")}
                  value={scanPreview.matched.length}
                  tone="good"
                />
                <StatTile
                  label={t("admin.datasets.unmatched")}
                  value={scanPreview.unmatched.length}
                  tone={scanPreview.unmatched.length > 0 ? "warn" : "neutral"}
                />
                <StatTile
                  label={t("admin.datasets.multiMatched")}
                  value={scanPreview.multiMatched.length}
                  tone={
                    scanPreview.multiMatched.length > 0 ? "bad" : "neutral"
                  }
                />
                <StatTile
                  label={t("admin.datasets.unclaimed")}
                  value={scanPreview.unclaimed.length}
                  tone="neutral"
                />
              </div>
              {scanPreview.multiMatched.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-medium text-destructive">
                    {t("admin.datasets.multiMatched")} (
                    {scanPreview.multiMatched.length})
                  </summary>
                  <ul className="mt-1 space-y-1 pl-4">
                    {scanPreview.multiMatched.slice(0, 10).map((m) => (
                      <li key={m.externalId} className="font-mono">
                        <span className="font-semibold">{m.externalId}</span>:{" "}
                        {m.ossKeys.join(", ")}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {scanPreview.unmatched.length > 0 && (
                <details>
                  <summary className="cursor-pointer font-medium text-amber-600 dark:text-amber-400">
                    {t("admin.datasets.unmatched")} (
                    {scanPreview.unmatched.length})
                  </summary>
                  <ul className="mt-1 flex flex-wrap gap-1 pl-4">
                    {scanPreview.unmatched.slice(0, 30).map((id) => (
                      <code
                        key={id}
                        className="rounded bg-amber-500/10 px-1 py-0.5 font-mono text-[10px]"
                      >
                        {id}
                      </code>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>

        {/* Step 5: Image Set (I2V only) */}
        {taskType === "I2V" && (
          <section>
            <label className="mb-2 block text-sm font-semibold">
              {t("admin.datasets.stepImage")}
            </label>
            <div className="space-y-2">
              <Input
                placeholder={t("admin.datasets.imagePrefixPlaceholder")}
                value={imageOssPrefix}
                onChange={(e) => setImageOssPrefix(e.target.value)}
                className="font-mono text-sm"
              />
              {imageOssPrefix.trim() && (
                <div>
                  <label className="mb-1 block text-xs font-medium">
                    {t("admin.datasets.imageSetNameLabel")}
                  </label>
                  <Input
                    placeholder={suggestedImageSetName}
                    value={imageSetName}
                    onChange={(e) => setImageSetName(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setImageSetName(suggestedImageSetName)}
                    className="mt-1 text-xs text-muted-foreground underline hover:text-foreground"
                  >
                    {t("admin.create.useSuggested")}: {suggestedImageSetName}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Step 6: Video generation parameters (optional) */}
        <section>
          <label className="mb-1 block text-sm font-semibold">
            {t("admin.datasets.stepParams")}
          </label>
          <p className="mb-2 text-xs text-muted-foreground">
            {t("admin.datasets.stepParamsHint")}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">
                {t("admin.datasets.frames")}
              </label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder={t("admin.datasets.framesPlaceholder")}
                value={frames}
                onChange={(e) => setFrames(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                {t("admin.datasets.resolution")}
              </label>
              <Input
                placeholder={t("admin.datasets.resolutionPlaceholder")}
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                {t("admin.datasets.duration")}
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder={t("admin.datasets.durationPlaceholder")}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                {t("admin.datasets.aspect")}
              </label>
              <Input
                placeholder={t("admin.datasets.aspectPlaceholder")}
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Dataset Name */}
        <section>
          <label className="mb-2 block text-sm font-semibold">
            {t("admin.datasets.nameLabel")}
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
            {t("admin.datasets.nameAuto")}: {suggestedName}
          </button>
        </section>
      </div>

      <div className="mt-6 flex shrink-0 justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("admin.create.cancel")}
        </Button>
        <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
          {pending
            ? t("admin.datasets.creating")
            : t("admin.datasets.create")}
        </Button>
      </div>

      {/* Edit existing model dialog. taskType is intentionally read-only —
          flipping it would invalidate every existing VideoAsset under this
          model (per @@unique(modelId, promptId)). */}
      <Dialog
        open={!!editingModelId}
        onOpenChange={(v) => {
          if (!v && !editBusy) setEditingModelId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.datasets.editModel") ?? "编辑 Model"}
            </DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? `taskType 不可修改（${editingModel?.taskType ?? ""}）。`
                : `taskType is read-only (${editingModel?.taskType ?? ""}).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {t("admin.datasets.newModelName") ?? "Model 名称"}
                <span className="ml-1 text-red-500">*</span>
              </label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="e.g. Kling 3.0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {t("admin.datasets.newModelProvider") ?? "Provider"}
                <span className="ml-1 text-muted-foreground text-[10px]">
                  ({t("admin.optional") ?? "选填"})
                </span>
              </label>
              <Input
                value={editProvider}
                onChange={(e) => setEditProvider(e.target.value)}
                placeholder="e.g. Kling / Vidu / Runway"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {t("admin.datasets.newModelDesc") ?? "备注（可选）"}
              </label>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="e.g. preview build, 2026-04"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditingModelId(null)}
              disabled={editBusy}
            >
              {t("admin.create.cancel") ?? "取消"}
            </Button>
            <Button
              onClick={handleEditModelSave}
              disabled={editBusy || !editName.trim()}
            >
              {editBusy
                ? (locale === "zh" ? "保存中…" : "Saving…")
                : (locale === "zh" ? "保存" : "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass = {
    good: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    warn: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    bad: "border-destructive/40 bg-destructive/5 text-destructive",
    neutral: "border-border bg-muted/40 text-foreground",
  }[tone];
  return (
    <div className={`rounded-md border px-2 py-1.5 ${toneClass}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

// Card grid replacing the old <select> dropdown. Each card surfaces the
// metadata an admin needs to recognize a Prompt Suite at a glance:
// T2V/I2V badge, creation date, dimension & prompt counts. Delete button
// is conditionally enabled — a suite referenced by any Package or Dataset
// is protected by the server action and the button is disabled with a
// tooltip explaining why.
function PromptSuiteCardGrid({
  suites,
  selectedId,
  onSelect,
  locale,
}: {
  suites: WizardPromptSuite[];
  selectedId: string;
  onSelect: (id: string) => void;
  locale: "zh" | "en";
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (suites.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {locale === "zh"
          ? "暂无匹配的 Prompt Suite —— 请上传 xlsx"
          : "No matching Prompt Suites — upload an xlsx"}
      </div>
    );
  }

  const handleDelete = async (s: WizardPromptSuite) => {
    const msg =
      locale === "zh"
        ? `确定删除 Prompt Suite "${s.name}"？此操作不可撤销。`
        : `Delete Prompt Suite "${s.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    setBusyId(s.id);
    try {
      const res = await deletePromptSuite(s.id);
      if (res.status !== "ok") {
        alert(res.message);
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {suites.map((s) => {
        const isSelected = s.id === selectedId;
        const canDelete = (s.linkedPackageCount ?? 0) === 0;
        return (
          <div
            key={s.id}
            className={`group relative rounded-md border p-3 text-left transition-colors ${
              isSelected
                ? "border-primary/60 bg-primary/5"
                : "border-border bg-card hover:border-primary/30 hover:bg-accent/30"
            }`}
          >
            <button
              type="button"
              className="block w-full text-left"
              onClick={() => onSelect(s.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase ${
                        s.taskType === "T2V"
                          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {s.taskType}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {s.name}
                    </span>
                    {isSelected && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-primary"
                        strokeWidth={2.25}
                      />
                    )}
                  </div>
                  {s.description && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {s.description}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono tabular-nums">
                  {s.entryCount} {locale === "zh" ? "条" : "prompts"}
                </span>
                {s.dimensionCount != null && (
                  <span className="font-mono tabular-nums">
                    {s.dimensionCount} {locale === "zh" ? "维度" : "dims"}
                  </span>
                )}
                {s.createdAt && (
                  <span className="font-mono tabular-nums">
                    {new Date(s.createdAt).toISOString().slice(0, 10)}
                  </span>
                )}
                {(s.linkedPackageCount ?? 0) > 0 && (
                  <span className="rounded-sm bg-muted px-1 py-0.5 text-[9px]">
                    {locale === "zh"
                      ? `已被 ${s.linkedPackageCount} 任务引用`
                      : `${s.linkedPackageCount} in use`}
                  </span>
                )}
              </div>
            </button>
            {/* Delete button + instant-visible tooltip. Native `title`
                has a 500ms browser delay — admins reported it felt
                broken. Custom sibling-based tooltip reveals on hover
                immediately via CSS group-hover/tip. */}
            <div className="group/tip absolute right-2 top-2 flex items-center">
              <span
                aria-hidden={canDelete}
                className="pointer-events-none mr-1 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground shadow-md group-hover/tip:block"
              >
                {canDelete
                  ? locale === "zh" ? "删除" : "Delete"
                  : locale === "zh"
                    ? "该 Suite 已被任务引用，无法删除"
                    : "In use — cannot delete"}
              </span>
              <button
                type="button"
                disabled={busyId === s.id || !canDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(s);
                }}
                className="rounded-sm p-1 text-muted-foreground opacity-0 transition-all hover:bg-red-500/10 hover:text-red-600 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
              >
                <Trash2 className="h-3 w-3" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 4-step phase progress bar for the prompt-suite upload pipeline.
// Phases are deterministic milestones the action goes through; the
// caller flips state at each boundary. The bar fills smoothly via CSS
// transition so single-frame updates still feel animated.
function SuiteUploadProgressBar({
  phase,
  rowCount,
  locale,
}: {
  phase: "idle" | "encoding" | "preview" | "saving" | "done" | "error";
  rowCount: number;
  locale: "zh" | "en";
}) {
  const phaseOrder = ["encoding", "preview", "saving", "done"] as const;
  const phaseIndex = (phaseOrder as readonly string[]).indexOf(phase);
  const isError = phase === "error";
  const pct = isError
    ? 100
    : phase === "done"
      ? 100
      : phaseIndex < 0
        ? 0
        : ((phaseIndex + 1) / phaseOrder.length) * 100;
  const labelByPhase: Record<typeof phaseOrder[number] | "error", { zh: string; en: string }> = {
    encoding: { zh: "正在读取文件…", en: "Reading file…" },
    preview: {
      zh: "解析表格 + 校验列头…",
      en: "Parsing rows + validating headers…",
    },
    saving: {
      zh: rowCount
        ? `批量写入 ${rowCount} 行 prompt + 维度 + suite 关联…`
        : "正在保存到数据库…",
      en: rowCount
        ? `Batch-writing ${rowCount} prompts + dimensions + suite entries…`
        : "Writing to database…",
    },
    done: {
      zh: "完成",
      en: "Done",
    },
    error: {
      zh: "失败（详见上方错误信息）",
      en: "Failed (see error above)",
    },
  };
  const label =
    isError
      ? labelByPhase.error
      : phase === "idle"
        ? null
        : labelByPhase[phase as typeof phaseOrder[number]];
  if (!label) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            isError
              ? "bg-destructive"
              : phase === "done"
                ? "bg-emerald-500"
                : "animate-pulse bg-primary"
          }`}
        />
        <span>{locale === "zh" ? label.zh : label.en}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all duration-300 ease-out ${
            isError ? "bg-destructive" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
