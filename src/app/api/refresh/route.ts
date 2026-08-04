import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { COOKIE, verify } from "../../../lib/auth.ts";

/**
 * 一键刷新：重新抓取所有源 + 重新生成今日推荐。
 *
 * 抓取和推荐耗时长（1~2 分钟），所以这里异步启动后台进程立即返回，
 * 前端提示用户稍后刷新查看。任务日志写到 /var/log/northread/。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function POST(req: Request) {
  const secret = process.env.NORTHREAD_SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  const token = cookies[COOKIE];
  if (!token || !(await verify(secret, decodeURIComponent(token)))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cmd = [
    "set -a",
    ". .env.production",
    "set +a",
    "node scripts/ingest.ts >> /var/log/northread/ingest.log 2>&1",
    "node scripts/recommend.ts >> /var/log/northread/recommend.log 2>&1",
    "echo REFRESH_DONE >> /var/log/northread/refresh.log",
  ].join(" && ");

  const proc = spawn("/bin/bash", ["-c", cmd], {
    // 服务以 northread 用户运行，子进程继承同一用户与工作目录
    cwd: "/srv/northread",
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
  });
  proc.unref();

  return NextResponse.json({
    ok: true,
    message: "已开始更新：重新抓取 + 重新生成推荐，约 1~2 分钟后刷新查看",
  });
}
