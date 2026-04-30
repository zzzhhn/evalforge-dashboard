"use server";

import { prisma } from "@/lib/db";
import { createToken, setSessionCookie } from "@/lib/auth";
import { compare } from "bcryptjs";
import { redirect } from "next/navigation";
import { redis } from "@/lib/redis";

export interface LoginState {
  error?: string;
}

// ── Redis-backed rate limiter (per email) ──
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

async function checkRateLimit(email: string): Promise<string | null> {
  const key = `login_attempts:${email}`;
  try {
    const count = await redis.get(key);
    const attempts = count ? parseInt(count, 10) : 0;
    if (attempts >= MAX_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      const remainMin = Math.max(1, Math.ceil(ttl / 60));
      return `登录尝试次数过多，请 ${remainMin} 分钟后重试 / Too many attempts, try again in ${remainMin} min`;
    }
  } catch {
    // Redis down — fail open (allow login)
  }
  return null;
}

async function recordFailedAttempt(email: string) {
  const key = `login_attempts:${email}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, LOCKOUT_SECONDS);
    }
  } catch {
    // Redis down — skip rate limiting
  }
}

async function clearFailedAttempts(email: string) {
  try {
    await redis.del(`login_attempts:${email}`);
  } catch {
    // Redis down — no-op
  }
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password || password.length < 6) {
    return { error: "请输入邮箱和密码（至少6位）/ Email and password required (min 6 chars)" };
  }

  // Rate limit check
  const rateLimitError = await checkRateLimit(email);
  if (rateLimitError) return { error: rateLimitError };

  const user = await prisma.user.findUnique({
    where: { email, deletedAt: null },
  });

  if (!user) {
    await recordFailedAttempt(email);
    return { error: "账号或密码错误 / Invalid credentials" };
  }

  const valid = await compare(password, user.passwordHash);
  if (!valid) {
    await recordFailedAttempt(email);
    return { error: "账号或密码错误 / Invalid credentials" };
  }

  // Clear failed attempts on success
  await clearFailedAttempts(email);

  const token = await createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });

  await setSessionCookie(token);
  redirect("/tasks");
}
