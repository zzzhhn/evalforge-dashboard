"use server";

import { prisma } from "@/lib/db";
import { createToken, setSessionCookie } from "@/lib/auth";
import { compare } from "bcryptjs";
import { redirect } from "next/navigation";

export interface LoginState {
  error?: string;
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

  const user = await prisma.user.findUnique({
    where: { email, deletedAt: null },
  });

  if (!user) {
    return { error: "账号或密码错误 / Invalid credentials" };
  }

  const valid = await compare(password, user.passwordHash);
  if (!valid) {
    return { error: "账号或密码错误 / Invalid credentials" };
  }

  const token = await createToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  });

  await setSessionCookie(token);
  redirect("/tasks");
}
