/**
 * 把 nitter 的推文链接转成官方 x.com 链接。
 *
 * nitter.net 是免费公共镜像，极不稳定（经常对代理出口返回空页），
 * 用户点击"原文"时不该再看到它。抓取层仍可保留 nitter（x.com 反爬抓不了
 * RSS），但所有展示给用户的链接统一走这里转换。
 *
 * 例：https://nitter.net/Phoenixyin13/status/2085009856222601513#m
 *   → https://x.com/Phoenixyin13/status/2085009856222601513
 */
export function originalUrl(url: string | null | undefined): string {
  if (!url) return "";
  const m = url.match(/nitter\.net\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
  if (m) return `https://x.com/${m[1]}/status/${m[2]}`;
  return url;
}
