"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getAdminScope } from "@/lib/admin-scope";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

type ActionResult<T = unknown> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

const GROUP_NAME_MAX = 64;
const GROUP_DESC_MAX = 256;
const GROUP_LOCATION_MAX = 64;
const GROUP_ORG_MAX = 128;
const QUOTA_MAX = 1_000_000; // safety cap; realistic monthly quotas are in the hundreds

// Optional metadata fields accepted by create/rename. `undefined` = field is
// absent from the patch (leave as-is on update). `null` = field is explicitly
// cleared. `string`/`number` = set to that value. Callers treat all three
// distinctly, so Prisma's partial-update semantics work end-to-end.
export interface GroupMetaPatch {
  location?: string | null;
  organization?: string | null;
  monthlyQuota?: number | null;
}

function sanitizeMeta(meta: GroupMetaPatch): {
  location?: string | null;
  organization?: string | null;
  monthlyQuota?: number | null;
} {
  const out: {
    location?: string | null;
    organization?: string | null;
    monthlyQuota?: number | null;
  } = {};
  if (meta.location !== undefined) {
    if (meta.location === null) out.location = null;
    else {
      const v = meta.location.trim().slice(0, GROUP_LOCATION_MAX);
      out.location = v.length > 0 ? v : null;
    }
  }
  if (meta.organization !== undefined) {
    if (meta.organization === null) out.organization = null;
    else {
      const v = meta.organization.trim().slice(0, GROUP_ORG_MAX);
      out.organization = v.length > 0 ? v : null;
    }
  }
  if (meta.monthlyQuota !== undefined) {
    if (meta.monthlyQuota === null) out.monthlyQuota = null;
    else if (
      Number.isFinite(meta.monthlyQuota) &&
      meta.monthlyQuota >= 0 &&
      meta.monthlyQuota <= QUOTA_MAX
    ) {
      out.monthlyQuota = Math.floor(meta.monthlyQuota);
    } else {
      // Out-of-range or NaN: drop silently rather than corrupting the row.
      // Caller's form validation should surface this before it reaches us.
    }
  }
  return out;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind !== "SYSTEM") {
    return { ok: false, message: "Forbidden: system admin only" };
  }
  return { ok: true, userId: scope.userId };
}

// SYSTEM or admin-of-this-group. Group-scoped mutations (rename own group,
// add/remove own group's members, swap admin within own group) flow through
// here. Creation and deletion stay SYSTEM-only via requireAdmin.
async function requireGroupAccess(
  groupId: string,
): Promise<
  { ok: true; userId: string } | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") {
    return { ok: false, message: "Unauthorized" };
  }
  if (scope.kind === "SYSTEM") return { ok: true, userId: scope.userId };
  if (!scope.groupIds.includes(groupId)) {
    return { ok: false, message: "Forbidden: not your group" };
  }
  return { ok: true, userId: scope.userId };
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export async function createGroup(
  name: string,
  description?: string | null
): Promise<ActionResult<{ id: string; name: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const cleanName = normalizeName(name);
  if (!cleanName) {
    return { status: "error", message: "Group name is required" };
  }
  if (cleanName.length > GROUP_NAME_MAX) {
    return { status: "error", message: `Group name must be <= ${GROUP_NAME_MAX} chars` };
  }
  const cleanDesc = description ? description.trim().slice(0, GROUP_DESC_MAX) : null;

  try {
    const group = await prisma.annotatorGroup.create({
      data: { name: cleanName, description: cleanDesc },
      select: { id: true, name: true },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: group };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "error", message: `Group name "${cleanName}" already exists` };
    }
    throw err;
  }
}

