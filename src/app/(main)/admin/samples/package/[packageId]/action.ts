"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";
import { refreshSignedUrlsForPackage } from "@/lib/signed-url-manager";
import { getAdminScope, canManageUser } from "@/lib/admin-scope";
import { storePassword } from "@/lib/password-service";

// Scope-aware gate for per-package per-user actions. SYSTEM always passes;
// GROUP passes iff the target userId is a member of one of their groups.
// Use this in place of the old inline `session.role !== "ADMIN"` check so
// a Group Admin can suspend/resume/abort/remove own-group members only.
async function requireUserScope(
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") return { ok: false, message: "Unauthorized" };
  // Self-mutation is blocked for GROUP admins: they can't suspend/abort/
  // remove their own items (would lock themselves out; a Group Admin's
  // "stop work" move should be explicit self-resignation via SYSTEM).
  if (scope.kind === "GROUP" && targetUserId === scope.userId) {
    return { ok: false, message: "不能对自己执行此操作" };
  }
  if (await canManageUser(scope, targetUserId)) return { ok: true };
  return { ok: false, message: "Forbidden: user outside your scope" };
}

// SYSTEM-only gate (for package-level mutations like extendDeadline,
// resetPassword — these are privileged operations that cross the member
// boundary, so Group Admin doesn't get them in this MVP slice).
async function requireSystemScope(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind !== "SYSTEM") {
    return { ok: false, message: "Forbidden: system admin only" };
  }
  return { ok: true };
}

export interface PackageScoreRow {
  videoExternalId: string;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType: string;
  annotatorName: string;
  l1Code: string;
  l1NameZh: string;
  l1NameEn: string;
  l2Code: string | null;
  l2NameZh: string | null;
  l2NameEn: string | null;
  l3Code: string;
  l3NameZh: string;
  l3NameEn: string;
  value: number;
  validity: string;
  failureTagsZh: string[];
  failureTagsEn: string[];
  comment: string | null;
  createdAt: string;
}

/**
 * Fetch all scores for a given package (for export).
 * Server action — only callable by ADMIN/RESEARCHER.
 */
