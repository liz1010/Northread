import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { COOKIE, verify } from "../../../lib/auth.ts";

/**
 * 一键刷新：重新抓取所有源 + 重新生成今日推荐。
 *
 * - POST /api/refresh  启动后台任务，立即返回；已有任务在跑则返回 busy。
 * - GET  /api/refresh  查询是否还在抓取（前端轮询用）。
 *
 * 后台任务通过标记文件 /srv/northread/data/.refresh-running 表示"进行中"，
 * 任务完成自动删除。前端轮询到 running=false 后调 router.refresh() 呈现新内容。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGE = "/srv/northread/data/.refresh-stage";

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function authorized(req: Request): Promise<boolean> {
  const secret = process.env.NORTHREAD_SESSION_SECRET;
  if (!secret) return false;
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  const token = cookies[COOKIE];
  return !!token && (await verify(secret, decodeURIComponent(token)));
}

/** 查询抓取状态：running + 当前阶段（ingest / recommend） */
export async function GET(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!existsSync(STAGE)) {
    return NextResponse.json({ running: false, stage: null });
  }
  const stage = readFileSync(STAGE, "utf8").trim();
  return NextResponse.json({ running: true, stage: stage || "ingest" });
}

/** 启动后台抓取 + 推荐 */
export async function POST(req: Request) {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 已有任务在跑就不重复启动
  if (existsSync(STAGE)) {
    return NextResponse.json({ ok: true, busy: true, message: "正在抓取中…" });
  }

  const cmd = [
    "set -a",
    ". .env.production",
    "set +a",
    `printf 'ingest' > ${STAGE}`,
    "node scripts/ingest.ts >> /var/log/northread/ingest.log 2>&1",
    `printf 'recommend' > ${STAGE}`,
    "node scripts/recommend.ts >> /var/log/northread/recommend.log 2>&1",
    `rm -f ${STAGE}`,
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
    busy: false,
    message: "已开始更新：正在重新抓取并生成推荐，完成后自动刷新",
  });
}
