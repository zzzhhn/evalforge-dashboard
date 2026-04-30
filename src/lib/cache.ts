import { redis } from "./redis";

const DEFAULT_TTL = 3600; // 1 hour in seconds
const KEY_PREFIX = "vr:";

/**
 * Cache-aside helper: try cache first, compute on miss, store result.
 * TTL defaults to 1 hour. Pass ttl=0 to skip caching (passthrough).
 */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  if (ttl <= 0) return compute();

  const fullKey = `${KEY_PREFIX}${key}`;

  try {
    const hit = await redis.get(fullKey);
    if (hit !== null) {
      return JSON.parse(hit) as T;
    }
  } catch {
    // Redis down — fall through to compute
  }

  const result = await compute();

  try {
    await redis.set(fullKey, JSON.stringify(result), "EX", ttl);
  } catch {
    // Redis down — result still returned, just not cached
  }

  return result;
}

/**
 * Invalidate cache entries by key pattern.
 * Use after aggregation runs to bust stale analytics caches.
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const fullPattern = `${KEY_PREFIX}${pattern}`;
  try {
    const keys = await redis.keys(fullPattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return keys.length;
  } catch {
    return 0;
  }
}
