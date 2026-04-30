"use server";

import { randomBytes } from "crypto";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export type ViewerActionResult<T = undefined> =
  | { status: "ok"; data?: T }
  | { status: "error"; message: string };

function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { ok: false as const, message: "Unauthorized" };
  }
  return { ok: true as const, session };
}

export async function createViewerAccount(
  email: string,
  name: string,
): Promise<ViewerActionResult<{ email: string; password: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  if (!cleanEmail || !cleanName) {
    return { status: "error", message: "Email and name are required" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { status: "error", message: "Invalid email format" };
  }

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) {
    return { status: "error", message: "Email already in use" };
  }

  const password = generatePassword();
  const passwordHash = await hash(password, 12);

  await prisma.user.create({
    data: {
      email: cleanEmail,
      name: cleanName,
      passwordHash,
      role: "VIEWER",
      accountType: "INTERNAL",
    },
  });

  revalidatePath("/admin/viewers");
  return { status: "ok", data: { email: cleanEmail, password } };
}

export async function assignPackageToViewer(
  viewerId: string,
  packageId: string,
): Promise<ViewerActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const viewer = await prisma.user.findUnique({ where: { id: viewerId } });
  if (!viewer || viewer.role !== "VIEWER") {
    return { status: "error", message: "Target user is not a viewer" };
  }
  const pkg = await prisma.evaluationPackage.findUnique({ where: { id: packageId } });
  if (!pkg) return { status: "error", message: "Package not found" };

  await prisma.viewerAssignment.upsert({
    where: { viewerId_packageId: { viewerId, packageId } },
    create: { viewerId, packageId, assignedBy: auth.session.userId },
    update: {},
  });

  revalidatePath("/admin/viewers");
  revalidatePath("/viewer");
  return { status: "ok" };
}

export async function unassignPackageFromViewer(
  viewerId: string,
  packageId: string,
): Promise<ViewerActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  await prisma.viewerAssignment.deleteMany({
    where: { viewerId, packageId },
  });

  revalidatePath("/admin/viewers");
  revalidatePath("/viewer");
  return { status: "ok" };
}

/**
 * Per-viewer batch assignment. Uses createMany + skipDuplicates so re-adding
 * a package the viewer already has is a no-op rather than an error — admins
 * can spam the button without breaking anything. Returns the *actually*
 * inserted count (skipDuplicates makes Prisma accurate here).
 */
export async function assignPackagesToViewerBatch(
  viewerId: string,
  packageIds: string[],
): Promise<ViewerActionResult<{ added: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  if (packageIds.length === 0) return { status: "ok", data: { added: 0 } };

  const viewer = await prisma.user.findUnique({ where: { id: viewerId } });
  if (!viewer || viewer.role !== "VIEWER") {
    return { status: "error", message: "Target user is not a viewer" };
  }

  // Filter to only packages that exist (defensive — UI shouldn't send bad ids,
  // but better than failing with a cryptic FK error mid-batch).
  const valid = await prisma.evaluationPackage.findMany({
    where: { id: { in: packageIds } },
    select: { id: true },
  });
  const validIds = new Set(valid.map((p) => p.id));

  const result = await prisma.viewerAssignment.createMany({
    data: packageIds
      .filter((pid) => validIds.has(pid))
      .map((pid) => ({
        viewerId,
        packageId: pid,
        assignedBy: auth.session.userId,
      })),
    skipDuplicates: true,
  });

  revalidatePath("/admin/viewers");
  revalidatePath("/viewer");
  return { status: "ok", data: { added: result.count } };
}

/**
 * Per-viewer batch removal. deleteMany is the right primitive here because
 * we're filtering by composite key — no need to look anything up first.
 */
export async function unassignPackagesFromViewerBatch(
  viewerId: string,
  packageIds: string[],
): Promise<ViewerActionResult<{ removed: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  if (packageIds.length === 0) return { status: "ok", data: { removed: 0 } };

  const result = await prisma.viewerAssignment.deleteMany({
    where: { viewerId, packageId: { in: packageIds } },
  });

  revalidatePath("/admin/viewers");
  revalidatePath("/viewer");
  return { status: "ok", data: { removed: result.count } };
}

/**
 * N viewers × M packages bulk assignment. Skips combinations the viewer
 * already has via the composite unique (viewerId, packageId). Returns
 * (added, skipped) so the UI can show "添加 12，跳过 3 个已有".
 */
export async function bulkAssignViewersToPackages(
  viewerIds: string[],
  packageIds: string[],
): Promise<ViewerActionResult<{ added: number; skipped: number }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  if (viewerIds.length === 0 || packageIds.length === 0) {
    return { status: "ok", data: { added: 0, skipped: 0 } };
  }

  // Validate viewers and packages exist + viewers actually have role=VIEWER.
  const [viewers, pkgs] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: viewerIds }, role: "VIEWER" },
      select: { id: true },
    }),
    prisma.evaluationPackage.findMany({
      where: { id: { in: packageIds } },
      select: { id: true },
    }),
  ]);
  const vIds = viewers.map((v) => v.id);
  const pIds = pkgs.map((p) => p.id);

  if (vIds.length === 0 || pIds.length === 0) {
    return { status: "ok", data: { added: 0, skipped: 0 } };
  }

  const total = vIds.length * pIds.length;
  const data = vIds.flatMap((viewerId) =>
    pIds.map((packageId) => ({
      viewerId,
      packageId,
      assignedBy: auth.session.userId,
    })),
  );

  const result = await prisma.viewerAssignment.createMany({
    data,
    skipDuplicates: true,
  });

  revalidatePath("/admin/viewers");
  revalidatePath("/viewer");
  return {
    status: "ok",
    data: { added: result.count, skipped: total - result.count },
  };
}

export async function resetViewerPassword(
  viewerId: string,
): Promise<ViewerActionResult<{ email: string; password: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const viewer = await prisma.user.findUnique({ where: { id: viewerId } });
  if (!viewer || viewer.role !== "VIEWER") {
    return { status: "error", message: "Viewer not found" };
  }

  const password = generatePassword();
  const passwordHash = await hash(password, 12);

  await prisma.user.update({
    where: { id: viewerId },
    data: { passwordHash },
  });

  return { status: "ok", data: { email: viewer.email, password } };
}

export async function deleteViewerAccount(
  viewerId: string,
): Promise<ViewerActionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { status: "error", message: auth.message };

  const viewer = await prisma.user.findUnique({ where: { id: viewerId } });
  if (!viewer || viewer.role !== "VIEWER") {
    return { status: "error", message: "Viewer not found" };
  }

  await prisma.user.update({
    where: { id: viewerId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/admin/viewers");
  return { status: "ok" };
}