export async function renameGroup(
  groupId: string,
  newName: string,
  newDescription?: string | null,
  meta?: GroupMetaPatch
): Promise<ActionResult<{ id: string; name: string }>> {
  const auth = await requireGroupAccess(groupId);
  if (!auth.ok) return { status: "error", message: auth.message };

  const cleanName = normalizeName(newName);
  if (!cleanName) {
    return { status: "error", message: "Group name is required" };
  }
  if (cleanName.length > GROUP_NAME_MAX) {
    return { status: "error", message: `Group name must be <= ${GROUP_NAME_MAX} chars` };
  }
  const cleanDesc =
    newDescription === undefined
      ? undefined
      : newDescription === null
        ? null
        : newDescription.trim().slice(0, GROUP_DESC_MAX);

  const cleanMeta = meta ? sanitizeMeta(meta) : {};

  try {
    const group = await prisma.annotatorGroup.update({
      where: { id: groupId },
      data: {
        name: cleanName,
        ...(cleanDesc === undefined ? {} : { description: cleanDesc }),
        ...cleanMeta,
      },
      select: { id: true, name: true },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: group };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return { status: "error", message: `Group name "${cleanName}" already exists` };
      }
      if (err.code === "P2025") {
        return { status: "error", message: "Group not found" };
      }
    }
    throw err;
  }
}

export async function deleteGroup(
  groupId: string
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    await prisma.annotatorGroup.delete({ where: { id: groupId } });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { id: groupId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Group not found" };
    }
    throw err;
  }
}

export async function addMember(
  groupId: string,
  userId: string,
  isAdmin: boolean = false
): Promise<ActionResult<{ groupId: string; userId: string; isAdmin: boolean }>> {
  const auth = await requireGroupAccess(groupId);
  if (!auth.ok) return { status: "error", message: auth.message };

  // Validate FK existence upfront — Prisma's P2003 is less informative.
  const [group, user] = await Promise.all([
    prisma.annotatorGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, deletedAt: true },
    }),
  ]);
  if (!group) return { status: "error", message: "Group not found" };
  if (!user || user.deletedAt) return { status: "error", message: "User not found" };
  if (user.role !== "ANNOTATOR" && user.role !== "VENDOR_ANNOTATOR") {
    return { status: "error", message: "Only annotators can join groups" };
  }

  try {
    const membership = await prisma.groupMembership.create({
      data: { groupId, userId, isAdmin },
      select: { groupId: true, userId: true, isAdmin: true },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: membership };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "error", message: "User is already a member of this group" };
    }
    throw err;
  }
}

export async function removeMember(
  groupId: string,
  userId: string
): Promise<ActionResult<{ groupId: string; userId: string }>> {
  const auth = await requireGroupAccess(groupId);
  if (!auth.ok) return { status: "error", message: auth.message };
  // Self-removal is a foot-gun: a Group Admin could lock themselves out
  // of their own group (and lose admin surface access via scope). Only
  // a SYSTEM admin can remove the Group Admin themselves.
  if (userId === auth.userId) {
    const session = await getSession();
    const actorScope = await getAdminScope(session);
    if (actorScope.kind !== "SYSTEM") {
      return {
        status: "error",
        message: "不能移除自己；如需退出该组请联系系统管理员",
      };
    }
  }

  try {
    await prisma.groupMembership.delete({
      where: { userId_groupId: { userId, groupId } },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: { groupId, userId } };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Membership not found" };
    }
    throw err;
  }
}

export async function setGroupAdmin(
  groupId: string,
  userId: string,
  isAdmin: boolean
): Promise<ActionResult<{ groupId: string; userId: string; isAdmin: boolean }>> {
  const auth = await requireGroupAccess(groupId);
  if (!auth.ok) return { status: "error", message: auth.message };

  try {
    const membership = await prisma.groupMembership.update({
      where: { userId_groupId: { userId, groupId } },
      data: { isAdmin },
      select: { groupId: true, userId: true, isAdmin: true },
    });
    revalidatePath("/admin/annotators");
    return { status: "ok", data: membership };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { status: "error", message: "Membership not found" };
    }
    throw err;
  }
}

/**
 * Promote one member to be the group's sole admin.
 * If the target user is not yet a member, they are auto-added (isAdmin=true).
 * Atomic: demotes all current admins + promotes the target in one transaction,
 * so the group never ends up with 0 or 2+ admins mid-operation.
 */
