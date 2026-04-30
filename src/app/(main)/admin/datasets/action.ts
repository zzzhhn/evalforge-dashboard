"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { scanOssForMatches } from "@/lib/oss-scanner";
import { signDatasetAssets } from "@/lib/signed-url-manager";
import type { TaskType } from "@prisma/client";

async function assertAdmin() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return null;
  }
  return session;
}

export interface DatasetScanPreview {
  matched: { externalId: string; ossKey: string }[];
  unmatched: string[];
  multiMatched: { externalId: string; ossKeys: string[] }[];
  unclaimed: string[];
  totalPrompts: number;
}

/**
 * Scan an OSS prefix against a PromptSuite's externalIds and report
 * match status. Does not mutate DB.
 */
export async function scanDatasetPreview(params: {
  promptSuiteId: string;
  ossPrefix: string;
  kind: "video" | "image";
}): Promise<
  | { status: "ok"; preview: DatasetScanPreview }
  | { status: "error"; message: string }
> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };

  const suite = await prisma.promptSuite.findUnique({
    where: { id: params.promptSuiteId },
    include: {
      entries: { select: { prompt: { select: { externalId: true } } } },
    },
  });
  if (!suite) return { status: "error", message: "PromptSuite 不存在" };

  const externalIds = suite.entries.map((e) => e.prompt.externalId);
  if (externalIds.length === 0) {
    return { status: "error", message: "PromptSuite 为空" };
  }

  try {
    const result = await scanOssForMatches(params.ossPrefix, externalIds);
    return {
      status: "ok",
      preview: {
        matched: [...result.matched.entries()].map(([externalId, ossKey]) => ({
          externalId,
          ossKey,
        })),
        unmatched: result.unmatched,
        multiMatched: [...result.multiMatched.entries()].map(
          ([externalId, ossKeys]) => ({ externalId, ossKeys }),
        ),
        unclaimed: result.unclaimed,
        totalPrompts: externalIds.length,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: `OSS 扫描失败: ${msg}` };
  }
}

/**
 * Create a Dataset from a (promptSuite × model × video OSS prefix) tuple.
 *
 * For I2V, callers must also pass `imageSet` — either an existing imageSetId
 * or a fresh OSS prefix that will be scanned + materialized. When materializing,
 * the matched images become Image rows in a new ImageSet.
 *
 * Refuses to proceed if any multi-match conflicts remain unresolved — admin
 * must clean up the OSS directory or narrow the prefix first (per spec: the
 * scan preview already surfaces conflict filenames to guide the fix).
 *
 * Returns the created Dataset id. Legacy VideoAssets (same modelId × promptId)
 * are reattached to the new dataset rather than duplicated.
 */
export interface NewModelSpec {
  name: string;
  provider?: string | null;
  description?: string | null;
}

export async function createDataset(params: {
  name: string;
  taskType: TaskType;
  // Exactly one of modelId / newModel must be supplied. newModel creates the
  // Model inline so admin can register a never-before-seen model (e.g. Vidu Q3)
  // without leaving the dataset wizard — the common case on the video team.
  modelId?: string;
  newModel?: NewModelSpec;
  promptSuiteId: string;
  videoOssPrefix: string;
  imageSetId?: string | null;
  imageOssPrefix?: string | null; // for materializing a new ImageSet
  imageSetName?: string | null;
  deadline?: string | null; // ISO, used for URL expiry
  // Phase D — optional generation-parameter metadata. All nullable; admin
  // sees these on the dataset card and the task-creation wizard.
  frames?: number | null;
  resolution?: string | null;
  duration?: number | null;
  aspect?: string | null;
}): Promise<
  | {
      status: "ok";
      datasetId: string;
      videoCount: number;
      imageCount: number;
      reusedVideoCount: number;
      imageSetId: string | null;
    }
  | {
      status: "error";
      message: string;
      multiMatched?: { externalId: string; ossKeys: string[] }[];
      unmatched?: string[];
    }
> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };

  const {
    name,
    taskType,
    modelId,
    newModel,
    promptSuiteId,
    videoOssPrefix,
    imageSetId,
    imageOssPrefix,
    imageSetName,
    deadline,
    frames,
    resolution,
    duration,
    aspect,
  } = params;

  if (!name.trim()) return { status: "error", message: "数据集名称不能为空" };
  if (!videoOssPrefix.trim())
    return { status: "error", message: "视频 OSS 路径不能为空" };

  // Exactly one of modelId / newModel must be supplied.
  if (!modelId && !newModel) {
    return { status: "error", message: "必须选择现有 Model 或填写新 Model 信息" };
  }
  if (modelId && newModel) {
    return { status: "error", message: "不能同时指定 modelId 和新 Model，只选其一" };
  }
  if (newModel) {
    if (!newModel.name?.trim()) {
      return { status: "error", message: "新 Model 名称不能为空" };
    }
    // provider is now optional — empty/null is allowed; coerced below.
  }

  const nameExists = await prisma.dataset.findUnique({ where: { name } });
  if (nameExists) return { status: "error", message: `数据集名称已存在: ${name}` };

  const suite = await prisma.promptSuite.findUnique({
    where: { id: promptSuiteId },
    include: {
      entries: { select: { promptId: true, prompt: { select: { externalId: true } } } },
    },
  });
  if (!suite) return { status: "error", message: "PromptSuite 不存在" };
  if (suite.taskType !== taskType)
    return { status: "error", message: `PromptSuite 任务类型 (${suite.taskType}) 与选择 (${taskType}) 不一致` };

  // Resolve model: either look up existing or create inline.
  let resolvedModelId: string;
  if (modelId) {
    const model = await prisma.model.findUnique({ where: { id: modelId } });
    if (!model) return { status: "error", message: "Model 不存在" };
    if (model.taskType !== taskType)
      return { status: "error", message: `Model 任务类型 (${model.taskType}) 与选择 (${taskType}) 不一致` };
    resolvedModelId = model.id;
  } else {
    const spec = newModel!;
    // Unique-name collision check first so we can give a clear message instead
    // of a raw Prisma P2002.
    const dup = await prisma.model.findUnique({ where: { name: spec.name.trim() } });
    if (dup) {
      return {
        status: "error",
        message: `Model 名称已存在: ${spec.name}，请改用已有 Model 或换一个名字`,
      };
    }
    const created = await prisma.model.create({
      data: {
        name: spec.name.trim(),
        provider: spec.provider?.trim() || null,
        description: spec.description?.trim() || null,
        taskType,
      },
    });
    resolvedModelId = created.id;
  }

  // Build externalId → promptId map.
  const extIdToPromptId = new Map<string, string>();
  for (const e of suite.entries) extIdToPromptId.set(e.prompt.externalId, e.promptId);

  // ─── Scan videos ──────────────────────────────────────
  const videoScan = await scanOssForMatches(
    videoOssPrefix,
    [...extIdToPromptId.keys()],
  );
  if (videoScan.multiMatched.size > 0) {
    return {
      status: "error",
      message: "视频 OSS 目录中存在多个文件匹配同一 prompt，请清理后重试。",
      multiMatched: [...videoScan.multiMatched.entries()].map(([externalId, ossKeys]) => ({
        externalId,
        ossKeys,
      })),
      unmatched: videoScan.unmatched,
    };
  }
  if (videoScan.matched.size === 0) {
    return { status: "error", message: "未匹配到任何视频文件，请检查 OSS 路径。" };
  }

  // ─── Scan images for I2V (if provided) ────────────────
  let resolvedImageSetId: string | null = imageSetId ?? null;
  let imageCount = 0;
  let createdImageSet: { id: string; matches: Map<string, string> } | null = null;

  if (taskType === "I2V" && imageOssPrefix && imageOssPrefix.trim()) {
    if (!imageSetName || !imageSetName.trim()) {
      return { status: "error", message: "I2V 需提供 ImageSet 名称" };
    }
    const imageSetNameExists = await prisma.imageSet.findUnique({
      where: { name: imageSetName },
    });
    if (imageSetNameExists) {
      return { status: "error", message: `ImageSet 名称已存在: ${imageSetName}` };
    }

    const imageScan = await scanOssForMatches(
      imageOssPrefix,
      [...extIdToPromptId.keys()],
    );
    if (imageScan.multiMatched.size > 0) {
      return {
        status: "error",
        message: "图片 OSS 目录中存在多个文件匹配同一 prompt，请清理后重试。",
        multiMatched: [...imageScan.multiMatched.entries()].map(([externalId, ossKeys]) => ({
          externalId,
          ossKeys,
        })),
      };
    }
    if (imageScan.matched.size === 0) {
      return { status: "error", message: "未匹配到任何图片文件，请检查 OSS 路径。" };
    }

    const imageSet = await prisma.imageSet.create({
      data: {
        name: imageSetName,
        imageOssPrefix: imageOssPrefix.trim(),
        imageCount: imageScan.matched.size,
        promptSuiteId,
      },
    });
    resolvedImageSetId = imageSet.id;
    createdImageSet = { id: imageSet.id, matches: imageScan.matched };
  }

  // ─── Create Dataset ───────────────────────────────────
  const dataset = await prisma.dataset.create({
    data: {
      name,
      taskType,
      videoOssPrefix: videoOssPrefix.trim(),
      videoCount: videoScan.matched.size,
      modelId: resolvedModelId,
      promptSuiteId,
      imageSetId: resolvedImageSetId,
      frames: frames ?? null,
      resolution: resolution?.trim() || null,
      duration: duration ?? null,
      aspect: aspect?.trim() || null,
    },
  });

  // ─── Materialize VideoAssets (upsert; reattach legacy rows) ──
  const deadlineDate = deadline ? new Date(deadline) : null;
  const vasToSign: { id: string; ossKey: string }[] = [];
  let reusedVideoCount = 0;

  for (const [externalId, ossKey] of videoScan.matched.entries()) {
    const promptId = extIdToPromptId.get(externalId)!;
    const bucket = process.env.OSS_BUCKET_NAME ?? "evalforge-demo-bucket";
    const region = process.env.OSS_REGION ?? "oss-ap-southeast-1.aliyuncs.com";
    const url = `https://${bucket}.${region}/${ossKey}`;

    // Unique constraint on (modelId, promptId) means we use upsert so a
    // pre-existing legacy VideoAsset gets reattached to this Dataset
    // rather than causing a collision.
    const existing = await prisma.videoAsset.findUnique({
      where: { modelId_promptId: { modelId: resolvedModelId, promptId } },
    });
    if (existing) {
      await prisma.videoAsset.update({
        where: { id: existing.id },
        data: { ossKey, url, datasetId: dataset.id },
      });
      vasToSign.push({ id: existing.id, ossKey });
      reusedVideoCount++;
    } else {
      const created = await prisma.videoAsset.create({
        data: {
          url,
          ossKey,
          modelId: resolvedModelId,
          promptId,
          datasetId: dataset.id,
        },
      });
      vasToSign.push({ id: created.id, ossKey });
    }
  }

  // ─── Materialize Images (I2V new imageset) ────────────
  const imagesToSign: { id: string; ossKey: string }[] = [];
  if (createdImageSet) {
    for (const [externalId, ossKey] of createdImageSet.matches.entries()) {
      const promptId = extIdToPromptId.get(externalId)!;
      const created = await prisma.image.create({
        data: {
          ossKey,
          imageSetId: createdImageSet.id,
          promptId,
        },
      });
      imagesToSign.push({ id: created.id, ossKey });
    }
    imageCount = imagesToSign.length;
  }

  // ─── Sign all URLs bound to the supplied deadline ─────
  if (vasToSign.length > 0 || imagesToSign.length > 0) {
    try {
      await signDatasetAssets({
        videoAssets: vasToSign,
        images: imagesToSign,
        deadline: deadlineDate,
      });
    } catch (e) {
      console.error("[createDataset] signing failed:", e);
      // Dataset is still created; admin can retry by extending deadline.
    }
  }

  return {
    status: "ok",
    datasetId: dataset.id,
    videoCount: videoScan.matched.size,
    imageCount,
    reusedVideoCount,
    imageSetId: resolvedImageSetId,
  };
}

