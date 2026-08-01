import Parser from "rss-parser";
import { Agent, type Dispatcher, ProxyAgent, request } from "undici";

import { stripHtml } from "../text.ts";

const UA = "Northread/0.1 (personal reading agent)";
const TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 5;

/**
 * 走 undici 的 request() 而不是全局 fetch()。
 *
 * 这台机器必须走代理（直连连 DNS 都不通）。而 undici 的 fetch() 配合 ProxyAgent
 * 对某些站点会返回 HTTP 200 + 空 body——nitter 就是其中之一，实测 fetch() 拿到
 * 0 字节、request() 拿到 79994 字节。用 request() 绕开这个问题。
 */
const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const dispatcher: Dispatcher = proxyUrl
  ? new ProxyAgent({ uri: proxyUrl, connectTimeout: TIMEOUT_MS })
  : new Agent({ connectTimeout: TIMEOUT_MS });

/** request() 不自动跟随重定向，手动跟（Chips and Cheese 就是 301 → /feed）。 */
async function get(url: string): Promise<{ status: number; body: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await request(current, {
      dispatcher,
      headers: {
        "user-agent": UA,
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });

    const loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
      // 必须用 dump() 丢弃 body，destroy() 会触发未捕获的 UND_ERR_ABORTED
      await res.body.dump();
      current = new URL(Array.isArray(loc) ? loc[0] : loc, current).toString();
      continue;
    }
    return { status: res.statusCode, body: await res.body.text() };
  }
  throw new Error(`重定向超过 ${MAX_REDIRECTS} 次`);
}

export type RawItem = {
  url: string;
  title: string;
  author?: string;
  publishedAt?: number;
  summary?: string;
};

export type FeedResult = {
  ok: boolean;
  httpStatus?: number;
  items: RawItem[];
  /** feed 里原本有多少条（截断前） */
  seen: number;
  error?: string;
};

const parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: { "User-Agent": UA },
  customFields: { item: [["content:encoded", "contentEncoded"]] },
});

/**
 * 抓一个 RSS/Atom 源。
 *
 * bulkFeed 的源（OpenAI News 1105 条、HuggingFace 834 条）返回的是全站存档，
 * 不截断会直接淹掉候选集。所有源统一按发布时间倒序取最新 N 条。
 */
export async function fetchFeed(
  url: string,
  opts: { maxItems: number; bulkFeed?: boolean; retries?: number },
): Promise<FeedResult> {
  const limit = opts.bulkFeed ? Math.min(opts.maxItems, 10) : opts.maxItems;
  const attempts = (opts.retries ?? 0) + 1;

  let xml = "";
  let httpStatus: number | undefined;
  let lastError = "";

  // 脆弱源（nitter 镜像）和这台机器上时好时坏的代理都会偶发失败，
  // 重试一两次能救回大部分。指数退避，避免加剧限流。
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * 2 ** (attempt - 1)));

    try {
      const res = await get(url);
      httpStatus = res.status;
      if (res.status < 200 || res.status >= 300) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const body = res.body;
      // 代理错误页和限流页都会以 200 返回 HTML，先挡一道再交给解析器
      if (!/^\s*(<\?xml|<rss|<feed|<rdf)/i.test(body)) {
        const head = body.replace(/\s+/g, " ").trim().slice(0, 120);
        lastError = `返回的不是 feed（可能是代理错误页或限流页）：${head}`;
        continue;
      }
      xml = body;
      lastError = "";
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  if (!xml) {
    return { ok: false, httpStatus, items: [], seen: 0, error: lastError || "未知错误" };
  }

  let feed: Awaited<ReturnType<Parser["parseString"]>>;
  try {
    feed = await parser.parseString(xml);
  } catch (e) {
    return {
      ok: false,
      httpStatus,
      items: [],
      seen: 0,
      error: `解析失败: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const all = (feed.items ?? [])
    .map((it): RawItem | null => {
      const link = it.link?.trim();
      const title = (it.title ?? "").trim();
      if (!link || !title) return null;

      const ts = it.isoDate ?? it.pubDate;
      const publishedAt = ts ? Math.floor(new Date(ts).getTime() / 1000) : undefined;

      // 优先用全文字段，退回摘要。这里只留一段——正文等过了初筛再抽。
      const rawSummary =
        (it as Record<string, unknown>).contentEncoded ??
        it.contentSnippet ??
        it.content ??
        it.summary ??
        "";
      const summary = stripHtml(String(rawSummary)).slice(0, 1200);

      return {
        url: link,
        title,
        author: it.creator ?? (it as Record<string, unknown>).author as string | undefined,
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
        summary: summary || undefined,
      };
    })
    .filter((x): x is RawItem => x !== null);

  // 有时间的排前面按时间倒序；没时间的保持 feed 原有顺序（通常也是新的在前）
  const sorted = [...all].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

  return { ok: true, httpStatus, items: sorted.slice(0, limit), seen: all.length };
}
