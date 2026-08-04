import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { Agent, type Dispatcher, ProxyAgent, request } from "undici";

/**
 * 按需提取文章正文。
 *
 * ingest 阶段不抽正文（只有摘要太薄的条目标 pending），所以首次打开阅读工作台时
 * 正文是空的。这个模块负责实时抓取原文 URL + Readability 提取正文。
 *
 * 网络部分和 fetchFeed 一致：走代理（HTTPS_PROXY）、手动跟重定向、用 request()
 * 而不是 fetch()——直连境外站点 DNS 都不通，且 fetch() 对某些站点会返回空 body。
 */

const UA = "Northread/0.1 (personal reading agent)";
const TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 5;
/** 少于这个字数视为提取失败，回退到摘要 */
const MIN_OK_CHARS = 200;

const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const dispatcher: Dispatcher = proxyUrl
  ? new ProxyAgent({ uri: proxyUrl, connectTimeout: TIMEOUT_MS })
  : new Agent({ connectTimeout: TIMEOUT_MS });

async function getHtml(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await request(current, {
      dispatcher,
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
      headersTimeout: TIMEOUT_MS,
      bodyTimeout: TIMEOUT_MS,
    });

    const loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
      await res.body.dump();
      current = new URL(Array.isArray(loc) ? loc[0] : loc, current).toString();
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`HTTP ${res.statusCode}`);
    }
    return await res.body.text();
  }
  throw new Error(`重定向超过 ${MAX_REDIRECTS} 次`);
}

export type ExtractResult =
  | { ok: true; text: string; wordCount: number; minutes: number }
  | { ok: false; error: string };

export async function extractArticleBody(url: string): Promise<ExtractResult> {
  try {
    const html = await getHtml(url);
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const text = (article?.textContent ?? "").trim();

    if (text.length < MIN_OK_CHARS) {
      return { ok: false, error: `提取到的正文太短（${text.length} 字），可能被站点反爬拦截` };
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    // 中文按 ~450 字/分钟、英文按 ~200 词/分钟折中
    const minutes = Math.max(1, Math.round(wordCount / 260));
    return { ok: true, text, wordCount, minutes };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
