"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity, Ban, FileCheck2, Inbox, Play, Settings2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/lib/i18n/context";
import { CapabilityRadar } from "@/components/admin/capability-radar";
import { CalibrationModelCard } from "@/components/admin/calibration-model-card";
import { CalibrationAbilityHero } from "@/components/admin/calibration-ability-hero";
import { CalibrationForestSection } from "@/components/admin/calibration-forest-section";
import { CalibrationAnnotatorDrawer } from "@/components/admin/calibration-annotator-drawer";
import { ForestPlotRow } from "@/components/admin/forest-plot-row";
import { RankogramStrip } from "@/components/admin/rankogram-strip";
import type { LeaderboardResponse } from "@/app/(main)/admin/annotators/leaderboard-action";
import { ChevronDown, ChevronUp, Download, RefreshCw } from "lucide-react";
import {
  markAsCalibrationBatch,
  importGroundTruthFromJson,
  runCalibrationAssessment,
  listEligiblePackages,
  listPackageAnnotators,
  previewDerivedGroundTruth,
  deriveGroundTruthFromAnnotators,
} from "@/app/(main)/admin/annotators/assessment-action";
import type {
  CalibrationBatchSummary,
  PackageAnnotatorSummary,
  DerivePreview,
} from "@/app/(main)/admin/annotators/assessment-action";

interface AssessmentResult {
  userId: string;
  userName: string;
  itemsEvaluated: number;
  scores: {
    accuracy: number;
    consistency: number;
    coverage: number;
    detailOriented: number;
    speed: number;
    compositeScore: number;
  } | null;
  posterior: {
    alphaMean: number;
    alphaStd: number;
    alphaCILow: number;
    alphaCIHigh: number;
  } | null;
  rankPercentile: number | null;
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | null;
  reason?: string;
}

interface Props {
  batches: CalibrationBatchSummary[];
  leaderboard: LeaderboardResponse;
  isAdmin: boolean;
}

type Message = { text: string; type: "ok" | "error" };

