/**
 * 极简会话。够用的理由：单用户、单机、只挡住扫端口的人。
 *
 * 不用 JWT / next-auth 这类东西——它们解决的是多用户、第三方登录、
 * 权限分级的问题，这里一个都没有，引进来只是增加依赖和配置面。
 *
 * 用 Web Crypto 而不是 node:crypto：middleware 跑在 edge runtime，
 * 拿不到 node 内置模块。
 */

export const COOKIE = "nr_session";
const TTL_DAYS = 30;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64url(new Uint8Array(sig));
}

/** 签发一个带过期时间的会话值 */
export async function issue(secret: string): Promise<string> {
  const exp = String(Date.now() + TTL_DAYS * 86400_000);
  return `${exp}.${await hmac(secret, exp)}`;
}

/** 校验会话值。过期或签名不对都返回 false。 */
export async function verify(secret: string, value: string | undefined): Promise<boolean> {
  if (!value) return false;
  const dot = value.lastIndexOf(".");
  if (dot < 1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;

  const expected = await hmac(secret, exp);
  // 定长比较，避免通过响应时间猜签名
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

/** 密码比较也要定长，理由同上 */
export function passwordMatches(input: string, expected: string): boolean {
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export const TTL_SECONDS = TTL_DAYS * 86400;
