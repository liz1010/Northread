import { RecCard } from "../../components/RecCard.tsx";
import {
  getFailedSources,
  getFilterStats,
  getInventory,
  getTodayRecs,
  todayStr,
} from "../../lib/queries.ts";

export const dynamic = "force-dynamic";

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

export default async function Today() {
  const date = todayStr();
  const recs = await getTodayRecs(date);
  const stats = await getFilterStats(date);
  const failed = await getFailedSources();
  const inv = await getInventory();

  const daily = recs.filter((r) => r.slot === "daily");
  const deep = recs.filter((r) => r.slot === "weekend_deep");
  const d = new Date();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">今日</h1>
        <p className="mt-1 text-sm text-ink-500">
          {d.getMonth() + 1} 月 {d.getDate()} 日 星期{WEEKDAY[d.getDay()]}
          {stats.candidates > 0 && ` · 从 ${stats.candidates} 条候选里选出 ${daily.length} 条`}
        </p>
      </header>

      {stats.provider === "mock" && (
        <div className="rounded-lg border border-clay-700/30 bg-clay-100 p-3 text-xs leading-relaxed text-ink-700">
          <strong className="font-semibold">这批推荐由 Mock 生成，不是模型判断。</strong>
          它只做关键词匹配，不理解内容——用来验证链路能跑通，不能用来判断推荐质量。
          在 <code className="rounded bg-surface px-1">.env.local</code> 里填上{" "}
          <code className="rounded bg-surface px-1">ANTHROPIC_API_KEY</code> 后重跑{" "}
          <code className="rounded bg-surface px-1">npm run recommend</code> 即可切换。
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-lg border border-ink-200 bg-surface p-3 text-xs">
          <div className="mb-1 font-semibold">有 {failed.length} 个源抓取失败</div>
          <ul className="space-y-0.5 text-ink-500">
            {failed.map((f) => (
              <li key={f.sourceId}>
                {f.fragile && <span className="text-clay-700">脆弱源 </span>}
                {f.name}：{f.error}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-ink-300">
            这些源今天没有内容进入候选集。不是「今天没有好东西」，是抓不到。
          </p>
        </div>
      )}

      {daily.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center">
          <p className="text-sm text-ink-500">今天还没有推荐。</p>
          <p className="mt-2 text-xs text-ink-300">
            先跑 <code className="rounded bg-ink-100 px-1">npm run ingest</code> 抓取，再跑{" "}
            <code className="rounded bg-ink-100 px-1">npm run recommend</code> 生成。
          </p>
        </div>
      ) : (
        <section className="space-y-4">
          <h2 className="text-[11px] font-semibold tracking-wider text-ink-500">
            今天最值得读的
          </h2>
          {daily.map((r) => (
            <RecCard key={r.id} {...r} recId={r.id} deep={false} />
          ))}
        </section>
      )}

      {deep.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-[11px] font-semibold tracking-wider text-ink-500">
            周末深读
          </h2>
          <p className="-mt-2 text-xs text-ink-300">
            硬东西需要连续时间。工作日 2 小时启动不了，周末 6 小时可以。
          </p>
          {deep.map((r) => (
            <RecCard key={r.id} {...r} recId={r.id} deep />
          ))}
        </section>
      )}

      {stats.filtered > 0 && (
        <section className="rounded-xl border border-ink-200 bg-canvas p-4">
          <div className="text-sm font-semibold">今天过滤了 {stats.filtered} 条</div>
          <div className="mt-1 text-xs text-ink-500">
            {Object.entries(stats.reasons)
              .map(([why, n]) => `${n} 条 ${why}`)
              .join("  ·  ") || "（无明细）"}
          </div>
        </section>
      )}

      <footer className="border-t border-ink-200 pt-4">
        <p className="text-sm font-semibold">今天就到这里。</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          Northread 刻意隐藏了其余内容。这条线下面没有信息流，也没有未读数。
        </p>
        <p className="mt-3 text-[11px] text-ink-300">
          库存 {inv.total} 条 · 近 7 天 {inv.recent} 条 · 已推荐过 {inv.used} 条
        </p>
      </footer>
    </div>
  );
}
