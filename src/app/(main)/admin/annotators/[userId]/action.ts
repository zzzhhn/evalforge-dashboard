"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getAdminScope, canManageUser } from "@/lib/admin-scope";

export interface ExportScoreRow {
  id: string;
  value: number;
  validity: string;
  failureTagsZh: string[];
  failureTagsEn: string[];
  comment: string | null;
  createdAt: string;
  dimensionCode: string;
  dimensionNameZh: string;
  dimensionNameEn: string;
  // L1/L2/L3 hierarchy for split-column export
  l1Code: string;
  l1NameZh: string;
  l1NameEn: string;
  l2Code: string | null;
  l2NameZh: string | null;
  l2NameEn: string | null;
  l3Code: string;
  l3NameZh: string;
  l3NameEn: string;
  videoExternalId: string;
  promptZh: string;
  promptEn: string;
  modelName: string;
  taskType: string;
}

/**
 * Fetch all scores for a given user (for export).
 * Server action — only callable by ADMIN/RESEARCHER.
 */
export async function fetchAllScoresForExport(
  userId: string
): Promise<{ status: "ok"; data: ExportScoreRow[] } | { status: "error"; message: string }> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") return { status: "error", message: "Unauthorized" };
  if (!(await canManageUser(scope, userId))) {
    return { status: "error", message: "Forbidden: user outside your scope" };
  }

  const scores = await prisma.score.findMany({
    where: { userId },
    include: {
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

  const data: ExportScoreRow[] = scores.map((s) => {
    // 3-level hierarchy: L3 (dim) → L2 (parent) → L1 (grandparent)
    const l3 = s.dimension;
    const l2 = l3.parent;
    const l1 = l2?.parent;
    return {
      id: s.id,
      value: s.value,
      validity: s.validity,
      failureTagsZh: s.failureTags.map((id) => tagMap.get(id)?.labelZh ?? id),
      failureTagsEn: s.failureTags.map((id) => tagMap.get(id)?.labelEn ?? id),
      comment: s.comment,
      createdAt: s.createdAt.toISOString(),
      dimensionCode: l3.code,
      dimensionNameZh: l3.nameZh,
      dimensionNameEn: l3.nameEn,
      l1Code: l1?.code ?? l2?.code ?? l3.code,
      l1NameZh: l1?.nameZh ?? l2?.nameZh ?? l3.nameZh,
      l1NameEn: l1?.nameEn ?? l2?.nameEn ?? l3.nameEn,
      l2Code: l1 ? (l2?.code ?? null) : null,
      l2NameZh: l1 ? (l2?.nameZh ?? null) : null,
      l2NameEn: l1 ? (l2?.nameEn ?? null) : null,
      l3Code: l3.code,
      l3NameZh: l3.nameZh,
      l3NameEn: l3.nameEn,
      videoExternalId: s.evaluationItem.videoAsset.prompt.externalId,
      promptZh: s.evaluationItem.videoAsset.prompt.textZh,
      promptEn: s.evaluationItem.videoAsset.prompt.textEn,
      modelName: s.evaluationItem.videoAsset.model.name,
      taskType: s.evaluationItem.videoAsset.model.taskType,
    };
  });

  return { status: "ok", data };
}