export async function changeGroupAdmin(
  groupId: string,
  newAdminUserId: string
): Promise<ActionResult<{ groupId: string; newAdminUserId: string }>> {
  const auth = await requireGroupAccess(groupId);
  if (!auth.ok) return { status: "error", message: auth.message };

  const [group, user] = await Promise.all([
    prisma.annotatorGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id: newAdminUserId },
      select: { id: true, role: true, deletedAt: true },
    }),
  ]);
  if (!group) return { status: "error", message: "Group not found" };
  if (!user || user.deletedAt) return { status: "error", message: "User not found" };
  if (user.role !== "ANNOTATOR" && user.role !== "VENDOR_ANNOTATOR") {
    return { status: "error", message: "Only annotators can be group admins" };
  }

  await prisma.$transaction(async (tx) => {
    // Demote every existing admin of this group in a single UPDATE.
    await tx.groupMembership.updateMany({
      where: { groupId, isAdmin: true },
      data: { isAdmin: false },
    });
    // Upsert the new admin: if they're already a member, just flip isAdmin;
    // otherwise create the membership with isAdmin=true.
    await tx.groupMembership.upsert({
      where: { userId_groupId: { userId: newAdminUserId, groupId } },
      update: { isAdmin: true },
      create: { userId: newAdminUserId, groupId, isAdmin: true },
    });
  });

  revalidatePath("/admin/annotators");
  return { status: "ok", data: { groupId, newAdminUserId } };
}

/**
 * Create a new group with an admin and an initial set of members in one atomic step.
 * Rolls back on unique-name conflict so we don't orphan memberships against a
 * half-created group.
 */
export async function createGroupWithMembers(
  name: string,
  description: string | null,
  adminUserId: string,
  memberUserIds: string[],
  meta?: GroupMetaPatch
): Promise<ActionResult<{ id: string; name: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const cleanName = normalizeName(name);
  if (!cleanName) return { status: "error", message: "Group name is required" };
  if (cleanName.length > GROUP_NAME_MAX) {
    return { status: "error", message: `Group name must be <= ${GROUP_NAME_MAX} chars` };
  }
  const cleanDesc = description ? description.trim().slice(0, GROUP_DESC_MAX) : null;
  const cleanMeta = meta ? sanitizeMeta(meta) : {};

  // Dedupe + always include the admin in the member set so the admin is also
  // counted as a member (mirrors GroupMembership.isAdmin semantics).
  const memberSet = new Set<string>(memberUserIds);
  memberSet.add(adminUserId);
  const allMemberIds = Array.from(memberSet);

  // Validate users exist and are annotators before opening the transaction.
  const users = await prisma.user.findMany({
    where: {
      id: { in: allMemberIds },
      role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (users.length !== allMemberIds.length) {
    return {
      status: "error",
      message: "One or more selected users are invalid (not an active annotator)",
    };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const group = await tx.annotatorGroup.create({
        data: { name: cleanName, description: cleanDesc, ...cleanMeta },
        select: { id: true, name: true },
      });
      await tx.groupMembership.createMany({
        data: allMemberIds.map((userId) => ({
          userId,
          groupId: group.id,
          isAdmin: userId === adminUserId,
        })),
      });
      return group;
    });

    revalidatePath("/admin/annotators");
    return { status: "ok", data: created };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { status: "error", message: `Group name "${cleanName}" already exists` };
    }
    throw err;
  }
}

export async function batchMoveMembers(
  targetGroupId: string,
  userIds: string[]
): Promise<ActionResult<{ added: number; skipped: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const group = await prisma.annotatorGroup.findUnique({
    where: { id: targetGroupId },
    select: { id: true },
  });
  if (!group) return { status: "error", message: "Target group not found" };

  // createMany + skipDuplicates avoids racing errors on the composite unique.
  const result = await prisma.groupMembership.createMany({
    data: userIds.map((userId) => ({
      groupId: targetGroupId,
      userId,
      isAdmin: false,
    })),
    skipDuplicates: true,
  });

  revalidatePath("/admin/annotators");
  return {
    status: "ok",
    data: { added: result.count, skipped: userIds.length - result.count },
  };
}
