import { prisma } from "@/lib/db";

export interface AntiCheatConfig {
  minWatchRatio: number;
  minDwellMultiplier: number;
  minDwellFloorMs: number;
  maxSubmitsPerHour: number;
  fixedValueThreshold: number;
  lowVarianceThreshold: number;
  recentScoresWindow: number;
}

const DEFAULTS: AntiCheatConfig = {
  minWatchRatio: 0.7,
  minDwellMultiplier: 0.6,
  minDwellFloorMs: 5000,
  maxSubmitsPerHour: 60,
  fixedValueThreshold: 0.8,
  lowVarianceThreshold: 0.5,
  recentScoresWindow: 20,
};

const KEY_MAP: Record<string, keyof AntiCheatConfig> = {
  "anti_cheat.min_watch_ratio": "minWatchRatio",
  "anti_cheat.min_dwell_multiplier": "minDwellMultiplier",
  "anti_cheat.min_dwell_floor_ms": "minDwellFloorMs",
  "anti_cheat.max_submits_per_hour": "maxSubmitsPerHour",
  "anti_cheat.fixed_value_threshold": "fixedValueThreshold",
  "anti_cheat.low_variance_threshold": "lowVarianceThreshold",
  "anti_cheat.recent_scores_window": "recentScoresWindow",
};

export async function loadAntiCheatConfig(): Promise<AntiCheatConfig> {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: "anti_cheat." } },
  });

  const config = { ...DEFAULTS };
  for (const row of rows) {
    const field = KEY_MAP[row.key];
    if (field) {
      config[field] = Number(row.value);
    }
  }
  return config;
}