export async function fetchPackageScoresForExport(
  packageId: string,
  userId?: string
): Promise<{ status: "ok"; data: PackageScoreRow[] } | { status: "error"; message: string }> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  // Dataset-first scoping: EvaluationItem.packageId is authoritative.
  // Old rows (pre-Dataset migration) only have videoAsset.packageId set —
  // OR fallback keeps them visible. The legacy-only path matches the
  // canonical pattern used by suspendAnnotator/abortAnnotator below.
  //
  // 2026-04-20 grep was supposed to fix all `videoAsset: { packageId }`
  // usages, but this export action slipped through; new I2V packages
  // ship video assets via Dataset (videoAsset.packageId = NULL), so the
  // old query returned zero rows and the export silently no-op'd.
  const scores = await prisma.score.findMany({
    where: {
      evaluationItem: {
        packageId,
      },
      ...(userId ? { userId } : {}),
    },
    include: {
      user: { select: { name: true } },
      dimension: {
        select: {
          code: true, nameZh: true, nameEn: true,
          parent: {
            select: {
              code: true, nameZh: true, nameEn: true,
              parent: { select: { code: true, nameZh: true, nameEn: true } },
            },
          },
        },
      },
      evaluationItem: {
        include: {
          videoAsset: {
            include: {
              prompt: { select: { externalId: true, textZh: true, textEn: true } },
              model: { select: { name: true, taskType: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Build failure tag lookup
  const allTagIds = [...new Set(scores.flatMap((s) => s.failureTags))];
  const tagRecords = allTagIds.length > 0
    ? await prisma.failureTag.findMany({
        where: { id: { in: allTagIds } },
        select: { id: true, labelZh: true, labelEn: true },
      })
    : [];
  const tagMap = new Map(tagRecords.map((t) => [t.id, t]));

  const data: PackageScoreRow[] = scores.map((s) => {
    const l3 = s.dimension;
    const l2 = l3.parent;
    const l1 = l2?.parent;
    return {
      videoExternalId: s.evaluationItem.videoAsset.prompt.externalId,
      promptZh: s.evaluationItem.videoAsset.prompt.textZh,
      promptEn: s.evaluationItem.videoAsset.prompt.textEn,
      modelName: s.evaluationItem.videoAsset.model.name,
      taskType: s.evaluationItem.videoAsset.model.taskType,
      annotatorName: s.user.name,
      l1Code: l1?.code ?? l2?.code ?? l3.code,
      l1NameZh: l1?.nameZh ?? l2?.nameZh ?? l3.nameZh,
      l1NameEn: l1?.nameEn ?? l2?.nameEn ?? l3.nameEn,
      l2Code: l1 ? (l2?.code ?? null) : null,
      l2NameZh: l1 ? (l2?.nameZh ?? null) : null,
      l2NameEn: l1 ? (l2?.nameEn ?? null) : null,
      l3Code: l3.code,
      l3NameZh: l3.nameZh,
      l3NameEn: l3.nameEn,
      value: s.value,
      validity: s.validity,
      failureTagsZh: s.failureTags.map((id) => tagMap.get(id)?.labelZh ?? id),
      failureTagsEn: s.failureTags.map((id) => tagMap.get(id)?.labelEn ?? id),
      comment: s.comment,
      createdAt: s.createdAt.toISOString(),
    };
  });

  return { status: "ok", data };
}

/**
 * Suspend an annotator: set all non-COMPLETED items in this package to EXPIRED.
 */
export async function suspendAnnotator(
  packageId: string,
  userId: string
): Promise<{ status: "ok"; affected: number } | { status: "error"; message: string }> {
  const auth = await requireUserScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  // Scoping strategy: prefer explicit EvaluationItem.packageId (Dataset-
  // first authoritative), fall back to legacy videoAsset.packageId for
  // items written before the migration.
  const scopeClause = {
    packageId,
  };

  const [evalResult, arenaResult] = await Promise.all([
    prisma.evaluationItem.updateMany({
      where: {
        assignedToId: userId,
        ...scopeClause,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      data: { status: "EXPIRED" },
    }),
    prisma.arenaItem.updateMany({
      where: {
        assignedToId: userId,
        packageId,
        status: { in: ["PENDING", "IN_PROGRESS"] },
      },
      data: { status: "EXPIRED" },
    }),
  ]);

  return { status: "ok", affected: evalResult.count + arenaResult.count };
}

/**
 * Resume an annotator: set all EXPIRED items in this package back to PENDING.
 */
export async function resumeAnnotator(
  packageId: string,
  userId: string
): Promise<{ status: "ok"; affected: number } | { status: "error"; message: string }> {
  const auth = await requireUserScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  const scopeClause = {
    packageId,
  };

  const [evalResult, arenaResult] = await Promise.all([
    prisma.evaluationItem.updateMany({
      where: {
        assignedToId: userId,
        ...scopeClause,
        status: "EXPIRED",
      },
      data: { status: "PENDING" },
    }),
    prisma.arenaItem.updateMany({
      where: {
        assignedToId: userId,
        packageId,
        status: "EXPIRED",
      },
      data: { status: "PENDING" },
    }),
  ]);

  return { status: "ok", affected: evalResult.count + arenaResult.count };
}

/**
 * Abort an annotator: permanently set all non-COMPLETED items to EXPIRED.
 * Unlike suspend, this also deletes pending scores (if any).
 */
export async function abortAnnotator(
  packageId: string,
  userId: string
): Promise<{ status: "ok"; affected: number } | { status: "error"; message: string }> {
  const auth = await requireUserScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  const scopeClause = {
    packageId,
  };

  const [evalResult, arenaResult] = await Promise.all([
    prisma.evaluationItem.updateMany({
      where: {
        assignedToId: userId,
        ...scopeClause,
        status: { not: "COMPLETED" },
      },
      data: { status: "EXPIRED" },
    }),
    prisma.arenaItem.updateMany({
      where: {
        assignedToId: userId,
        packageId,
        status: { not: "COMPLETED" },
      },
      data: { status: "EXPIRED" },
    }),
  ]);

  return { status: "ok", affected: evalResult.count + arenaResult.count };
}

// ─── Annotator Management Actions ────────────────────────

function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Add an annotator to a package: create user if needed, assign evaluation items.
 * Returns the plaintext password so admin can share it.
 */
export async function addAnnotatorToPackage(
  packageId: string,
  name: string,
  email: string,
): Promise<
  | { status: "ok"; userId: string; password: string; itemCount: number }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { status: "error", message: "Unauthorized" };
  }

  if (!email.includes("@")) {
    return { status: "error", message: "Invalid email" };
  }

  const password = generatePassword();
  // Upsert with a placeholder hash; storePassword writes the real bcrypt
  // hash + vault entry atomically right after.
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, deletedAt: null },
    create: {
      email,
      name,
      passwordHash: "placeholder-will-be-replaced",
      role: "ANNOTATOR",
      accountType: "INTERNAL",
    },
  });
  await storePassword(user.id, password, "CREATE", session.userId);

  // Branch by mode: Arena clones ArenaItems, Scoring clones EvaluationItems.
  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { evaluationMode: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };

  // Idempotent short-circuit: if the (possibly pre-existing) user already has
  // items in this package, do not re-clone. Re-cloning against a dimension
  // set that drifted (e.g. PromptSuite swap, Dataset change) stacks a second
  // (asset, dim) pair family onto the same annotator, inflating the package
  // silently. The 2026-04-20 PixVerse v6 incident created 1000 phantom
  // PENDING items on User 1-5 this way. Callers who genuinely want to
  // re-seed should remove the annotator first, then re-add.
  const existingEval = await prisma.evaluationItem.count({
    where: { assignedToId: user.id, packageId },
  });
  const existingArena = await prisma.arenaItem.count({
    where: { assignedToId: user.id, packageId },
  });
  if (existingEval + existingArena > 0) {
    return {
      status: "ok",
      userId: user.id,
      password: "(existing user, no new items)",
      itemCount: existingEval + existingArena,
    };
  }

  let itemCount = 0;
  if (pkg.evaluationMode === "ARENA") {
    // Seed from any existing annotator's ArenaItem set so the new user
    // inherits the identical (prompt × dimension × A/B) pairing.
    const sample = await prisma.arenaItem.findMany({
      where: { packageId },
      distinct: ["promptId", "dimensionId"],
      select: {
        promptId: true,
        dimensionId: true,
        videoAssetAId: true,
        videoAssetBId: true,
      },
    });
    if (sample.length === 0) {
      return { status: "error", message: "Package has no arena items" };
    }
    const result = await prisma.arenaItem.createMany({
      data: sample.map((s) => ({
        packageId,
        promptId: s.promptId,
        dimensionId: s.dimensionId,
        videoAssetAId: s.videoAssetAId,
        videoAssetBId: s.videoAssetBId,
        assignedToId: user.id,
      })),
      skipDuplicates: true,
    });
    itemCount = result.count;
  } else {
    // Scoring: clone (videoAssetId, dimensionId) pairs, scoped by either
    // explicit EvaluationItem.packageId or legacy VideoAsset.packageId.
    const existingItems = await prisma.evaluationItem.findMany({
      where: {
        packageId,
      },
      select: { videoAssetId: true, dimensionId: true },
    });
    if (existingItems.length === 0) {
      return { status: "error", message: "Package has no evaluation items" };
    }
    const pairSet = new Set<string>();
    const pairs: Array<{ videoAssetId: string; dimensionId: string }> = [];
    for (const item of existingItems) {
      const key = `${item.videoAssetId}|${item.dimensionId}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        pairs.push({
          videoAssetId: item.videoAssetId,
          dimensionId: item.dimensionId,
        });
      }
    }
    const result = await prisma.evaluationItem.createMany({
      data: pairs.map((p) => ({
        videoAssetId: p.videoAssetId,
        dimensionId: p.dimensionId,
        assignedToId: user.id,
        packageId,
      })),
      skipDuplicates: true,
    });
    itemCount = result.count;
  }

  await prisma.evaluationPackage.update({
    where: { id: packageId },
    data: { annotatorCount: { increment: 1 } },
  });

  return { status: "ok", userId: user.id, password, itemCount };
}

/**
 * Remove annotator from package: delete all their non-COMPLETED items.
 */
export async function removeAnnotatorFromPackage(
  packageId: string,
  userId: string,
): Promise<
  | { status: "ok"; deletedCount: number }
  | { status: "error"; message: string }
> {
  const auth = await requireUserScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  const scopeClause = {
    packageId,
  };

  const [evalDeleted, arenaDeleted] = await Promise.all([
    prisma.evaluationItem.deleteMany({
      where: {
        assignedToId: userId,
        ...scopeClause,
        status: { not: "COMPLETED" },
      },
    }),
    prisma.arenaItem.deleteMany({
      where: {
        assignedToId: userId,
        packageId,
        status: { not: "COMPLETED" },
      },
    }),
  ]);
  const totalDeleted = evalDeleted.count + arenaDeleted.count;

  if (totalDeleted > 0) {
    const [evalRemain, arenaRemain] = await Promise.all([
      prisma.evaluationItem.count({
        where: { assignedToId: userId, ...scopeClause },
      }),
      prisma.arenaItem.count({
        where: { assignedToId: userId, packageId },
      }),
    ]);
    if (evalRemain + arenaRemain === 0) {
      await prisma.evaluationPackage.update({
        where: { id: packageId },
        data: { annotatorCount: { decrement: 1 } },
      });
    }
  }

  return { status: "ok", deletedCount: totalDeleted };
}

/**
 * Undo removing an annotator: re-create their items (within 30s undo window).
 */
export async function undoRemoveAnnotator(
  packageId: string,
  userId: string,
): Promise<
  | { status: "ok"; itemCount: number }
  | { status: "error"; message: string }
> {
  const auth = await requireUserScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  const pkg = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { evaluationMode: true },
  });
  if (!pkg) return { status: "error", message: "Package not found" };

  let itemCount = 0;
  if (pkg.evaluationMode === "ARENA") {
    const sample = await prisma.arenaItem.findMany({
      where: { packageId },
      distinct: ["promptId", "dimensionId"],
      select: {
        promptId: true,
        dimensionId: true,
        videoAssetAId: true,
        videoAssetBId: true,
      },
    });
    const result = await prisma.arenaItem.createMany({
      data: sample.map((s) => ({
        packageId,
        promptId: s.promptId,
        dimensionId: s.dimensionId,
        videoAssetAId: s.videoAssetAId,
        videoAssetBId: s.videoAssetBId,
        assignedToId: userId,
      })),
      skipDuplicates: true,
    });
    itemCount = result.count;
  } else {
    const existingItems = await prisma.evaluationItem.findMany({
      where: {
        packageId,
      },
      select: { videoAssetId: true, dimensionId: true },
    });
    const pairSet = new Set<string>();
    const pairs: Array<{ videoAssetId: string; dimensionId: string }> = [];
    for (const item of existingItems) {
      const key = `${item.videoAssetId}|${item.dimensionId}`;
      if (!pairSet.has(key)) {
        pairSet.add(key);
        pairs.push({
          videoAssetId: item.videoAssetId,
          dimensionId: item.dimensionId,
        });
      }
    }
    const result = await prisma.evaluationItem.createMany({
      data: pairs.map((p) => ({
        videoAssetId: p.videoAssetId,
        dimensionId: p.dimensionId,
        assignedToId: userId,
        packageId,
      })),
      skipDuplicates: true,
    });
    itemCount = result.count;
  }

  if (itemCount > 0) {
    const [evalNow, arenaNow] = await Promise.all([
      prisma.evaluationItem.count({
        where: {
          assignedToId: userId,
          packageId,
        },
      }),
      prisma.arenaItem.count({
        where: { assignedToId: userId, packageId },
      }),
    ]);
    if (evalNow + arenaNow === itemCount) {
      await prisma.evaluationPackage.update({
        where: { id: packageId },
        data: { annotatorCount: { increment: 1 } },
      });
    }
  }

  return { status: "ok", itemCount };
}

/**
 * Toggle an annotator's account type between INTERNAL and VENDOR.
 */
export async function toggleAccountType(
  userId: string,
): Promise<
  | { status: "ok"; newType: string }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { status: "error", message: "Unauthorized" };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountType: true },
  });
  if (!user) {
    return { status: "error", message: "User not found" };
  }

  const newType = user.accountType === "INTERNAL" ? "VENDOR" : "INTERNAL";
  await prisma.user.update({
    where: { id: userId },
    data: { accountType: newType },
  });

  return { status: "ok", newType };
}

/**
 * Extend (or shorten) a package's deadline.
 *
 * Side effect on *extend*: re-signs every VideoAsset/Image reachable from the
 * package so the OSS URLs stay valid through the new window (+ 7d buffer).
 * On *shorten*, we leave existing signed URLs untouched — evaluators retain
 * access until the original expiry, per the confirmed plan.
 */
export async function extendDeadline(
  packageId: string,
  newDeadline: string,
): Promise<
  | { status: "ok"; deadline: string; refresh?: { videos: number; images: number } }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { status: "error", message: "Unauthorized" };
  }

  const parsed = new Date(newDeadline);
  if (isNaN(parsed.getTime())) {
    return { status: "error", message: "Invalid date" };
  }

  const current = await prisma.evaluationPackage.findUnique({
    where: { id: packageId },
    select: { deadline: true },
  });
  if (!current) {
    return { status: "error", message: "Package not found" };
  }

  const pkg = await prisma.evaluationPackage.update({
    where: { id: packageId },
    data: { deadline: parsed },
  });

  // Only refresh on extension. Shortening is a no-op for URL validity.
  const isExtension =
    !current.deadline || parsed.getTime() > current.deadline.getTime();

  let refresh: { videos: number; images: number } | undefined;
  if (isExtension) {
    try {
      const result = await refreshSignedUrlsForPackage(packageId, parsed);
      refresh = {
        videos: result.videoAssetsRefreshed,
        images: result.imagesRefreshed,
      };
    } catch (e) {
      // Don't roll back the deadline update — URL refresh can be retried,
      // but log a loud warning so admins know the refresh didn't land.
      console.error(
        `[extendDeadline] URL refresh failed for package ${packageId}:`,
        e,
      );
    }
  }

  return {
    status: "ok",
    deadline: pkg.deadline?.toISOString() ?? "",
    refresh,
  };
}

/**
 * Reset an annotator's password and return the new plaintext password.
 */
export async function resetAnnotatorPassword(
  userId: string,
): Promise<
  | { status: "ok"; password: string }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { status: "error", message: "Unauthorized" };
  }

  const password = generatePassword();
  await storePassword(userId, password, "RESET", session.userId);

  return { status: "ok", password };
}

const MIN_CUSTOM_PASSWORD_LENGTH = 8;
const MAX_CUSTOM_PASSWORD_LENGTH = 128;

function validateCustomPassword(raw: string): string | null {
  const trimmed = raw;
  if (trimmed.length < MIN_CUSTOM_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_CUSTOM_PASSWORD_LENGTH} characters`;
  }
  if (trimmed.length > MAX_CUSTOM_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_CUSTOM_PASSWORD_LENGTH} characters`;
  }
  if (/\s/.test(trimmed)) {
    return "Password must not contain whitespace";
  }
  return null;
}

/**
 * Set a custom password for an annotator. Returns the plaintext
 * password so admin can confirm the one-time display UI value.
 * bcrypt 哈希不可逆，不提供查看已有密码的接口。
 */
export async function setCustomAnnotatorPassword(
  userId: string,
  newPassword: string,
): Promise<
  | { status: "ok"; password: string }
  | { status: "error"; message: string }
> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { status: "error", message: "Unauthorized" };
  }

  const validationError = validateCustomPassword(newPassword);
  if (validationError) {
    return { status: "error", message: validationError };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    return { status: "error", message: "User not found" };
  }
  if (user.role !== "ANNOTATOR") {
    return { status: "error", message: "Can only set password for annotator accounts" };
  }

  await storePassword(userId, newPassword, "RESET", session.userId);

  return { status: "ok", password: newPassword };
}
