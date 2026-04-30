// Credential Vault — symmetric AES-256-GCM encryption for storing the
// current plaintext annotator password alongside its bcrypt hash. Admins
// (SYSTEM scope) can decrypt to hand out credentials without forcing a
// reset. Every access is audit-logged by the caller BEFORE the plaintext
// is returned from the server process.
//
// Security invariants:
//   - Master key lives in env `CREDENTIAL_VAULT_KEY` (base64 32 bytes).
//     Missing/malformed key is a FATAL startup error — no silent fallback.
//   - AES-256-GCM (authenticated encryption): tampering the ciphertext,
//     IV, or auth-tag makes decryption throw rather than return garbage.
//   - IV is 12 random bytes per row; never reuse.
//   - Auth tag is 16 bytes (GCM default).
//   - `version` allows key-rotation migrations later (re-encrypt rows
//     under new key + bump version; decrypt branches on version).
//
// Threat boundary:
//   - DB-only breach: attacker has ciphertext. Safe as long as key stays
//     out of their reach (different process, different host).
//   - Key-only leak: attacker can't decrypt without the DB rows.
//   - Dual compromise (DB + key): all vaulted passwords readable — at
//     that point the whole app is already owned; document as accepted.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const CURRENT_VERSION = 1;

export interface VaultBlob {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  version: number;
}

function getMasterKey(): Buffer {
  const raw = process.env.CREDENTIAL_VAULT_KEY;
  if (!raw) {
    throw new Error(
      "FATAL: CREDENTIAL_VAULT_KEY env var not set. Generate with `openssl rand -base64 32` and add to .env.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `FATAL: CREDENTIAL_VAULT_KEY decoded to ${key.length} bytes, expected ${KEY_BYTES}. Regenerate with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

/** Encrypt a plaintext password. Fresh IV each call; never reuse a blob. */
export function encryptPassword(plaintext: string): VaultBlob {
  if (!plaintext) throw new Error("Cannot encrypt empty password");
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    version: CURRENT_VERSION,
  };
}

/**
 * Decrypt a vault blob. Throws `DecryptionFailedError` on:
 *   - unknown version (key rotation not yet wired)
 *   - auth-tag mismatch (tamper or wrong key)
 * Callers must NOT log the caught error's raw message to audit entries —
 * it may include internal crypto state hints.
 */
export function decryptPassword(blob: VaultBlob): string {
  if (blob.version !== CURRENT_VERSION) {
    throw new DecryptionFailedError(
      `Unknown vault version ${blob.version}; key rotation pending`,
    );
  }
  const key = getMasterKey();
  try {
    const decipher = crypto.createDecipheriv(
      ALGO,
      key,
      Buffer.from(blob.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch (err) {
    throw new DecryptionFailedError(
      err instanceof Error ? err.message : "auth tag verification failed",
    );
  }
}

export class DecryptionFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionFailedError";
  }
}

/** Self-test, invoked at process start to fail fast if env is broken. */
export function selfTestVaultOnce(): void {
  const sample = "vault-self-test-" + Date.now().toString(36);
  const blob = encryptPassword(sample);
  const round = decryptPassword(blob);
  if (round !== sample) {
    throw new Error("FATAL: credential vault self-test roundtrip failed");
  }
}