/**
 * Edit an existing Model's display fields. Name is unique so a rename collides
 * cleanly via a Prisma P2002 — surfaced as a friendly message. taskType is
 * intentionally NOT editable: every downstream Dataset/VideoAsset depends on
 * it and a flip would silently corrupt videoAsset.@@unique(modelId, promptId).
 */
export async function updateModel(params: {
  modelId: string;
  name?: string;
  provider?: string | null;
  description?: string | null;
}): Promise<
  | { status: "ok" }
  | { status: "error"; message: string }
> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };

  const { modelId, name, provider, description } = params;
  if (!modelId) return { status: "error", message: "modelId 缺失" };

  const existing = await prisma.model.findUnique({ where: { id: modelId } });
  if (!existing) return { status: "error", message: "Model 不存在" };

  const data: {
    name?: string;
    provider?: string | null;
    description?: string | null;
  } = {};
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) return { status: "error", message: "Model 名称不能为空" };
    data.name = trimmed;
  }
  if (provider !== undefined) {
    const trimmed = provider?.trim();
    data.provider = trimmed ? trimmed : null;
  }
  if (description !== undefined) {
    const trimmed = description?.trim();
    data.description = trimmed ? trimmed : null;
  }

  if (Object.keys(data).length === 0) return { status: "ok" }; // nothing to do

  try {
    await prisma.model.update({ where: { id: modelId }, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) {
      return { status: "error", message: `Model 名称已被占用: ${data.name}` };
    }
    return { status: "error", message: `更新失败: ${msg}` };
  }
  return { status: "ok" };
}

