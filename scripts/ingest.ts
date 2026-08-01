/** 抓取所有活跃信源。可以挂进 crontab，也可以手动跑。 */
import { ingestAll } from "../src/lib/ingest/run.ts";

const t0 = Date.now();
const reports = await ingestAll();

const ok = reports.filter((r) => r.ok);
const failed = reports.filter((r) => !r.ok);

const pad = (s: string, n: number) => {
  // 中文字符占两个终端列宽
  const w = [...s].reduce((a, c) => a + (/[一-鿿（）]/.test(c) ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - w));
};

console.log("\n源                                    看到  留下  入库   URL重  标题重  正文重");
console.log("─".repeat(82));
for (const r of [...ok].sort((a, b) => b.inserted - a.inserted)) {
  console.log(
    pad(r.source, 36) +
      String(r.seen).padStart(4) +
      String(r.kept).padStart(6) +
      String(r.inserted).padStart(6) +
      String(r.dupUrl).padStart(7) +
      String(r.dupTitle).padStart(7) +
      String(r.dupContent).padStart(7),
  );
}

if (failed.length) {
  console.log("\n失败的源:");
  for (const r of failed) {
    console.log(`  ${r.fragile ? "⚠ 脆弱源 " : ""}${r.source}: ${r.error}`);
  }
}

const sum = (f: (r: (typeof reports)[number]) => number) => reports.reduce((a, r) => a + f(r), 0);
console.log(
  `\n${ok.length}/${reports.length} 个源成功，` +
    `新入库 ${sum((r) => r.inserted)} 条，` +
    `去重挡掉 ${sum((r) => r.dupUrl + r.dupTitle + r.dupContent)} 条，` +
    `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
