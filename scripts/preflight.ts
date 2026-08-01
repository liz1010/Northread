/**
 * 启动前检查。systemd 用 ExecStartPre 调它——配错了就别起来，
 * 好过起来之后静默跑在错误状态上。
 *
 * 最要命的一种情况：NORTHREAD_API_KEY 没读到，getProvider() 静默退回 Mock。
 * 界面每天照常更新，推荐全是关键词匹配的结果，你可能几周都发现不了。
 */
const problems: string[] = [];
const warnings: string[] = [];

const isProd = process.env.NODE_ENV === "production";

// ---- 访问控制 ----
const pw = process.env.NORTHREAD_PASSWORD;
const secret = process.env.NORTHREAD_SESSION_SECRET;
if (isProd) {
  if (!pw) problems.push("NORTHREAD_PASSWORD 没设——公网上任何人都能读你的目标和阅读记录");
  if (!secret) problems.push("NORTHREAD_SESSION_SECRET 没设——会话 cookie 无法签名");
  if (secret && secret.length < 32)
    problems.push("NORTHREAD_SESSION_SECRET 太短，至少 32 字符：openssl rand -hex 32");
  if (pw && pw.length < 8) warnings.push("NORTHREAD_PASSWORD 短于 8 位，容易被猜");
  if (process.env.NORTHREAD_HTTPS !== "1")
    warnings.push("NORTHREAD_HTTPS 不是 1——cookie 不会带 Secure 标记，装了 HTTPS 后记得改");
}

// ---- 模型 ----
if (process.env.NORTHREAD_USE_MOCK === "1") {
  warnings.push("NORTHREAD_USE_MOCK=1：推荐由关键词匹配产生，不是模型判断");
} else if (!process.env.NORTHREAD_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  problems.push(
    "没有配置任何模型 key。程序不会崩，但会静默退回 Mock —— " +
      "这是最难发现的一种故障，所以这里直接拦下。要跑 Mock 请显式设 NORTHREAD_USE_MOCK=1",
  );
}

// ---- 存储 ----
const db = process.env.NORTHREAD_DB ?? "./data/northread.db";
if (isProd && !db.startsWith("/"))
  warnings.push(`NORTHREAD_DB 用的是相对路径（${db}），重新部署时容易被覆盖，建议改成绝对路径`);

// ---- 监听 ----
if (isProd && (process.env.HOSTNAME ?? "") !== "0.0.0.0")
  warnings.push("HOSTNAME 不是 0.0.0.0，外部访问不到");

for (const w of warnings) console.warn(`⚠ ${w}`);
if (problems.length) {
  console.error("\n启动前检查没通过：");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log(`✓ 启动前检查通过（${warnings.length} 条提醒）`);
