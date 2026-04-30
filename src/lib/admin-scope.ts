// Admin-surface scope resolution. Every /admin/* page.tsx and every
// admin-side server action must pass the active session through
// `getAdminScope` and gate downstream work by the returned scope.
//
// Scopes:
//   SYSTEM — ADMIN / RESEARCHER: full visibility and mutation rights
//   GROUP  — ANNOTATOR who is GroupMembership.isAdmin=true for >=1 group;
//            can only see/manage their own group members
//   NONE   — everyone else (regular annotator, vendor, logged-out)
//
// We DO NOT embed groupAdminOf in the JWT cookie. Per product decision,
// we re-query `GroupMembership` on every admin-surface request so a user
// who loses admin rights loses access immediately (no session refresh
// lag). Cost: one indexed Prisma lookup per admin request — negligible.

import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth";

export type AdminScope =
  | { kind: "SYSTEM"; role: "ADMIN" | "RESEARCHER"; userId: string }
  | { kind: "GROUP"; userId: string; groupIds: string[] }
  | { kind: "NONE" };

export async function getAdminScope(
  session: SessionPayload | null,
): Promise<AdminScope> {
  if (!session) return { kind: "NONE" };
  if (session.role === "ADMIN" || session.role === "RESEARCHER") {
    return { kind: "SYSTEM", role: session.role, userId: session.userId };
  }
  // Annotator path: check if they admin any group.
  const memberships = await prisma.groupMembership.findMany({
    where: { userId: session.userId, isAdmin: true },
    select: { groupId: true },
  });
  if (memberships.length === 0) return { kind: "NONE" };
  return {
    kind: "GROUP",
    userId: session.userId,
    groupIds: memberships.map((m) => m.groupId),
  };
}

// Return the set of user IDs the current scope is allowed to see. SYSTEM
// returns the sentinel "ALL" (callers skip the userId filter entirely);
// GROUP returns the concrete id set (union of all members across all
// groups the user admins). The empty-set case is handled explicitly by
// callers — Prisma's `{ in: [] }` throws, so never pass that in.
export async function getScopedUserIds(
  scope: AdminScope,
): Promise<Set<string> | "ALL"> {
  if (scope.kind === "SYSTEM") return "ALL";
  if (scope.kind === "NONE") return new Set();
  const memberships = await prisma.groupMembership.findMany({
    where: { groupId: { in: scope.groupIds } },
    select: { userId: true },
  });
  // Group Admins see themselves too (they're members of their own group).
  const ids = new Set(memberships.map((m) => m.userId));
  return ids;
}

// Shorthand for the common Prisma where-clause. Returns undefined when the
// scope is SYSTEM (no filter), or `{ in: [...ids] }` otherwise. Callers
// should spread this into their where clause to avoid empty-array bugs.
export function scopedUserIdFilter(
  userIds: Set<string> | "ALL",
): { in: string[] } | undefined {
  if (userIds === "ALL") return undefined;
  return { in: [...userIds] };
}

// Guard: can this scope manage (remove / suspend / etc.) the target user?
// Returns `true` only when SYSTEM or the target user is in one of the
// admin's groups. Hits the DB once in the GROUP case, so cache the result
// when doing a batch.
export async function canManageUser(
  scope: AdminScope,
  targetUserId: string,
): Promise<boolean> {
  if (scope.kind === "SYSTEM") return true;
  if (scope.kind === "NONE") return false;
  const match = await prisma.groupMembership.findFirst({
    where: { userId: targetUserId, groupId: { in: scope.groupIds } },
    select: { id: true },
  });
  return match != null;
}

// Batch variant: returns the subset of targetUserIds the scope can manage.
// Used by `batchRemoveFromPackage` / `adjustPackageAssignment` so we can
// reject an operation if ANY target is out-of-scope (all-or-nothing).
export async function filterManageableUsers(
  scope: AdminScope,
  targetUserIds: string[],
): Promise<Set<string>> {
  if (scope.kind === "SYSTEM") return new Set(targetUserIds);
  if (scope.kind === "NONE" || targetUserIds.length === 0) return new Set();
  const matches = await prisma.groupMembership.findMany({
    where: {
      userId: { in: targetUserIds },
      groupId: { in: scope.groupIds },
    },
    select: { userId: true },
  });
  return new Set(matches.map((m) => m.userId));
}

// Guard: can this scope manage the target group (rename, edit metadata,
// set admin)? SYSTEM always yes; GROUP yes only if the group is in their
// adminned set. Group creation/deletion stays SYSTEM-only; enforce that
// at the action layer with `assertSystem`.
export function canManageGroup(scope: AdminScope, groupId: string): boolean {
  if (scope.kind === "SYSTEM") return true;
  if (scope.kind === "NONE") return false;
  return scope.groupIds.includes(groupId);
}

export function isSystem(scope: AdminScope): boolean {
  return scope.kind === "SYSTEM";
}

// Thrown by action guards. The server-action wrapper catches it and
// returns `{ status: "error", message }` so the client gets a predictable
// shape without needing per-action error handling.
export class ScopeError extends Error {
  constructor(message = "Forbidden: out of scope") {
    super(message);
    this.name = "ScopeError";
  }
}

export function assertSystem(scope: AdminScope): asserts scope is Extract<
  AdminScope,
  { kind: "SYSTEM" }
> {
  if (scope.kind !== "SYSTEM") throw new ScopeError("Forbidden: system only");
}

export async function assertCanManageUser(
  scope: AdminScope,
  targetUserId: string,
): Promise<void> {
  if (!(await canManageUser(scope, targetUserId))) {
    throw new ScopeError();
  }
}

export async function assertCanManageUsers(
  scope: AdminScope,
  targetUserIds: string[],
): Promise<void> {
  const ok = await filterManageableUsers(scope, targetUserIds);
  if (ok.size !== targetUserIds.length) {
    throw new ScopeError(
      `Forbidden: ${targetUserIds.length - ok.size} target user(s) not in your scope`,
    );
  }
}

export function assertCanManageGroup(scope: AdminScope, groupId: string): void {
  if (!canManageGroup(scope, groupId)) throw new ScopeError();
}
