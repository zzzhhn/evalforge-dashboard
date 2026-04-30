import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? (
  process.env.NODE_ENV === "production"
    ? (() => { throw new Error("FATAL: REDIS_URL is required in production"); })()
    : "redis://localhost:6379"
);

/** Singleton Redis client — reused across hot-reloads in dev. */
function createRedisClient(): Redis {
  const client = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    // Reconnect with exponential backoff (max 3s)
    retryStrategy(times) {
      return Math.min(times * 200, 3000);
    },
  });

  client.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  return client;
}

// Prevent multiple instances in dev (Next.js hot reload creates new modules)
const globalForRedis = globalThis as unknown as { __redis?: Redis };
export const redis = globalForRedis.__redis ?? createRedisClient();
if (process.env.NODE_ENV !== "production") {
  globalForRedis.__redis = redis;
}
