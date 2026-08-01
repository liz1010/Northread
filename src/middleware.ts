import { NextResponse, type NextRequest } from "next/server";

import { COOKIE, verify } from "./lib/auth.ts";

/**
 * 挡住所有页面。没配密码时直接放行——本机开发不该被拦，
 * 但生产环境启动脚本会检查这两个变量，缺了就拒绝启动。
 */
export async function middleware(req: NextRequest) {
  const password = process.env.NORTHREAD_PASSWORD;
  const secret = process.env.NORTHREAD_SESSION_SECRET;
  if (!password || !secret) return NextResponse.next();

  if (await verify(secret, req.cookies.get(COOKIE)?.value)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = req.nextUrl.pathname === "/" ? "" : `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // 登录页、静态资源、favicon 不拦
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
