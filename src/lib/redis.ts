import Redis from "ioredis";

/**
 * In-memory fallback used when REDIS_URL is not configured. Implements just
 * the surface area that login/action.ts depends on (get/incr/expire/ttl/del)
 * with millisecond-resolution expiry, so rate limiting still works on a
 * single Vercel function instance even without a shared Redis. Across-pod
 * coherence requires a real Redis — set REDIS_URL to enable.
 */
type RedisLike = Pick<Redis, "get" | "set" | "incr" | "expire" | "ttl" | "del" | "keys">;

function createInMemoryStub(): RedisLike {
  const store = new Map<string, { value: string; expiresAt: number | null }>();

  function purgeIfExpired(key: string) {
    const entry = store.get(key);
    if (entry && entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      store.delete(key);
    }
  }

  function globToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  }

  // Use `unknown` + cast for the loose ioredis variadic signatures (set
  // accepts EX/PX/NX/XX modifiers). Stub only implements what cache.ts and
  // login/action.ts actually call.
  const stub = {
    async get(key: string) {
      purgeIfExpired(key);
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async set(key: string, value: string | number, ...args: unknown[]) {
      let expiresAt: number | null = null;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (typeof arg === "string") {
          const upper = arg.toUpperCase();
          if (upper === "EX" && typeof args[i + 1] === "number") {
            expiresAt = Date.now() + (args[i + 1] as number) * 1000;
          } else if (upper === "PX" && typeof args[i + 1] === "number") {
            expiresAt = Date.now() + (args[i + 1] as number);
          }
        }
      }
      store.set(key, { value: String(value), expiresAt });
      return "OK";
    },
    async incr(key: string) {
      purgeIfExpired(key);
      const entry = store.get(key);
      const current = entry ? Number(entry.value) || 0 : 0;
      const next = current + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async expire(key: string, seconds: number) {
      const entry = store.get(key);
      if (!entry) return 0;
      store.set(key, { value: entry.value, expiresAt: Date.now() + seconds * 1000 });
      return 1;
    },
    async ttl(key: string) {
      purgeIfExpired(key);
      const entry = store.get(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed++;
      }
      return removed;
    },
    async keys(pattern: string) {
      const regex = globToRegExp(pattern);
      const matched: string[] = [];
      for (const key of store.keys()) {
        purgeIfExpired(key);
        if (store.has(key) && regex.test(key)) matched.push(key);
      }
      return matched;
    },
  };

  return stub as unknown as RedisLike;
}

function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
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
const globalForRedis = globalThis as unknown as { __redis?: RedisLike };

function resolveRedis(): RedisLike {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[Redis] REDIS_URL not set in production — falling back to in-memory rate limiter (per-instance, not coherent across Vercel functions)."
      );
    }
    return createInMemoryStub();
  }
  return createRedisClient(url);
}

export const redis = globalForRedis.__redis ?? resolveRedis();
if (process.env.NODE_ENV !== "production") {
  globalForRedis.__redis = redis;
}