export async function deleteDataset(datasetId: string): Promise<
  | { status: "ok" }
  | { status: "error"; message: string }
> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };

  const ds = await prisma.dataset.findUnique({
    where: { id: datasetId },
    include: {
      evaluationPackages: { select: { id: true } },
      _count: { select: { videoAssets: true } },
    },
  });
  if (!ds) return { status: "error", message: "数据集不存在" };
  if (ds.evaluationPackages.length > 0) {
    return {
      status: "error",
      message: `数据集已被 ${ds.evaluationPackages.length} 个任务使用，无法删除。`,
    };
  }

  await prisma.videoAsset.updateMany({
    where: { datasetId },
    data: { datasetId: null },
  });
  await prisma.dataset.delete({ where: { id: datasetId } });
  return { status: "ok" };
}

/**
 * Delete a PromptSuite. Refuses if the suite is referenced by any
 * EvaluationPackage or Dataset (foreign keys would block the delete
 * anyway — we surface a friendly error instead of letting Prisma throw).
 *
 * Cascades to `prompt_suite_entries` via FK onDelete: Cascade.
 */
export async function deletePromptSuite(
  suiteId: string,
): Promise<{ status: "ok" } | { status: "error"; message: string }> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };

  const suite = await prisma.promptSuite.findUnique({
    where: { id: suiteId },
    select: {
      id: true,
      name: true,
      _count: {
        select: { evaluationPackages: true, datasets: true },
      },
    },
  });
  if (!suite) return { status: "error", message: "Prompt Suite 不存在" };

  if (suite._count.evaluationPackages > 0) {
    return {
      status: "error",
      message: `该 Prompt Suite 被 ${suite._count.evaluationPackages} 个评测任务引用，无法删除`,
    };
  }
  if (suite._count.datasets > 0) {
    return {
      status: "error",
      message: `该 Prompt Suite 被 ${suite._count.datasets} 个数据集引用，请先删除对应数据集`,
    };
  }

  await prisma.promptSuite.delete({ where: { id: suiteId } });
  return { status: "ok" };
}
