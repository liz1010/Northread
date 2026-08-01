/** 生成今日推荐。可以挂 cron，也可以手动跑。 */
import { generateToday } from "../src/lib/pipeline/recommend.ts";

const dry = process.argv.includes("--dry");
const r = await generateToday({ dryRun: dry });

console.log(`\n${r.date}${r.weekend ? "（周末）" : "（工作日）"}  provider=${r.provider}${dry ? "  [dry-run 不落库]" : ""}`);
console.log(`候选 ${r.candidates} 条 → 初筛留下 ${r.keptByPrefilter} 条 → 过滤掉 ${r.filtered} 条`);

const reasons = Object.entries(r.filterReasons).sort((a, b) => b[1] - a[1]).slice(0, 4);
if (reasons.length) {
  console.log("主要过滤原因：");
  for (const [why, n] of reasons) console.log(`  ${n} 条  ${why}`);
}

console.log("\n今天最值得读的：");
for (const p of r.picks) {
  console.log(`\n  【${p.goal}】${p.score} 分`);
  console.log(`  ${p.title}`);
  console.log(`  来源：${p.source}`);
  console.log(`  ${p.reason}`);
}

if (r.deepRead.length) {
  console.log("\n周末深读：");
  for (const d of r.deepRead) console.log(`  【${d.goal}】${d.title}  —— ${d.source}`);
}

if (!r.picks.length) console.log("  （没有推荐。候选集可能已被推荐过，或初筛全部过滤。）");
