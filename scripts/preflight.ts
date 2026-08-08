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
