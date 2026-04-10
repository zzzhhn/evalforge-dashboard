"use server";

import { prisma } from "@/lib/db";
import { createToken, setSessionCookie } from "@/lib/auth";
import { compare } from "bcryptjs";
import { redirect } from "next/navigation";

export interface LoginState {
  error?: string;
}

// In-memory rate limiter (per email)
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const failedAttempts = new Map<string, { count: number; firstAttempt: number }>();

function checkRateLimit(email: string): string | null {
  const entry = failedAttempts.get(email);
  if (!entry) return null;
  if (Date.now() - entry.firstAttempt > LOCKOUT_MS) {
    failedAttempts.delete(email);
    return null;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const remainMin = Math.ceil((LOCKOUT_MS - (Date.now() - entry.firstAttempt)) / 60000);
    return `登录尝试次数过多，请 ${remainMin} 分钟后重试 / Too many attempts, try again in ${remainMin} min`;
  }
  return null;
}

function recordFailedAttempt(email: string) {
  const entry = failedAttempts.get(email);
  if (entry) {
    entry.count++;
  } else {
    failedAttempts.set(email, { count: 1, firstAttempt: Date.now() });
  }
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "请输入邮箱和密码 / Email and password required" };
  }

  const rateLimitError = checkRateLimit(email);
  if (rateLimitError) return { error: rateLimitError };

  const user = await prisma.user.findUnique({
    where: { email, deletedAt: null },
  });

  if (!user) {
    recordFailedAttempt(email);
    return { error: "账号或密码错误 / Invalid credentials" };
  }

  const valid = await compare(password, user.passwordHash);
  if (!valid) {
    recordFailedAttempt(email);
    return { error: "账号或密码错误 / Invalid credentials" };
  }

  failedAttempts.delete(email);

  const token = await createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });

  await setSessionCookie(token);
  redirect("/tasks");
}
