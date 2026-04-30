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

// In-memory TTL cache. Anti-cheat config is read on every navigation
// AND every submit — at 30 actions/min that's 30 needless DB roundtrips.
// Admins rarely tweak these values, so a 5-minute TTL is fine; on
// updates the worst case is a 5-minute lag before a worker process
// picks up the new value.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { config: AntiCheatConfig; expiresAt: number } | null = null;

export async function loadAntiCheatConfig(): Promise<AntiCheatConfig> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  const rows = await prisma.systemConfig.findMany({
    where: { key: { startsWith: "anti_cheat." } },
  });

  const config = { ...DEFAULTS };
  for (const row of rows) {
    const field = KEY_MAP[row.key];
    if (field) {
      config[field] = row.value as number;
    }
  }
  cached = { config, expiresAt: now + CACHE_TTL_MS };
  return config;
}

/** Drop the cache. Call from admin settings save flow if you need
 *  changes to take effect immediately rather than within 5 min. */
export function invalidateAntiCheatConfigCache(): void {
  cached = null;
}
