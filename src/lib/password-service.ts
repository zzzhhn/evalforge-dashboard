// Single-responsibility boundary between "we want to change this user's
// password" and the mechanics of bcrypt + vault + audit. Every password
// set/reset/view must go through here; never write `prisma.user.update({
// passwordHash })` directly from an action, or the vault copy will drift
// out of sync.

import { hash as bcryptHash } from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  encryptPassword,
  decryptPassword,
  DecryptionFailedError,
} from "@/lib/credential-vault";
import type { Prisma } from "@prisma/client";

const BCRYPT_COST = 12;

export type AuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Hash the plaintext with bcrypt AND encrypt a vault copy — inside a
 * single Prisma transaction so we never end up with a hash but no vault
 * (or vice versa). Also writes an audit row with the given action
 * (CREATE on account creation, RESET on manual rotation).
 *
 * Accepts an optional `tx` so it composes into larger transactions
 * (e.g. batch user creation).
 */
export async function storePassword(
  userId: string,
  plaintext: string,
  action: "CREATE" | "RESET",
  actorId: string,
  ctx: AuditContext = {},
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const hash = await bcryptHash(plaintext, BCRYPT_COST);
  const blob = encryptPassword(plaintext);

  const run = async (client: Prisma.TransactionClient) => {
    await client.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });
    await client.credentialVaultEntry.upsert({
      where: { userId },
      create: {
        userId,
        ciphertext: blob.ciphertext,
        iv: blob.iv,
        authTag: blob.authTag,
        version: blob.version,
      },
      update: {
        ciphertext: blob.ciphertext,
        iv: blob.iv,
        authTag: blob.authTag,
        version: blob.version,
      },
    });
    await client.credentialAccessAudit.create({
      data: {
        actorId,
        targetUserId: userId,
        action,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  };

  if (tx) {
    await run(tx);
  } else {
    await prisma.$transaction(run);
  }
}

/**
 * Reveal the current plaintext password for a user. Always writes an
 * audit row — even on "not found" — so we have forensics on every reveal
 * attempt. Returns `{ found: false }` when:
 *   - user exists but vault is empty (legacy user from before the vault
 *     feature shipped; admin must reset once to populate).
 *   - user exists but decryption failed (key rotation or tampering).
 */
export async function revealPassword(
  targetUserId: string,
  actorId: string,
  ctx: AuditContext = {},
): Promise<
  | { found: true; plaintext: string }
  | { found: false; reason: "no-vault" | "decrypt-failed" }
> {
  const entry = await prisma.credentialVaultEntry.findUnique({
    where: { userId: targetUserId },
  });

  // Audit before returning plaintext (on success) and on any attempt (on
  // failure). A future SOC2/GDPR request should be answerable from this
  // row without us scanning app logs.
  const writeAudit = async () => {
    await prisma.credentialAccessAudit.create({
      data: {
        actorId,
        targetUserId,
        action: "VIEW",
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  };

  if (!entry) {
    await writeAudit();
    return { found: false, reason: "no-vault" };
  }

  try {
    const plaintext = decryptPassword({
      ciphertext: entry.ciphertext,
      iv: entry.iv,
      authTag: entry.authTag,
      version: entry.version,
    });
    await writeAudit();
    return { found: true, plaintext };
  } catch (err) {
    if (err instanceof DecryptionFailedError) {
      await writeAudit();
      return { found: false, reason: "decrypt-failed" };
    }
    throw err;
  }
}

/** Remove a user's vault entry (e.g., hard delete). Soft-delete does NOT
 *  clear it because the user may be reactivated; we rely on the FK
 *  cascade when the user row is hard-deleted. */
export async function clearVault(userId: string, actorId: string): Promise<void> {
  await prisma.$transaction([
    prisma.credentialVaultEntry.deleteMany({ where: { userId } }),
    prisma.credentialAccessAudit.create({
      data: { actorId, targetUserId: userId, action: "DELETE" },
    }),
  ]);
}
