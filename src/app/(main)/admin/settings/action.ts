"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export interface ConfigEntry {
  key: string;
  value: number;
  label: string | null;
}

export async function getSystemConfigs(): Promise<ConfigEntry[]> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return [];
  }

  const configs = await prisma.systemConfig.findMany({
    where: {
      OR: [
        { key: { startsWith: "anti_cheat." } },
        { key: { startsWith: "display." } },
      ],
    },
    orderBy: { key: "asc" },
  });

  return configs.map((c) => ({
    key: c.key,
    value: c.value as number,
    label: c.label,
  }));
}

export async function updateSystemConfigs(
  updates: { key: string; value: number }[]
): Promise<{ success: boolean; error?: string }> {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  for (const { key, value } of updates) {
    if (!key.startsWith("anti_cheat.") && !key.startsWith("display.")) {
      return { success: false, error: `Invalid key: ${key}` };
    }
    if (!Number.isFinite(value) || value < 0) {
      return { success: false, error: `Invalid value for ${key}: ${value}` };
    }

    await prisma.systemConfig.update({
      where: { key },
      data: { value },
    });
  }

  return { success: true };
}
