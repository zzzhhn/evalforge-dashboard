"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hash } from "bcryptjs";
import { storePassword } from "@/lib/password-service";
import { randomBytes } from "crypto";
import {
  parsePromptSuiteXlsx,
  commitPromptSuite,
  type ParseResult,
} from "@/lib/prompt-suite-parser";
import type {
  AccountType,
  EvaluationMode,
  EvaluationStatus,
  TaskType,
} from "@prisma/client";

function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export interface CreatePackagePayload {
  name: string;
  description: string | null;
  taskType: TaskType;
  evaluationMode: EvaluationMode;
  startAt: string | null;
  deadline: string | null;
  /**
   * Dataset-first composition: each selected Dataset brings its own
   * (model × PromptSuite × video corpus). All selected datasets must
   * share the same PromptSuite (otherwise their prompt sets diverge).
   * Arena mode requires exactly 2 datasets (each pair compares two models
   * on the same prompt).
   */
  datasetIds: string[];
  annotatorIds: string[];
}

export interface CreatePackageResult {
  status: "ok" | "error";
  message?: string;
  packageId?: string;
  itemsCreated?: number;
  warnings?: string[];
}

async function assertAdmin() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return null;
  }
  return session;
}

/**
 * Create a new annotator inline from the task-creation form.
 * Returns the plaintext password once — admin must copy it immediately.
 */
export async function createAnnotatorInline(params: {
  name: string;
  email: string;
  accountType?: AccountType;
}): Promise<
  | {
      status: "ok";
      user: {
        id: string;
        name: string;
        email: string;
        accountType: AccountType;
      };
      password: string;
    }
  | { status: "error"; message: string }
> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };
  const session = await getSession();
  const actorId = session!.userId;

  const name = params.name.trim();
  const email = params.email.trim().toLowerCase();
  if (!name) return { status: "error", message: "姓名不能为空" };
  if (!email.includes("@") || email.length < 5) {
    return { status: "error", message: "邮箱格式无效" };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { status: "error", message: `邮箱已被占用: ${email}` };
  }

  const password = generatePassword();
  const accountType = params.accountType ?? "INTERNAL";

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: "placeholder-will-be-replaced",
      accountType,
      role: accountType === "VENDOR" ? "VENDOR_ANNOTATOR" : "ANNOTATOR",
    },
  });
  await storePassword(user.id, password, "CREATE", actorId);

  return {
    status: "ok",
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      accountType: user.accountType,
    },
    password,
  };
}

export async function previewPromptSuiteXlsx(
  fileBase64: string,
  taskType?: TaskType,
): Promise<{ status: "ok"; preview: ParseResult } | { status: "error"; message: string }> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };
  try {
    const buf = Buffer.from(fileBase64, "base64");
    // Pass the UI-selected taskType down so parser picks the matching
    // sheet (workbooks often ship T2V_200 + I2V_200 side by side).
    const preview = await parsePromptSuiteXlsx(buf, { taskType });
    return { status: "ok", preview };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: `解析失败: ${msg}` };
  }
}

export async function createPromptSuiteFromXlsx(params: {
  name: string;
  description: string | null;
  taskType: TaskType;
  fileBase64: string;
}): Promise<
  | { status: "ok"; promptSuiteId: string; promptsCreated: number; promptsReused: number }
  | { status: "error"; message: string; errors?: ParseResult["errors"] }
> {
  if (!(await assertAdmin())) return { status: "error", message: "Unauthorized" };

  const existing = await prisma.promptSuite.findUnique({
    where: { name: params.name },
  });
  if (existing) {
    return { status: "error", message: `PromptSuite 名称已存在: ${params.name}` };
  }

  const buf = Buffer.from(params.fileBase64, "base64");
  // Same rationale as previewPromptSuiteXlsx: feed the UI-chosen taskType
  // so the parser picks the correct sheet in multi-sheet workbooks.
  const parsed = await parsePromptSuiteXlsx(buf, { taskType: params.taskType });
  if (parsed.errors.length > 0) {
    return {
      status: "error",
      message: `解析错误 ${parsed.errors.length} 条，首条: ${parsed.errors[0].message}`,
      errors: parsed.errors,
    };
  }
  if (parsed.rows.length === 0) {
    return { status: "error", message: "xlsx 中没有有效数据行" };
  }

  try {
    const result = await commitPromptSuite({
      name: params.name,
      description: params.description,
      taskType: params.taskType,
      rows: parsed.rows,
    });
    return {
      status: "ok",
      promptSuiteId: result.promptSuiteId,
      promptsCreated: result.promptsCreated,
      promptsReused: result.promptsReused,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: "error", message: `保存失败: ${msg}` };
  }
}

