"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { COOKIE, TTL_SECONDS, issue, passwordMatches } from "../../lib/auth.ts";

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const password = process.env.NORTHREAD_PASSWORD;
  const secret = process.env.NORTHREAD_SESSION_SECRET;
  if (!password || !secret) return "服务端没有配置 NORTHREAD_PASSWORD / NORTHREAD_SESSION_SECRET";

  const input = String(form.get("password") ?? "");
  if (!passwordMatches(input, password)) {
    // 失败时故意慢一点，让暴力猜测的成本变高
    await new Promise((r) => setTimeout(r, 800));
    return "密码不对";
  }

  (await cookies()).set(COOKIE, await issue(secret), {
    httpOnly: true,
    sameSite: "lax",
    // 反代做了 HTTPS 时才加 Secure，否则本机 http 访问会拿不到 cookie
    secure: process.env.NORTHREAD_HTTPS === "1",
    path: "/",
    maxAge: TTL_SECONDS,
  });

  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") ? next : "/");
}
