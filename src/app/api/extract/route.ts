import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { COOKIE, verify } from "../../../lib/auth.ts";
import { extractArticleBody } from "../../../lib/extract.ts";
// 与 /api/chat 同理：不要顶层 import db（build 收集路由数据会触发 SQLite 连接），
// db 放在请求内动态 import。
import * as schema from "../../../db/schema.ts";

/**
 * 按需提取正文。
 *
 * POST /api/extract  body: { itemId }
 * 正文为空时，服务器实时抓取原文 URL + Readability 提取，存库并返回。
 * 已有正文则直接返回缓存。用于阅读工作台首次打开时拉全文。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { items } = schema;

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

  let body: { itemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const itemId = Number(body.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { db } = await import("../../../db/index.ts");
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 已有富文本 HTML 直接返回缓存；
  // 只有纯文本说明是旧版本提取的（还没 HTML），重新提取以拿到富文本排版。
  if (item.contentHtml && item.contentText && item.contentText.length >= 200) {
    return NextResponse.json({
      contentText: item.contentText,
      contentHtml: item.contentHtml ?? null,
      wordCount: item.wordCount,
      readingMinutes: item.readingMinutes,
      cached: true,
    });
  }

  const result = await extractArticleBody(item.url);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await db
    .update(items)
    .set({
      contentText: result.text,
      contentHtml: result.html || null,
      wordCount: result.wordCount,
      readingMinutes: result.minutes,
      extractStatus: "ok",
      extractError: null,
    })
    .where(eq(items.id, itemId));

  return NextResponse.json({
    contentText: result.text,
    contentHtml: result.html || null,
    wordCount: result.wordCount,
    readingMinutes: result.minutes,
    cached: false,
  });
}
