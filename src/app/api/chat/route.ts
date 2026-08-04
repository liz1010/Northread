import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { COOKIE, verify } from "../../../lib/auth.ts";
// 注意：不要在这里 import db —— build 收集路由数据时会加载模块顶层，
// 而 db/index.ts 顶层就 new Database() 连接 SQLite，会触发 SQLITE_BUSY。
// 所以 db 放在 POST 内部动态 import；schema 只是表定义，可以顶层引入。
import * as schema from "../../../db/schema.ts";

/**
 * AI 聊天接口（阅读工作台右栏）。
 *
 * POST /api/chat  body: { itemId, messages: [{role, content}] }
 * 返回 DeepSeek 的 SSE 流（text/event-stream），边生成边返回。
 *
 * 安全：middleware 已经放行 /api，所以这里必须自己校验会话——
 * 未登录一律 401。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { dailyRecommendations, goals, itemGoalScores, items, sources } = schema;

/** 塞给模型的正文上限。太长会超出上下文、也烧 token。 */
const MAX_BODY_CHARS = 14000;

type ChatMessage = { role: "user" | "assistant"; content: string };

function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export async function POST(req: Request) {
  // 动态导入，避免 build 收集路由数据时触发 SQLite 连接
  const { db } = await import("../../../db/index.ts");

  // ---- 会话校验 ----
  const secret = process.env.NORTHREAD_SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const cookies = parseCookies(req.headers.get("cookie") ?? "");
  const token = cookies[COOKIE];
  if (!token || !(await verify(secret, decodeURIComponent(token)))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- 解析请求 ----
  let body: { itemId?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(
      (m): m is ChatMessage =>
        !!m && typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  if (messages.length === 0) return NextResponse.json({ error: "bad request" }, { status: 400 });

  // ---- 读文章 + 推荐上下文 ----
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  let rec: (typeof dailyRecommendations.$inferSelect) | null = null;
  let goal: (typeof goals.$inferSelect) | null = null;
  let score: (typeof itemGoalScores.$inferSelect) | null = null;
  let source: (typeof sources.$inferSelect) | null = null;

  if (item.sourceId) {
    [source] = await db.select().from(sources).where(eq(sources.id, item.sourceId));
  }
  [rec] = await db
    .select()
    .from(dailyRecommendations)
    .where(eq(dailyRecommendations.itemId, itemId))
    .orderBy(desc(dailyRecommendations.date))
    .limit(1);
  if (rec) {
    [goal] = await db.select().from(goals).where(eq(goals.id, rec.goalId));
    [score] = await db
      .select()
      .from(itemGoalScores)
      .where(
        and(
          eq(itemGoalScores.itemId, itemId),
          eq(itemGoalScores.goalId, rec.goalId),
          eq(itemGoalScores.stage, "rerank"),
        ),
      )
      .limit(1);
  }

  // ---- 构建 system prompt（带上当前文章上下文） ----
  const bodyText = (item.contentText ?? item.summary ?? "").slice(0, MAX_BODY_CHARS);
  const system = [
    "你是 Northread 的 AI 阅读助手。用户在读下面这篇材料，你可以针对它回答问题。",
    "回答用中文（除非用户用其他语言提问）。要诚实：材料里没有的信息就直说没有，不要编造。",
    "可以总结、解释难点、回答疑问、联系用户目标、给出继续阅读的建议。",
    "不要替用户阅读全文——需要用户自己消化的部分，用问题引导。",
    "",
    "## 材料信息",
    `标题：${item.title ?? "（无标题）"}`,
    item.author ? `作者：${item.author}` : "",
    source?.name ? `来源：${source.name}` : "",
    item.publishedAt ? `发布时间：${new Date(item.publishedAt * 1000).toISOString().slice(0, 10)}` : "",
    item.url ? `原文链接：${item.url}` : "",
    "",
    rec?.reason ? `## 为什么推荐给用户\n${rec.reason}` : "",
    goal ? `## 关联目标\n${goal.title}` : "",
    score?.caveat ? `## 已知不足\n${score.caveat}` : "",
    "",
    "## 材料正文",
    bodyText || "（正文未能提取，只有上面的摘要。）",
  ]
    .filter(Boolean)
    .join("\n");

  // ---- 调 DeepSeek 流式 ----
  const baseUrl = (process.env.NORTHREAD_API_BASE ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const apiKey = process.env.NORTHREAD_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "model not configured" }, { status: 500 });
  const model = process.env.NORTHREAD_RERANK_MODEL ?? "deepseek-chat";

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: 0.7,
      max_tokens: 1500,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `upstream ${upstream.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  // 直接把 DeepSeek 的 SSE 流透传给前端
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