export function AssessmentBatchCreator({ batches, leaderboard, isAdmin }: Props) {
  const { locale, t } = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [groundTruthTarget, setGroundTruthTarget] = useState<CalibrationBatchSummary | null>(null);
  const [unmarkTarget, setUnmarkTarget] = useState<CalibrationBatchSummary | null>(null);
  const [runTarget, setRunTarget] = useState<CalibrationBatchSummary | null>(null);
  const [eligiblePackages, setEligiblePackages] = useState<
    { id: string; name: string; taskType: string }[]
  >([]);
  const [selectedEligibleId, setSelectedEligibleId] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [runResults, setRunResults] = useState<AssessmentResult[] | null>(null);

  // Bold UI drawer state — clicking a forest row opens this.
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const drawerRowIndex =
    drawerUserId != null
      ? leaderboard.rows.findIndex((r) => r.userId === drawerUserId)
      : -1;

  // Batch-management panel is collapsed by default — the leaderboard is
  // the primary view; operations are secondary.
  const [batchPanelOpen, setBatchPanelOpen] = useState(batches.length === 0);

  // Phase B: derive GT from annotator votes
  const [gtMode, setGtMode] = useState<"json" | "vote">("json");
  const [annotators, setAnnotators] = useState<PackageAnnotatorSummary[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<DerivePreview[] | null>(null);
  const [loadingAnnotators, setLoadingAnnotators] = useState(false);

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  useEffect(() => {
    if (!promoteOpen || !isAdmin) return;
    listEligiblePackages().then((res) => {
      if (res.status === "ok") setEligiblePackages(res.data);
    });
  }, [promoteOpen, isAdmin]);

  // Fetch annotators lazily when user switches to vote mode for the first time
  useEffect(() => {
    if (!groundTruthTarget || gtMode !== "vote") return;
    if (annotators.length > 0) return;
    setLoadingAnnotators(true);
    listPackageAnnotators(groundTruthTarget.id)
      .then((res) => {
        if (res.status === "ok") setAnnotators(res.data);
        else setMessage({ text: res.message, type: "error" });
      })
      .finally(() => setLoadingAnnotators(false));
  }, [groundTruthTarget, gtMode, annotators.length]);

  // Reset vote-mode state when the dialog closes
  useEffect(() => {
    if (groundTruthTarget === null) {
      setGtMode("json");
      setAnnotators([]);
      setSelectedUserIds(new Set());
      setPreview(null);
    }
  }, [groundTruthTarget]);

  const handlePromote = async () => {
    if (!selectedEligibleId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await markAsCalibrationBatch(selectedEligibleId, true);
      if (res.status === "ok") {
        setPromoteOpen(false);
        setSelectedEligibleId("");
        setMessage({
          text: locale === "zh" ? "已标记为校准批次" : "Marked as calibration batch",
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImportGroundTruth = async () => {
    if (!groundTruthTarget) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await importGroundTruthFromJson(groundTruthTarget.id, jsonText);
      if (res.status === "ok") {
        setGroundTruthTarget(null);
        setJsonText("");
        setMessage({
          text:
            locale === "zh"
              ? `已导入 ${res.data.upserted} 条，跳过 ${res.data.skipped.length} 条`
              : `Imported ${res.data.upserted} rows, skipped ${res.data.skipped.length}`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewDerive = async () => {
    if (!groundTruthTarget || selectedUserIds.size === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await previewDerivedGroundTruth(
        groundTruthTarget.id,
        Array.from(selectedUserIds),
      );
      if (res.status === "ok") {
        setPreview(res.data.rows);
        if (res.data.rows.length === 0) {
          setMessage({
            text:
              locale === "zh"
                ? "所选评测员在该任务下没有已完成的有效评分"
                : "Selected annotators have no valid completed scores in this package",
            type: "error",
          });
        }
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCommitDerive = async () => {
    if (!groundTruthTarget || selectedUserIds.size === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await deriveGroundTruthFromAnnotators(
        groundTruthTarget.id,
        Array.from(selectedUserIds),
      );
      if (res.status === "ok") {
        setGroundTruthTarget(null);
        setMessage({
          text:
            locale === "zh"
              ? `已合成 ${res.data.upserted} 条标准答案（由 ${selectedUserIds.size} 位评测员投票得出）`
              : `Derived ${res.data.upserted} ground-truth rows from ${selectedUserIds.size} annotator(s)`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleUnmark = async () => {
    if (!unmarkTarget) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await markAsCalibrationBatch(unmarkTarget.id, false);
      if (res.status === "ok") {
        setUnmarkTarget(null);
        setMessage({
          text:
            locale === "zh"
              ? "已取消校准批次标记（标准答案与历史评估记录保留）"
              : "Calibration batch unmarked (ground truth and past assessments preserved)",
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRun = async (batch: CalibrationBatchSummary) => {
    setBusy(true);
    setMessage(null);
    setRunResults(null);
    setRunTarget(batch);
    try {
      const res = await runCalibrationAssessment(batch.id);
      if (res.status === "ok") {
        setRunResults(res.data.results);
        setMessage({
          text:
            locale === "zh"
              ? `已为 ${res.data.results.length} 位评测员计算能力评估`
              : `Assessed ${res.data.results.length} annotators`,
          type: "ok",
        });
        refresh();
      } else {
        setMessage({ text: res.message, type: "error" });
        setRunTarget(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const jsonTemplate = `[
  {
    "videoExternalId": "T2V_001",
    "dimensionCode": "D4.1",
    "score": 4,
    "failureTags": []
  },
  {
    "videoExternalId": "T2V_002",
    "dimensionCode": "D4.1",
    "score": 2,
    "failureTags": ["tag_id_here"],
    "notes": "scene transition artifact"
  }
]`;

  // Shared forest-plot axis bounds: every row in the Run Results table
  // renders its CI against the same α range, so visual widths compare
  // fairly across annotators. Pad ±0.3 so the widest CI doesn't kiss the
  // edge. Fall back to a symmetric range when no posteriors are present.
  const posteriorsForAxis = (runResults ?? [])
    .map((r) => r.posterior)
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const forestAxisMin = posteriorsForAxis.length
    ? Math.min(...posteriorsForAxis.map((p) => p.alphaCILow)) - 0.3
    : -3;
  const forestAxisMax = posteriorsForAxis.length
    ? Math.max(...posteriorsForAxis.map((p) => p.alphaCIHigh)) + 0.3
    : 3;

  // Aggregate tier distribution + observation counts across all batches so
  // the Ability Hero reflects the whole calibration program, not one batch.
  // teamAlpha / avgCIWidth are null until Phase 9 adds real MCMC posterior.
  const aggregatedTiers = batches.reduce(
    (acc, b) => {
      acc.TIER_1 += b.tierDistribution.TIER_1;
      acc.TIER_2 += b.tierDistribution.TIER_2;
      acc.TIER_3 += b.tierDistribution.TIER_3;
      acc.TIER_4 += b.tierDistribution.TIER_4;
      acc.unassessed += b.tierDistribution.unassessed;
      return acc;
    },
    { TIER_1: 0, TIER_2: 0, TIER_3: 0, TIER_4: 0, unassessed: 0 },
  );
  const totalObservations = batches.reduce(
    (s, b) => s + b.completedItemCount,
    0,
  );

  return (
    <div className="space-y-5">
      {/* Header — title + subtitle + Phase 9 action buttons */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            {locale === "zh" ? "能力评估" : "Capability Assessment"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bayesian hierarchical IRT ·{" "}
            {locale === "zh"
              ? "统一 GRM + Davidson-BT · α_r 后验 + 95% CI"
              : "Unified GRM + Davidson-BT · α_r posterior + 95% CI"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled
            title={locale === "zh" ? "Phase 9 接入" : "Coming in Phase 9"}
          >
            <Download className="mr-2 h-4 w-4" />
            {locale === "zh" ? "导出后验样本" : "Export posterior"}
          </Button>
          <Button
            size="sm"
            disabled
            title={locale === "zh" ? "Phase 9 接入" : "Coming in Phase 9"}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {locale === "zh" ? "重新 MCMC 采样" : "Re-run MCMC"}
          </Button>
        </div>
      </div>

      {/* Model card with real sampler diagnostics */}
      <CalibrationModelCard
        rHat={leaderboard.aggregate.diagnostics.rHat}
        divergent={leaderboard.aggregate.diagnostics.divergent}
        chains={leaderboard.aggregate.diagnostics.chains}
        waic={leaderboard.aggregate.diagnostics.waic}
        sparseAnnotators={leaderboard.aggregate.diagnostics.sparseAnnotators}
      />

      {/* Ability hero */}
      <CalibrationAbilityHero
        teamKrippendorffAlpha={leaderboard.aggregate.teamKrippendorffAlpha}
        iccTwoK={leaderboard.aggregate.iccTwoK}
        tierDistribution={leaderboard.aggregate.tierDistribution}
        avgCIWidth={leaderboard.aggregate.avgCIWidth}
        observations={leaderboard.aggregate.observations}
      />

      {/* Forest plot + leaderboard */}
      <CalibrationForestSection
        rows={leaderboard.rows}
        sampleAdequacy={leaderboard.aggregate.sampleAdequacy}
        onSelect={(uid) => setDrawerUserId(uid)}
      />

      {/* Drawer */}
      <CalibrationAnnotatorDrawer
        userId={drawerUserId}
        onClose={() => setDrawerUserId(null)}
        positionIndex={drawerRowIndex >= 0 ? drawerRowIndex : null}
        total={leaderboard.rows.length}
      />

      {/* Collapsible batch management — secondary workflow kept
          accessible but visually subordinate to the leaderboard. */}
      <div className="rounded-xl border bg-card/40">
        <button
          type="button"
          onClick={() => setBatchPanelOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/40"
        >
          <div>
            <h3 className="text-sm font-semibold">
              {locale === "zh" ? "校准批次管理" : "Calibration Batch Management"}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {locale === "zh"
                ? `标记任务 · 设定标准答案 · 运行评估（共 ${batches.length} 个批次）`
                : `Promote · set ground truth · run assessment (${batches.length} batches)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setPromoteOpen(true);
                }}
              >
                <Settings2 className="mr-2 h-4 w-4" />
                {locale === "zh" ? "标记任务为校准批次" : "Promote Package"}
              </Button>
            )}
            {batchPanelOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        {batchPanelOpen && <div className="space-y-4 border-t px-5 py-5">


      {message && (
        <div
          className={`rounded-md px-3 py-2 text-sm ${
            message.type === "ok"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Batch list */}
      {batches.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/30 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {locale === "zh" ? "暂无校准批次" : "No calibration batches yet"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {locale === "zh"
                ? '点击"标记任务为校准批次"从已有评测任务中选取一个作为起点'
                : "Promote an existing evaluation package to get started"}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{locale === "zh" ? "任务名称" : "Name"}</TableHead>
                <TableHead className="w-[100px]">
                  {locale === "zh" ? "类型" : "Type"}
                </TableHead>
                <TableHead className="w-[120px]">
                  {locale === "zh" ? "视频×维度" : "Items"}
                </TableHead>
                <TableHead className="w-[140px]">
                  {locale === "zh" ? "标准答案" : "Ground Truth"}
                </TableHead>
                <TableHead className="w-[130px]">
                  {locale === "zh" ? "完成度" : "Completion"}
                </TableHead>
                <TableHead className="w-[160px]">
                  {locale === "zh" ? "最近评估" : "Last Run"}
                </TableHead>
                <TableHead className="w-[200px]">
                  {locale === "zh" ? "分档分布" : "Tier Distribution"}
                </TableHead>
                <TableHead className="w-[220px] text-right">
                  {locale === "zh" ? "操作" : "Actions"}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => {
                const hasGroundTruth = batch.groundTruthCount > 0;
                const canRun =
                  hasGroundTruth && batch.completedItemCount > 0 && !busy;
                return (
                  <TableRow key={batch.id}>
                    <TableCell className="font-medium">{batch.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{batch.taskType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {batch.videoCount} × {batch.annotatorCount}
                    </TableCell>
                    <TableCell>
                      {hasGroundTruth ? (
                        <span className="inline-flex items-center gap-1 text-sm">
                          <FileCheck2 className="h-3.5 w-3.5 text-emerald-500" />
                          {batch.groundTruthCount}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {locale === "zh" ? "未设定" : "Not set"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs tabular-nums">
                        {batch.completedItemCount}/{batch.totalItemCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {batch.lastAssessmentAt
                        ? new Date(batch.lastAssessmentAt).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <TierDistributionBar
                        distribution={batch.tierDistribution}
                        locale={locale}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setGroundTruthTarget(batch);
                              setJsonText("");
                            }}
                          >
                            <Upload className="mr-1 h-3.5 w-3.5" />
                            {locale === "zh" ? "标准答案" : "Ground Truth"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={!canRun}
                          onClick={() => handleRun(batch)}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" />
                          {locale === "zh" ? "运行评估" : "Run"}
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setUnmarkTarget(batch)}
                            title={
                              locale === "zh"
                                ? "取消校准标记（不删除数据）"
                                : "Unmark as calibration (data preserved)"
                            }
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
        </div>}
      </div>

      {/* Promote dialog */}
      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {locale === "zh" ? "标记任务为校准批次" : "Promote to Calibration Batch"}
            </DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? "从已发布的评分任务中选取一个作为校准批次。标记后可为其设定标准答案并运行能力评估。"
                : "Select a published scoring package to promote as a calibration batch. Once promoted, you can set ground truth answers and run capability assessments."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block text-sm font-medium">
              {locale === "zh" ? "选择任务" : "Package"}
            </label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedEligibleId}
              onChange={(e) => setSelectedEligibleId(e.target.value)}
            >
              <option value="">
                {locale === "zh" ? "— 请选择 —" : "— Select —"}
              </option>
              {eligiblePackages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.taskType})
                </option>
              ))}
            </select>
            {eligiblePackages.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {locale === "zh"
                  ? "暂无可标记的评分任务"
                  : "No eligible scoring packages available"}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPromoteOpen(false);
                setSelectedEligibleId("");
              }}
              disabled={busy}
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button onClick={handlePromote} disabled={!selectedEligibleId || busy}>
              {locale === "zh" ? "确认标记" : "Promote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ground truth import/derive dialog */}
      <Dialog
        open={groundTruthTarget !== null}
        onOpenChange={(o) => !o && setGroundTruthTarget(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {locale === "zh" ? "设定标准答案" : "Set Ground Truth"}
              {groundTruthTarget && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {groundTruthTarget.name}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? "选择一种方式设定标准答案：直接上传 JSON，或从已有评测员评分投票合成。"
                : "Pick a source for ground truth: paste a JSON array, or synthesise from selected annotators' existing scores."}
            </DialogDescription>
          </DialogHeader>

          {/* Mode switcher */}
          <div className="flex gap-1 rounded-lg border bg-muted/30 p-1">
            <button
              type="button"
              onClick={() => setGtMode("json")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                gtMode === "json"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {locale === "zh" ? "① JSON 上传" : "① Upload JSON"}
            </button>
            <button
              type="button"
              onClick={() => setGtMode("vote")}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                gtMode === "vote"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {locale === "zh" ? "② 从评测员评分合成" : "② Derive from Annotator Votes"}
            </button>
          </div>

          {/* JSON mode body */}
          {gtMode === "json" && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs">
                <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {locale === "zh" ? "示例格式" : "Example"}
                </div>
                <pre className="whitespace-pre-wrap">{jsonTemplate}</pre>
              </div>
              <textarea
                className="h-48 w-full rounded-md border bg-background p-3 font-mono text-xs"
                placeholder={locale === "zh" ? "粘贴 JSON..." : "Paste JSON..."}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                {locale === "zh"
                  ? "现有答案会被覆盖更新；未列出的行不受影响。"
                  : "Existing rows upsert by (video, dimension); omitted rows are untouched."}
              </p>
            </div>
          )}

          {/* Vote mode body */}
          {gtMode === "vote" && (
            <div className="space-y-3">
              <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-200">
                <p className="font-medium">
                  {locale === "zh" ? "合成算法" : "Synthesis algorithm"}
                </p>
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[11px]">
                  <li>
                    {locale === "zh"
                      ? "分数：对所选评测员每个 (视频×维度) 的 Likert 分数取中位数"
                      : "Score: median Likert across selected annotators per (video, dimension)"}
                  </li>
                  <li>
                    {locale === "zh"
                      ? "Failure Tags：多数投票（>50% 投票人支持）"
                      : "Failure tags: majority vote (>50% of voters must agree)"}
                  </li>
                  <li>
                    {locale === "zh"
                      ? "仅使用 validity=VALID 且 item status=COMPLETED 的评分"
                      : "Only uses VALID, COMPLETED scores (anti-cheat flagged rows are excluded)"}
                  </li>
                </ul>
              </div>

              {loadingAnnotators ? (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  {locale === "zh" ? "加载评测员..." : "Loading annotators..."}
                </div>
              ) : annotators.length === 0 ? (
                <div className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
                  {locale === "zh"
                    ? "该任务暂无已完成评分的评测员"
                    : "No annotators have completed scores for this package yet"}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">
                      {locale === "zh"
                        ? `评测员 (${annotators.length} 人可选，已选 ${selectedUserIds.size})`
                        : `Annotators (${annotators.length} available, ${selectedUserIds.size} selected)`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedUserIds(new Set(annotators.map((a) => a.userId)))}
                        disabled={busy}
                      >
                        {locale === "zh" ? "全选" : "Select all"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedUserIds(new Set())}
                        disabled={busy}
                      >
                        {locale === "zh" ? "清空" : "Clear"}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-md border bg-card">
                    {annotators.map((a) => {
                      const checked = selectedUserIds.has(a.userId);
                      const pct =
                        a.totalItemCount > 0
                          ? Math.round((a.completedItemCount / a.totalItemCount) * 100)
                          : 0;
                      return (
                        <label
                          key={a.userId}
                          className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-xs last:border-b-0 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = new Set(selectedUserIds);
                              if (e.target.checked) next.add(a.userId);
                              else next.delete(a.userId);
                              setSelectedUserIds(next);
                              setPreview(null); // invalidate preview on selection change
                            }}
                            className="h-4 w-4"
                          />
                          <div className="flex-1 truncate">
                            <span className="font-medium">{a.userName}</span>
                            {a.email && (
                              <span className="ml-2 text-muted-foreground">{a.email}</span>
                            )}
                          </div>
                          <span className="tabular-nums text-muted-foreground">
                            {a.completedItemCount}/{a.totalItemCount} ({pct}%)
                          </span>
                          {a.compositeScore != null && (
                            <span className="tabular-nums font-mono">
                              {a.compositeScore.toFixed(1)}
                            </span>
                          )}
                          {a.tier && (
                            <Badge variant="secondary" className="text-[10px]">
                              {a.tier.replace("TIER_", "T")}
                            </Badge>
                          )}
                        </label>
                      );
                    })}
                  </div>

                  {preview && preview.length > 0 && (
                    <div className="rounded-md border bg-card">
                      <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium">
                        <span>
                          {locale === "zh"
                            ? `预览 (${preview.length} 条待合成)`
                            : `Preview (${preview.length} rows)`}
                        </span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[10px]">
                                {locale === "zh" ? "视频" : "Video"}
                              </TableHead>
                              <TableHead className="text-[10px]">
                                {locale === "zh" ? "维度" : "Dimension"}
                              </TableHead>
                              <TableHead className="text-[10px]">
                                {locale === "zh" ? "中位分" : "Median"}
                              </TableHead>
                              <TableHead className="text-[10px]">
                                {locale === "zh" ? "投票人" : "Voters"}
                              </TableHead>
                              <TableHead className="text-[10px]">
                                {locale === "zh" ? "原始分" : "Raw"}
                              </TableHead>
                              <TableHead className="text-[10px]">Tags</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview.slice(0, 50).map((r) => (
                              <TableRow key={`${r.videoAssetId}-${r.dimensionId}`}>
                                <TableCell className="text-[11px] font-mono">
                                  {r.videoExternalId}
                                </TableCell>
                                <TableCell className="text-[11px] font-mono">
                                  {r.dimensionCode}
                                </TableCell>
                                <TableCell className="text-[11px] font-mono tabular-nums">
                                  {r.consensusScore}
                                </TableCell>
                                <TableCell className="text-[11px] tabular-nums">
                                  {r.voterCount}
                                </TableCell>
                                <TableCell className="text-[11px] text-muted-foreground tabular-nums">
                                  [{r.rawScores.join(", ")}]
                                </TableCell>
                                <TableCell className="text-[11px] text-muted-foreground">
                                  {r.consensusTags.length > 0 ? r.consensusTags.length : "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {preview.length > 50 && (
                          <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
                            {locale === "zh"
                              ? `仅显示前 50 条，共 ${preview.length} 条`
                              : `Showing first 50 of ${preview.length} rows`}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setGroundTruthTarget(null);
                setJsonText("");
              }}
              disabled={busy}
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            {gtMode === "json" ? (
              <Button onClick={handleImportGroundTruth} disabled={!jsonText.trim() || busy}>
                {locale === "zh" ? "导入" : "Import"}
              </Button>
            ) : preview === null ? (
              <Button
                onClick={handlePreviewDerive}
                disabled={selectedUserIds.size === 0 || busy}
              >
                {locale === "zh" ? "预览合成结果" : "Preview"}
              </Button>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                  {locale === "zh" ? "重新选择" : "Back"}
                </Button>
                <Button
                  onClick={handleCommitDerive}
                  disabled={preview.length === 0 || busy}
                >
                  {locale === "zh"
                    ? `确认合成 ${preview.length} 条`
                    : `Commit ${preview.length} rows`}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unmark confirmation dialog */}
      <Dialog
        open={!!unmarkTarget}
        onOpenChange={(open) => !open && setUnmarkTarget(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {locale === "zh" ? "取消校准批次标记" : "Unmark as Calibration Batch"}
            </DialogTitle>
            <DialogDescription>
              {locale === "zh"
                ? `确认将「${unmarkTarget?.name ?? ""}」从校准评估数据集中移除？`
                : `Remove "${unmarkTarget?.name ?? ""}" from the calibration dataset?`}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <ul className="ml-4 list-disc space-y-1">
              <li>
                {locale === "zh"
                  ? `已设定的 ${unmarkTarget?.groundTruthCount ?? 0} 条标准答案保留，不会删除`
                  : `Existing ${unmarkTarget?.groundTruthCount ?? 0} ground-truth rows are preserved (not deleted)`}
              </li>
              <li>
                {locale === "zh"
                  ? "历史能力评估记录（CapabilityAssessment）保留，可在评测员详情查看"
                  : "Past CapabilityAssessment records are preserved and remain visible on annotator detail pages"}
              </li>
              <li>
                {locale === "zh"
                  ? "该任务继续作为普通评测任务存在，仅从校准评估 tab 消失"
                  : "The package continues to exist as a regular evaluation; it only disappears from this Calibration tab"}
              </li>
              <li>
                {locale === "zh"
                  ? "如需重新加入校准集，可通过「标记任务为校准批次」再次选择"
                  : "To re-add, use the Promote Package action again"}
              </li>
            </ul>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUnmarkTarget(null)}
              disabled={busy}
            >
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              onClick={handleUnmark}
              disabled={busy}
            >
              <Ban className="mr-1 h-3.5 w-3.5" />
              {locale === "zh" ? "确认取消校准" : "Unmark"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Results dialog */}
      <Dialog
        open={runResults !== null}
        onOpenChange={(o) => {
          if (!o) {
            setRunResults(null);
            setRunTarget(null);
          }
        }}
      >
        <DialogContent className="w-[min(1400px,95vw)] max-w-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle>
              <Activity className="mr-2 inline h-4 w-4" />
              {locale === "zh" ? "评估结果" : "Assessment Results"}
              {runTarget && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {runTarget.name}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {runResults && runResults.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {locale === "zh"
                ? "没有可评估的评测员（需要有已完成的项目 + 标准答案）"
                : "No annotators to assess (need completed items with ground truth)"}
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[140px]">{locale === "zh" ? "评测员" : "Annotator"}</TableHead>
                    <TableHead className="w-[80px]">
                      {locale === "zh" ? "项数" : "Items"}
                    </TableHead>
                    <TableHead className="w-[140px]">
                      {locale === "zh" ? "雷达" : "Radar"}
                    </TableHead>
                    <TableHead className="w-[100px]">
                      {locale === "zh" ? "综合" : "Score"}
                    </TableHead>
                    <TableHead className="w-[260px]">
                      {locale === "zh" ? "能力 α (95% CI)" : "Ability α (95% CI)"}
                    </TableHead>
                    <TableHead className="w-[140px]">
                      {locale === "zh" ? "分位 / 分档" : "Rank / Tier"}
                    </TableHead>
                    <TableHead className="w-[150px]">
                      {locale === "zh" ? "排名分布" : "Rankogram"}
                    </TableHead>
                    <TableHead className="min-w-[280px]">{locale === "zh" ? "细节" : "Breakdown"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runResults?.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="font-medium">{r.userName}</TableCell>
                      <TableCell>{r.itemsEvaluated}</TableCell>
                      <TableCell>
                        <CapabilityRadar
                          scores={r.scores}
                          size="sm"
                          posterior={r.posterior}
                          tier={r.tier}
                          rankPercentile={r.rankPercentile}
                        />
                      </TableCell>
                      <TableCell>
                        {r.scores ? (
                          <span className="font-mono font-semibold tabular-nums">
                            {r.scores.compositeScore.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {r.reason ?? "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.posterior ? (
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs font-semibold tabular-nums">
                              α = {r.posterior.alphaMean.toFixed(2)}
                            </span>
                            <ForestPlotRow
                              mean={r.posterior.alphaMean}
                              ciLow={r.posterior.alphaCILow}
                              ciHigh={r.posterior.alphaCIHigh}
                              axisMin={forestAxisMin}
                              axisMax={forestAxisMax}
                              tone={tierToneOf(r.tier)}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.rankPercentile != null && r.tier ? (
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-xs tabular-nums">
                              {r.rankPercentile.toFixed(0)}%
                            </span>
                            <TierBadge tier={r.tier} locale={locale} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RankogramStrip
                          rankPercentile={r.rankPercentile}
                          total={runResults?.length ?? 0}
                        />
                      </TableCell>
                      <TableCell>
                        {r.scores && (
                          <div className="grid grid-cols-5 gap-x-3 gap-y-1 text-xs">
                            <Metric label={locale === "zh" ? "准确" : "Acc"} value={r.scores.accuracy} />
                            <Metric
                              label={locale === "zh" ? "一致" : "Cons"}
                              value={r.scores.consistency}
                            />
                            <Metric
                              label={locale === "zh" ? "覆盖" : "Cov"}
                              value={r.scores.coverage}
                            />
                            <Metric
                              label={locale === "zh" ? "细致" : "Detail"}
                              value={r.scores.detailOriented}
                            />
                            <Metric
                              label={locale === "zh" ? "速度" : "Speed"}
                              value={r.scores.speed}
                            />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => {
                setRunResults(null);
                setRunTarget(null);
              }}
            >
              {locale === "zh" ? "关闭" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function tierToneOf(
  tier: TierValue | null,
): "default" | "emerald" | "sky" | "amber" | "rose" {
  switch (tier) {
    case "TIER_1":
      return "emerald";
    case "TIER_2":
      return "sky";
    case "TIER_3":
      return "amber";
    case "TIER_4":
      return "rose";
    default:
      return "default";
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-mono tabular-nums">{value.toFixed(1)}</span>
    </div>
  );
}

type TierValue = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4";

const TIER_LABELS: Record<TierValue, { zh: string; en: string; cls: string }> = {
  TIER_1: {
    zh: "T1 优秀",
    en: "T1 Top",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  TIER_2: {
    zh: "T2 稳健",
    en: "T2 Solid",
    cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  TIER_3: {
    zh: "T3 待进",
    en: "T3 Needs Work",
    cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  TIER_4: {
    zh: "T4 低信度",
    en: "T4 Low Conf.",
    cls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  },
};

function TierBadge({ tier, locale }: { tier: TierValue; locale: "zh" | "en" }) {
  const conf = TIER_LABELS[tier];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${conf.cls}`}
    >
      {locale === "zh" ? conf.zh : conf.en}
    </span>
  );
}

/**
 * Compact at-a-glance tier summary for the batch list row. Renders each
 * bucket as a small colored chip with a count. If no one has been assessed
 * yet (all buckets zero), shows an inline hint telling the admin to run
 * assessment — otherwise the row would render as a confusing blank cell.
 */
function TierDistributionBar({
  distribution,
  locale,
}: {
  distribution: {
    TIER_1: number;
    TIER_2: number;
    TIER_3: number;
    TIER_4: number;
    unassessed: number;
  };
  locale: "zh" | "en";
}) {
  const assessed =
    distribution.TIER_1 + distribution.TIER_2 + distribution.TIER_3 + distribution.TIER_4;

  if (assessed === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {locale === "zh" ? "未评估" : "Not run"}
      </span>
    );
  }

  const allChips: { tier: TierValue; count: number }[] = [
    { tier: "TIER_1", count: distribution.TIER_1 },
    { tier: "TIER_2", count: distribution.TIER_2 },
    { tier: "TIER_3", count: distribution.TIER_3 },
    { tier: "TIER_4", count: distribution.TIER_4 },
  ];
  const chips = allChips.filter((c) => c.count > 0);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map(({ tier, count }) => {
        const conf = TIER_LABELS[tier];
        const shortLabel = locale === "zh" ? conf.zh.split(" ")[0] : conf.zh.split(" ")[0];
        return (
          <span
            key={tier}
            className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-mono tabular-nums ${conf.cls}`}
            title={locale === "zh" ? conf.zh : conf.en}
          >
            <span className="font-semibold">{shortLabel}</span>
            <span>·</span>
            <span>{count}</span>
          </span>
        );
      })}
      {distribution.unassessed > 0 && (
        <span
          className="inline-flex items-center gap-0.5 rounded-md border border-muted-foreground/20 bg-muted/30 px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground"
          title={locale === "zh" ? "该批次内未生成评估的评测员数" : "Annotators not yet assessed on this batch"}
        >
          <span>{locale === "zh" ? "未" : "N/A"}</span>
          <span>·</span>
          <span>{distribution.unassessed}</span>
        </span>
      )}
    </div>
  );
}
