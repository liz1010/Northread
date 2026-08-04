import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";

import { NextResponse } from "next/server";

import { COOKIE, verify } from "../../../lib/auth.ts";

/**
 * 一键刷新：重新抓取所有源 + 重新生成今日推荐。
 *
 * - POST /api/refresh  启动后台任务，立即返回；已有任务在跑则返回 busy。
 * - GET  /api/refresh  查询是否还在抓取（前端轮询用）。
 *
 * 后台任务通过标记文件 /srv/northread/data/.refresh-stage 表示"进行中"
 *（内容为 ingest / recommend 阶段），任务完成自动删除。
 * 前端轮询到 running=false 后调 router.refresh() 呈现新内容。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STAGE = "/srv/northread/data/.refresh-stage";
/** stage 文件超过这个时间仍存在 → 视为任务异常中断，前端不再等待 */
const STALE_MS = 10 * 60 * 1000;

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
  // 超时保护：任务异常中断时会残留 stage，超过 10 分钟视为失败并清理，
  // 避免前端永远显示"抓取中"。
  const age = Date.now() - statSync(STAGE).mtimeMs;
  if (age > STALE_MS) {
    try {
      rmSync(STAGE);
    } catch {
      /* ignore */
    }
    return NextResponse.json({ running: false, stage: null, stale: true });
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

  // setsid 让任务进入独立会话，完全脱离 Next server 进程，
  // 避免在 systemd/Next 环境下子进程被回收导致"stage 创建了但 ingest 没跑"。
  const proc = spawn("setsid", ["/bin/bash", "-c", cmd], {
    cwd: "/srv/northread",
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
  });
  proc.unref();
  proc.on("error", (e) => {
    console.error("[refresh] 启动后台任务失败:", e.message);
    try {
      rmSync(STAGE);
    } catch {
      /* ignore */
    }
  });

  return NextResponse.json({
    ok: true,
    busy: false,
    message: "已开始更新：正在重新抓取并生成推荐，完成后自动刷新",
  });
}
