"use server";

// Server actions for the credential management surface. SYSTEM-only —
// we deliberately do NOT grant reveal access to Group Admins for MVP
// because the threat model of a compromised group admin account would
// otherwise escalate to "all own-group members' passwords exfiltrated
// without any human noticing". Opt-in later if needed.

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminScope } from "@/lib/admin-scope";
import {
  storePassword,
  revealPassword as revealFromVault,
} from "@/lib/password-service";
import { headers } from "next/headers";

type Result<T> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

async function requireSystemAdmin(): Promise<
  { ok: true; actorId: string } | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind !== "SYSTEM") {
    return { ok: false, message: "Forbidden: system admin only" };
  }
  return { ok: true, actorId: scope.userId };
}

// Capture forensic context (IP + UA) from the request headers. These are
// best-effort — behind a proxy they reflect whatever the proxy forwards
// (x-forwarded-for). Good enough for intra-org audit trails.
async function captureAuditCtx(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const h = await headers();
  const ipAddress =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  const userAgent = h.get("user-agent");
  return { ipAddress, userAgent };
}

/**
 * Reveal the current plaintext password for an annotator. Writes an
 * audit row (VIEW) whether it succeeds or fails so no silent
 * exfiltration attempt is possible.
 *
 * Returns either:
 *   - { found: true, plaintext, lastResetAt }
 *   - { found: false, reason: "no-vault" | "decrypt-failed" }
 */
export async function revealAnnotatorPassword(
  userId: string,
): Promise<
  Result<
    | { found: true; plaintext: string; lastResetAt: string | null }
    | { found: false; reason: "no-vault" | "decrypt-failed" }
  >
> {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  // Refuse to reveal the admin's own password (self-surveillance is
  // useless and the workflow should be self-reset instead).
  if (userId === auth.actorId) {
    return { status: "error", message: "Cannot reveal your own credential" };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      deletedAt: true,
      credentialVault: { select: { updatedAt: true } },
    },
  });
  if (!target || target.deletedAt) {
    return { status: "error", message: "User not found" };
  }
  // Scope to annotator-type accounts. Admin/Researcher/Viewer credentials
  // shouldn't flow through this surface.
  if (target.role !== "ANNOTATOR" && target.role !== "VENDOR_ANNOTATOR") {
    return { status: "error", message: "Reveal is only allowed for annotators" };
  }

  const ctx = await captureAuditCtx();
  const result = await revealFromVault(userId, auth.actorId, ctx);

  if (result.found) {
    return {
      status: "ok",
      data: {
        found: true,
        plaintext: result.plaintext,
        lastResetAt: target.credentialVault?.updatedAt.toISOString() ?? null,
      },
    };
  }
  return {
    status: "ok",
    data: { found: false, reason: result.reason },
  };
}

/**
 * Reset an annotator's password — either with a specific new password
 * (admin-chosen) or by generating a random one. Always returns the
 * plaintext so the admin can display it once. Writes an audit row.
 */
export async function resetCredentialPassword(
  userId: string,
  opts: { mode: "random" } | { mode: "custom"; newPassword: string },
): Promise<Result<{ plaintext: string }>> {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, deletedAt: true },
  });
  if (!target || target.deletedAt) {
    return { status: "error", message: "User not found" };
  }
  if (target.role !== "ANNOTATOR" && target.role !== "VENDOR_ANNOTATOR") {
    return { status: "error", message: "Reset is only allowed for annotators" };
  }

  let plaintext: string;
  if (opts.mode === "random") {
    plaintext = generateRandomPassword();
  } else {
    const err = validateCustomPassword(opts.newPassword);
    if (err) return { status: "error", message: err };
    plaintext = opts.newPassword;
  }

  const ctx = await captureAuditCtx();
  await storePassword(userId, plaintext, "RESET", auth.actorId, ctx);
  return { status: "ok", data: { plaintext } };
}

/** List annotators for the credentials management page. Each row carries
 *  the vault status (has entry vs legacy) so the UI can gate the eye
 *  button accordingly. Dataset sizes are small (≤ hundreds), pagination
 *  can come later if needed. */
export async function listAnnotatorsForCredentials(): Promise<
  Result<
    Array<{
      userId: string;
      name: string;
      email: string;
      accountType: string;
      groupName: string | null;
      hasVault: boolean;
      lastResetAt: string | null;
    }>
  >
> {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const users = await prisma.user.findMany({
    where: {
      role: { in: ["ANNOTATOR", "VENDOR_ANNOTATOR"] },
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      accountType: true,
      credentialVault: { select: { updatedAt: true } },
      groupMemberships: {
        take: 1,
        select: { group: { select: { name: true } } },
      },
    },
  });
  // Natural sort: "User 2" before "User 10". Prisma's default orderBy is
  // lexicographic which would put "User 10" before "User 2" — confusing
  // for admins scanning down a long list.
  users.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );

  return {
    status: "ok",
    data: users.map((u) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      accountType: u.accountType,
      groupName: u.groupMemberships[0]?.group.name ?? null,
      hasVault: u.credentialVault != null,
      lastResetAt: u.credentialVault?.updatedAt.toISOString() ?? null,
    })),
  };
}

// ---- Helpers ----------------------------------------------------

const PWD_ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateRandomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => PWD_ALPHABET[b % PWD_ALPHABET.length]).join("");
}

const MIN = 8;
const MAX = 128;
function validateCustomPassword(raw: string): string | null {
  if (raw.length < MIN) return `Password must be ≥ ${MIN} characters`;
  if (raw.length > MAX) return `Password must be ≤ ${MAX} characters`;
  if (/\s/.test(raw)) return "Password must not contain whitespace";
  return null;
}
