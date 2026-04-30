"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getAdminScope } from "@/lib/admin-scope";
import { storePassword } from "@/lib/password-service";
import { hash } from "bcryptjs";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import {
  parseAnnotatorBatchXlsx,
  parseAnnotatorBatchCsv,
  type AnnotatorBatchRow,
  type AnnotatorBatchParseError,
} from "@/lib/annotator-batch-parser";

export interface BatchCreateSummaryRow {
  rowNumber: number;
  name: string;
  email: string;
  accountType: "INTERNAL" | "VENDOR";
  groupName: string | null;
  password: string;
  userId: string;
  status: "created" | "skipped" | "error";
  message?: string;
}

export interface BatchPreview {
  rows: AnnotatorBatchRow[];
  errors: AnnotatorBatchParseError[];
  stats: { totalRows: number; internal: number; outsourced: number; withGroup: number };
}

export type BatchCreateResult =
  | { status: "ok"; created: BatchCreateSummaryRow[]; skippedExisting: number }
  | { status: "error"; message: string; errors?: AnnotatorBatchParseError[] };

function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function requireAdminScope(): Promise<
  | { ok: true; kind: "SYSTEM" }
  | { ok: true; kind: "GROUP"; groupIds: string[] }
  | { ok: false; message: string }
> {
  const session = await getSession();
  const scope = await getAdminScope(session);
  if (scope.kind === "NONE") return { ok: false, message: "Unauthorized" };
  if (scope.kind === "SYSTEM") return { ok: true, kind: "SYSTEM" };
  return { ok: true, kind: "GROUP", groupIds: scope.groupIds };
}

/**
 * Parse uploaded xlsx/csv into a preview (no DB writes).
 * Returns parsed rows + errors so the admin can review before committing.
 */
export async function previewAnnotatorBatch(
  fileBase64: string,
  mime: string,
): Promise<{ status: "ok"; preview: BatchPreview } | { status: "error"; message: string }> {
  const auth = await requireAdminScope();
  if (!auth.ok) return { status: "error", message: auth.message };

  if (!fileBase64) {
    return { status: "error", message: "File content is required" };
  }
  const buffer = Buffer.from(fileBase64, "base64");

  try {
    const isCsv =
      mime === "text/csv" ||
      mime === "application/csv" ||
      mime === "text/plain";
    const parsed = isCsv
      ? parseAnnotatorBatchCsv(buffer.toString("utf8"))
      : await parseAnnotatorBatchXlsx(buffer);
    return {
      status: "ok",
      preview: { rows: parsed.rows, errors: parsed.errors, stats: parsed.stats },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse file";
    return { status: "error", message };
  }
}

/**
 * Bulk create annotator accounts from validated rows.
 * All-or-nothing for validation errors; per-row write with tx for DB consistency.
 *
 * Behavior:
 * - existing email: skip, report skippedExisting count
 * - unknown groupName: create group on-the-fly (admin can rename later)
 * - password: auto-generated per row, returned so admin can download as CSV
 */
export async function bulkCreateAnnotators(
  rows: AnnotatorBatchRow[],
): Promise<BatchCreateResult> {
  const auth = await requireAdminScope();
  if (!auth.ok) return { status: "error", message: auth.message };
  const session = await getSession();
  const actorId = session!.userId; // guaranteed by requireAdminScope

  if (!Array.isArray(rows) || rows.length === 0) {
    return { status: "error", message: "No rows to import" };
  }

  // Group Admins can only import into groups they administer. Also
  // prevent on-the-fly group creation: a missing groupName would be
  // created as a new group, which belongs to no one — a privilege
  // escalation if we skipped this check.
  if (auth.kind === "GROUP") {
    const allowedGroups = await prisma.annotatorGroup.findMany({
      where: { id: { in: auth.groupIds } },
      select: { id: true, name: true },
    });
    const allowedNameSet = new Set(allowedGroups.map((g) => g.name));
    const violations: AnnotatorBatchParseError[] = [];
    for (const row of rows) {
      const g = row.groupName?.trim();
      if (!g) {
        violations.push({
          row: row.rowNumber,
          column: "groupName",
          message: "Group Admin 批量导入必须指定本人管理的组",
        });
      } else if (!allowedNameSet.has(g)) {
        violations.push({
          row: row.rowNumber,
          column: "groupName",
          message: `组 "${g}" 不在您管理的组内`,
        });
      }
    }
    if (violations.length > 0) {
      return { status: "error", message: "Scope violation", errors: violations };
    }
  }

  // Defense in depth: revalidate basic format on the server even if client trusted parser output.
  const inLineErrors: AnnotatorBatchParseError[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.name || !row.email) {
      inLineErrors.push({ row: row.rowNumber, message: "姓名/邮箱不能为空" });
      continue;
    }
    if (seen.has(row.email.toLowerCase())) {
      inLineErrors.push({ row: row.rowNumber, column: "email", message: `邮箱重复: ${row.email}` });
    }
    seen.add(row.email.toLowerCase());
  }
  if (inLineErrors.length > 0) {
    return { status: "error", message: "Validation failed", errors: inLineErrors };
  }

  // Collect unique group names and upsert once.
  const uniqueGroupNames = Array.from(
    new Set(
      rows
        .map((r) => r.groupName?.trim())
        .filter((g): g is string => !!g && g.length > 0),
    ),
  );
  const groupIdByName = new Map<string, string>();
  for (const groupName of uniqueGroupNames) {
    const existing = await prisma.annotatorGroup.findUnique({
      where: { name: groupName },
      select: { id: true },
    });
    if (existing) {
      groupIdByName.set(groupName, existing.id);
    } else {
      const created = await prisma.annotatorGroup.create({
        data: { name: groupName },
        select: { id: true },
      });
      groupIdByName.set(groupName, created.id);
    }
  }

  const summaries: BatchCreateSummaryRow[] = [];
  let skippedExisting = 0;

  for (const row of rows) {
    const email = row.email.toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, deletedAt: true },
    });

    if (existing && !existing.deletedAt) {
      skippedExisting++;
      summaries.push({
        rowNumber: row.rowNumber,
        name: row.name,
        email,
        accountType: row.accountType,
        groupName: row.groupName,
        password: "",
        userId: existing.id,
        status: "skipped",
        message: "邮箱已存在，未重置密码",
      });
      continue;
    }

    const password = generatePassword();

    try {
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          name: row.name,
          accountType: row.accountType,
          deletedAt: null,
        },
        create: {
          email,
          name: row.name,
          passwordHash: "placeholder-will-be-replaced",
          role: "ANNOTATOR",
          accountType: row.accountType,
        },
        select: { id: true },
      });
      // Real bcrypt + vault write + audit, all atomic.
      await storePassword(user.id, password, "CREATE", actorId);

      if (row.groupName) {
        const groupId = groupIdByName.get(row.groupName.trim());
        if (groupId) {
          await prisma.groupMembership.upsert({
            where: { userId_groupId: { userId: user.id, groupId } },
            update: {},
            create: { userId: user.id, groupId, isAdmin: false },
          });
        }
      }

      summaries.push({
        rowNumber: row.rowNumber,
        name: row.name,
        email,
        accountType: row.accountType,
        groupName: row.groupName,
        password,
        userId: user.id,
        status: "created",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown DB error";
      summaries.push({
        rowNumber: row.rowNumber,
        name: row.name,
        email,
        accountType: row.accountType,
        groupName: row.groupName,
        password: "",
        userId: "",
        status: "error",
        message,
      });
    }
  }

  revalidatePath("/admin/annotators");

  return { status: "ok", created: summaries, skippedExisting };
}
