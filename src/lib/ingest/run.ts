import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "../../db/index.ts";
import {
  canonicalizeUrl,
  contentFingerprint,
  detectLang,
  titleFingerprint,
  trimTitle,
} from "../text.ts";
import { fetchFeed } from "./fetchFeed.ts";

const { fetchRuns, items, sources } = schema;

export type SourceReport = {
  source: string;
  ok: boolean;
  seen: number;
  kept: number;
  inserted: number;
  dupUrl: number;
  dupTitle: number;
  dupContent: number;
  error?: string;
  fragile: boolean;
};

const nowSec = () => Math.floor(Date.now() / 1000);

/** 限制并发，避免同时打开几十个连接把代理打爆 */
async function pool<T, R>(list: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, list.length) }, async () => {
      while (cursor < list.length) {
        const i = cursor++;
        out[i] = await fn(list[i]);
      }
    }),
  );
  return out;
}

export async function ingestAll(opts: { maxItemsPerSource?: number } = {}) {
  const maxItems =
    opts.maxItemsPerSource ?? Number(process.env.NORTHREAD_MAX_ITEMS_PER_SOURCE ?? 30);

  const active = await db.select().from(sources).where(eq(sources.status, "active"));

  const reports = await pool(active, 6, async (src): Promise<SourceReport> => {
    const started = nowSec();
    const base = { source: src.name, fragile: src.fragile };

    // 脆弱源多给两次机会——nitter 和这台机器上的代理都会偶发失败
    const res = await fetchFeed(src.url, {
      maxItems,
      bulkFeed: src.bulkFeed,
      retries: src.fragile ? 2 : 1,
    });

    if (!res.ok) {
      await db.insert(fetchRuns).values({
        sourceId: src.id,
        startedAt: started,
        finishedAt: nowSec(),
        status: "error",
        httpStatus: res.httpStatus,
        itemsSeen: res.seen,
        itemsNew: 0,
        error: res.error,
      });
      return { ...base, ok: false, seen: res.seen, kept: 0, inserted: 0, dupUrl: 0, dupTitle: 0, dupContent: 0, error: res.error };
    }

    // ---- 去重 ----
    // 第一层：URL 规范化后查库
    const candidates = res.items.map((it) => ({
      ...it,
      canonicalUrl: canonicalizeUrl(it.url),
    }));

    const urls = candidates.map((c) => c.canonicalUrl);
    const existing = urls.length
      ? await db
          .select({ canonicalUrl: items.canonicalUrl })
          .from(items)
          .where(inArray(items.canonicalUrl, urls))
      : [];
    const seenUrls = new Set(existing.map((r) => r.canonicalUrl));

    let dupUrl = 0;
    let dupTitle = 0;
    let dupContent = 0;
    let inserted = 0;

    // 同一批里也可能重复（feed 自身有重复条目）
    const batchUrls = new Set<string>();

    for (const c of candidates) {
      if (seenUrls.has(c.canonicalUrl) || batchUrls.has(c.canonicalUrl)) {
        dupUrl++;
        continue;
      }
      batchUrls.add(c.canonicalUrl);

      const title = trimTitle(c.title);
      const tHash = titleFingerprint(title);
      // 第二层：标题指纹。跨源转载在这里被拦下。
      const sameTitle = await db
        .select({ id: items.id })
        .from(items)
        .where(eq(items.titleHash, tHash))
        .limit(1);
      if (sameTitle.length) {
        dupTitle++;
        continue;
      }

      const text = c.summary ?? "";
      const cHash = contentFingerprint(text);
      // 第三层：正文指纹。标题被改过但内容一样的洗稿在这里被拦下。
      if (cHash) {
        const sameContent = await db
          .select({ id: items.id })
          .from(items)
          .where(eq(items.contentHash, cHash))
          .limit(1);
        if (sameContent.length) {
          dupContent++;
          continue;
        }
      }

      await db.insert(items).values({
        sourceId: src.id,
        url: c.url,
        canonicalUrl: c.canonicalUrl,
        title,
        author: c.author,
        publishedAt: c.publishedAt,
        summary: text || null,
        lang: text ? detectLang(text) : src.lang,
        // 阅读时长必须等抽到正文再算。
        // 用摘要算出来的全是 1-2 分钟，而这个数既要显示在界面上、
        // 又要参与「阅读成本」评分——错的数比没有数更糟。
        wordCount: null,
        readingMinutes: null,
        contentHash: cHash || null,
        titleHash: tHash,
        // 摘要太薄的条目，初筛等于闭着眼判断，必须先抽正文。
        // 其余的等过了初筛再按需抽——见 §6.1。
        extractStatus: text.length < 200 ? "pending" : "skipped",
      });
      inserted++;
    }

    await db.insert(fetchRuns).values({
      sourceId: src.id,
      startedAt: started,
      finishedAt: nowSec(),
      status: "ok",
      httpStatus: res.httpStatus,
      itemsSeen: res.seen,
      itemsNew: inserted,
    });
    await db.update(sources).set({ lastFetchedAt: nowSec() }).where(eq(sources.id, src.id));

    return {
      ...base,
      ok: true,
      seen: res.seen,
      kept: res.items.length,
      inserted,
      dupUrl,
      dupTitle,
      dupContent,
    };
  });

  return reports;
}
