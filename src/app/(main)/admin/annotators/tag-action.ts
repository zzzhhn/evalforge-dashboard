"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import {
  runTagSuggestionForAll,
  type SuggestionRunResult,
} from "@/lib/tag-suggestion";
import { getAdminScope, canManageUser } from "@/lib/admin-scope";

type ActionResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

const TAG_NAME_MAX = 48;

async function requireAdminOrResearcher(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "RESEARCHER")) {
    return { ok: false, message: "Unauthorized" };
  }
  return { ok: true, userId: session.userId };
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { ok: false, message: "Unauthorized" };
  }
  return { ok: true, userId: session.userId };
}

// Per-user tag ops: SYSTEM always passes; GROUP passes iff the target
// annotator is a member of one of their groups. Read-only search stays
// role-gated (both scopes allowed).
async function requireUserTagScope(
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") return { ok: false, message: "Unauthorized" };
  if (await canManageUser(scope, targetUserId)) return { ok: true };
  return { ok: false, message: "Forbidden: user outside your scope" };
}

function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function createTag(
  name: string,
  nameEn?: string | null
): Promise<ActionResult<{ id: string; name: string; nameEn: string | null }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const cleanName = normalize(name);
  if (!cleanName) return { status: "error", message: "Tag name is required" };
  if (cleanName.length > TAG_NAME_MAX) {
    return { status: "error", message: `Tag name must be <= ${TAG_NAME_MAX} chars` };
  }
  const cleanEn = nameEn ? normalize(nameEn).slice(0, TAG_NAME_MAX) : null;

  try {
    const tag = await prisma.annotatorTag.create({
      data: { name: cleanName, nameEn: cleanEn },
      select: { id: true, name: true, nameEn: true },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: tag };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "error", message: `Tag "${cleanName}" already exists` };
    }
    throw err;
  }
}

export async function deleteTag(tagId: string): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    // Transaction: cascade-delete UserTag rows first (FK constraint), then tag.
    await prisma.$transaction([
      prisma.userTag.deleteMany({ where: { tagId } }),
      prisma.annotatorTag.delete({ where: { id: tagId } }),
    ]);
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { id: tagId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Tag not found" };
    }
    throw err;
  }
}

export async function assignTag(
  userId: string,
  tagId: string
): Promise<ActionResult<{ userId: string; tagId: string; source: "MANUAL" }>> {
  const auth = await requireUserTagScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    const mapping = await prisma.userTag.upsert({
      where: { userId_tagId: { userId, tagId } },
      update: { source: "MANUAL", confidence: null },
      create: { userId, tagId, source: "MANUAL" },
      select: { userId: true, tagId: true, source: true },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: mapping as { userId: string; tagId: string; source: "MANUAL" } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return { status: "error", message: "User or tag not found" };
    }
    throw err;
  }
}

export async function removeTag(
  userId: string,
  tagId: string
): Promise<ActionResult<{ userId: string; tagId: string }>> {
  const auth = await requireUserTagScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    await prisma.userTag.delete({
      where: { userId_tagId: { userId, tagId } },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { userId, tagId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Tag assignment not found" };
    }
    throw err;
  }
}

export async function confirmSuggestedTag(
  userId: string,
  tagId: string
): Promise<ActionResult<{ userId: string; tagId: string }>> {
  const auth = await requireUserTagScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    await prisma.userTag.update({
      where: { userId_tagId: { userId, tagId } },
      data: { source: "MANUAL", confidence: null },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { userId, tagId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Tag suggestion not found" };
    }
    throw err;
  }
}

export async function searchTags(
  query: string,
  limit: number = 20
): Promise<ActionResult<Array<{ id: string; name: string; nameEn: string | null }>>> {
  const auth = await requireAdminOrResearcher();
  if (!auth.ok) return { status: "error", message: auth.message };

  const q = query.trim();
  const tags = await prisma.annotatorTag.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: { name: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, name: true, nameEn: true },
  });
  return { status: "ok", data: tags };
}

/**
 * Phase 6: dismiss an AUTO_SUGGESTED tag. Removes the UserTag row so the
 * admin's "rejection" persists — next suggestion run won't resurface it
 * unless volume/variance conditions hold and confidence re-crosses the
 * threshold (that's intentional; admin rejections reset, not blacklist).
 *
 * Only removes AUTO_SUGGESTED rows — never touches MANUAL.
 */
export async function dismissSuggestedTag(
  userId: string,
  tagId: string,
): Promise<ActionResult<{ userId: string; tagId: string }>> {
  const auth = await requireUserTagScope(userId);
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    const existing = await prisma.userTag.findUnique({
      where: { userId_tagId: { userId, tagId } },
      select: { source: true },
    });
    if (!existing) {
      return { status: "error", message: "Tag assignment not found" };
    }
    if (existing.source !== "AUTO_SUGGESTED") {
      return {
        status: "error",
        message: "Only AUTO_SUGGESTED tags can be dismissed; use removeTag for MANUAL",
      };
    }
    await prisma.userTag.delete({
      where: { userId_tagId: { userId, tagId } },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { userId, tagId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Tag assignment not found" };
    }
    throw err;
  }
}

/**
 * Phase 6: run the tag auto-suggestion algorithm across all annotators.
 * Idempotent — upserts AUTO_SUGGESTED UserTag rows. MANUAL rows are never
 * overwritten; see src/lib/tag-suggestion.ts for the full algorithm.
 */
export async function runTagSuggestions(): Promise<ActionResult<SuggestionRunResult>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    const result = await runTagSuggestionForAll();
    revalidatePath("/admin/annotators");
    return { status: "ok", data: result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { status: "error", message: `Tag suggestion failed: ${msg}` };
  }
}
