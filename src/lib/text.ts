import { createHash } from "node:crypto";

/** URL 里常见的追踪参数，去重前先剥掉 */
const TRACKING_PARAMS = [
  /^utm_/,
  /^ref$/,
  /^ref_src$/,
  /^referrer$/,
  /^fbclid$/,
  /^gclid$/,
  /^mc_cid$/,
  /^mc_eid$/,
  /^source$/,
  /^__twitter_impression$/,
  /^s$/, // twitter/x 的 ?s=20
];

/**
 * 规范化 URL，用作去重主键。
 * 同一篇文章从不同渠道拿到时，URL 往往只差追踪参数。
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";

    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    u.searchParams.sort();

    // 去掉末尾斜杠（根路径除外）
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/**
 * 标题指纹。用于发现跨源转载——同一篇东西被多个源转的情况很常见，
 * 尤其是 36氪 / InfoQ 这类媒体转 SemiAnalysis。
 */
export function titleFingerprint(title: string): string {
  const norm = title
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    // 中英文标点一起剥
    .replace(/[!-/:-@[-`{-~　-〿＀-￯]/g, "");
  return sha(norm);
}

/** 正文指纹。取归一化后的前 2000 字，够区分且不受尾部差异影响。 */
export function contentFingerprint(text: string): string {
  const norm = text.replace(/\s+/g, " ").trim().slice(0, 2000);
  return norm.length < 80 ? "" : sha(norm);
}

/** CJK 字符占比。中英文的阅读速度差一倍多，得分开算。 */
export function cjkRatio(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[一-鿿぀-ヿ가-힯]/g)?.length ?? 0;
  return cjk / text.length;
}

export function detectLang(text: string): "zh" | "en" {
  return cjkRatio(text) > 0.15 ? "zh" : "en";
}

/**
 * 估算阅读时长。
 * 中文按 400 字/分钟，英文按 240 词/分钟——都是偏慢的值，
 * 因为这个工具推的是需要动脑的内容，不是刷资讯。
 */
export function estimateReading(text: string): {
  wordCount: number;
  minutes: number;
} {
  if (!text) return { wordCount: 0, minutes: 0 };
  const ratio = cjkRatio(text);
  if (ratio > 0.15) {
    const chars = text.replace(/\s/g, "").length;
    return { wordCount: chars, minutes: Math.max(1, Math.round(chars / 400)) };
  }
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return { wordCount: words, minutes: Math.max(1, Math.round(words / 240)) };
}

/**
 * 收窄标题。
 * 有些源（nitter 尤其明显）把整条正文塞进 <title>，实测有 1991 字的。
 * 界面上放不下，评分时也没必要重复一遍摘要。
 */
export function trimTitle(raw: string, max = 120): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // 优先在句末断开，中英文标点都试
  const cut = t.slice(0, max);
  const stop = Math.max(
    cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"),
    cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "),
  );
  return stop > max * 0.4 ? t.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

/** 把 HTML 摘要压成纯文本 */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}