export async function createPackage(
  payload: CreatePackagePayload,
): Promise<CreatePackageResult> {
  const session = await assertAdmin();
  if (!session) return { status: "error", message: "Unauthorized" };

  if (!payload.name.trim()) return { status: "error", message: "任务名不能为空" };
  if (!payload.datasetIds || payload.datasetIds.length === 0)
    return { status: "error", message: "必须选择至少一个数据集" };
  if (payload.annotatorIds.length === 0)
    return { status: "error", message: "至少选择一名评测员" };
  if (payload.evaluationMode === "ARENA" && payload.datasetIds.length !== 2)
    return { status: "error", message: "Arena 模式必须选择正好 2 个数据集" };

  const nameExists = await prisma.evaluationPackage.findUnique({
    where: { name: payload.name },
  });
  if (nameExists) return { status: "error", message: `任务名已存在: ${payload.name}` };

  const datasets = await prisma.dataset.findMany({
    where: { id: { in: payload.datasetIds } },
    include: {
      videoAssets: {
        select: { id: true, modelId: true, promptId: true, packageId: true },
      },
    },
  });
  if (datasets.length !== payload.datasetIds.length) {
    return { status: "error", message: "部分数据集不存在或已被删除" };
  }

  // All selected datasets must agree on taskType and PromptSuite.
  const taskTypes = new Set(datasets.map((d) => d.taskType));
  if (taskTypes.size > 1) {
    return {
      status: "error",
      message: "所选数据集的任务类型不一致，请重新选择",
    };
  }
  if (!taskTypes.has(payload.taskType)) {
    return {
      status: "error",
      message: `数据集任务类型与选择 (${payload.taskType}) 不一致`,
    };
  }
  const suiteIds = new Set(datasets.map((d) => d.promptSuiteId));
  if (suiteIds.size > 1) {
    return {
      status: "error",
      message: "所选数据集使用了不同的 Prompt Suite，请统一后重新选择",
    };
  }
  const promptSuiteId = [...suiteIds][0];

  // Arena needs two distinct models so every prompt gets a genuine A vs B pair.
  if (payload.evaluationMode === "ARENA") {
    const modelIds = new Set(datasets.map((d) => d.modelId));
    if (modelIds.size !== 2) {
      return {
        status: "error",
        message: "Arena 模式需要 2 个不同模型的数据集",
      };
    }
  }

  const suite = await prisma.promptSuite.findUnique({
    where: { id: promptSuiteId },
    include: {
      entries: {
        include: { prompt: true, dimension: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!suite) return { status: "error", message: "PromptSuite 不存在" };
  if (suite.entries.length === 0)
    return { status: "error", message: "PromptSuite 为空" };

  const promptIds = suite.entries.map((e) => e.promptId);
  const promptIdSet = new Set(promptIds);

  // Flatten videoAssets from all datasets. A single prompt may have a
  // VideoAsset from each dataset's model — that's expected and drives
  // both SCORING (multi-model on same prompt) and ARENA (A vs B).
  const warnings: string[] = [];
  const vaByModelPrompt = new Map<string, string>(); // "modelId|promptId" → vaId
  const vaIdsReachable = new Set<string>();
  for (const ds of datasets) {
    const reachable = ds.videoAssets.filter((va) =>
      promptIdSet.has(va.promptId),
    );
    for (const va of reachable) {
      vaByModelPrompt.set(`${va.modelId}|${va.promptId}`, va.id);
      vaIdsReachable.add(va.id);
    }
    const missing = promptIds.filter(
      (pid) => !reachable.some((va) => va.promptId === pid),
    );
    if (missing.length > 0) {
      warnings.push(
        `数据集 ${ds.name}: 缺少 ${missing.length} / ${promptIds.length} 个 prompt 的视频素材`,
      );
    }
  }

  if (vaIdsReachable.size === 0) {
    return {
      status: "error",
      message: "所选数据集中未找到任何可用视频素材。",
    };
  }

  const pkg = await prisma.evaluationPackage.create({
    data: {
      name: payload.name,
      description: payload.description,
      taskType: payload.taskType,
      evaluationMode: payload.evaluationMode,
      status: "DRAFT",
      startAt: payload.startAt ? new Date(payload.startAt) : null,
      deadline: payload.deadline ? new Date(payload.deadline) : null,
      promptSuiteId,
      videoCount: vaIdsReachable.size,
      annotatorCount: payload.annotatorIds.length,
      datasets: { connect: payload.datasetIds.map((id) => ({ id })) },
    },
  });

  // Attach VideoAssets whose legacy packageId is still null. Assets already
  // bound to another package stay put — Dataset provides the new, stable
  // reachability link, so legacy packageId can be left alone.
  const vaIdsToAttach = datasets
    .flatMap((d) => d.videoAssets)
    .filter((va) => !va.packageId && vaIdsReachable.has(va.id))
    .map((va) => va.id);
  if (vaIdsToAttach.length > 0) {
    await prisma.videoAsset.updateMany({
      where: { id: { in: vaIdsToAttach } },
      data: { packageId: pkg.id },
    });
  }

  let itemsCreated = 0;
  const pendingStatus: EvaluationStatus = "PENDING";

  const modelIdsSorted = [...new Set(datasets.map((d) => d.modelId))];

  if (payload.evaluationMode === "SCORING") {
    for (const annotatorId of payload.annotatorIds) {
      for (const entry of suite.entries) {
        for (const modelId of modelIdsSorted) {
          const vaId = vaByModelPrompt.get(`${modelId}|${entry.promptId}`);
          if (!vaId) continue;
          await prisma.evaluationItem.create({
            data: {
              status: pendingStatus,
              assignedToId: annotatorId,
              videoAssetId: vaId,
              dimensionId: entry.dimensionId,
              packageId: pkg.id,
            },
          });
          itemsCreated++;
        }
      }
    }
  } else {
    const [modelAId, modelBId] = modelIdsSorted;
    for (const annotatorId of payload.annotatorIds) {
      for (const entry of suite.entries) {
        const vaA = vaByModelPrompt.get(`${modelAId}|${entry.promptId}`);
        const vaB = vaByModelPrompt.get(`${modelBId}|${entry.promptId}`);
        if (!vaA || !vaB) continue;
        const randomize = Math.random() < 0.5;
        const [leftId, rightId] = randomize ? [vaA, vaB] : [vaB, vaA];
        await prisma.arenaItem.create({
          data: {
            status: pendingStatus,
            packageId: pkg.id,
            promptId: entry.promptId,
            dimensionId: entry.dimensionId,
            videoAssetAId: leftId,
            videoAssetBId: rightId,
            assignedToId: annotatorId,
          },
        });
        itemsCreated++;
      }
    }
  }

  return {
    status: "ok",
    packageId: pkg.id,
    itemsCreated,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
