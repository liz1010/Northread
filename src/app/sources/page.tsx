import { getSources } from "../../lib/queries.ts";

export const dynamic = "force-dynamic";

function weightLabel(w: number) {
  if (w === 0) return "静音";
  if (w <= 0.5) return "降权";
  if (w < 1.3) return "中性";
  if (w < 1.8) return "重要";
  return "核心";
}

export default async function Sources() {
  const sources = await getSources();
  const failed = sources.filter((s) => s.lastRun?.status === "error");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">信源</h1>
        <p className="mt-1 text-sm text-ink-500">
          {sources.length} 个 · 库存 {sources.reduce((a, s) => a + s.itemCount, 0)} 条
          {failed.length > 0 && (
            <span className="text-clay-700">　·　{failed.length} 个抓取失败</span>
          )}
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-ink-200 bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-[11px] tracking-wider text-ink-500">
              <th className="px-4 py-2.5 font-semibold">名称</th>
              <th className="px-2 py-2.5 font-semibold">权重</th>
              <th className="px-2 py-2.5 text-right font-semibold">周上限</th>
              <th className="px-2 py-2.5 text-right font-semibold">库存</th>
              <th className="px-2 py-2.5 text-right font-semibold">已推荐</th>
              <th className="px-4 py-2.5 font-semibold">状态</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-ink-100 last:border-0 align-top">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{s.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-ink-300">
                    <span>{s.lang === "zh" ? "中文" : "英文"}</span>
                    {s.fragile && <span className="text-clay-700">脆弱源</span>}
                    {s.bulkFeed && <span>存档型 feed</span>}
                  </div>
                  {s.note && (
                    <div className="mt-1 max-w-md text-[11px] leading-relaxed text-ink-500">
                      {s.note}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2.5 whitespace-nowrap">
                  <span className="tabular-nums">{s.globalWeight.toFixed(1)}</span>
                  <span className="ml-1 text-[11px] text-ink-300">{weightLabel(s.globalWeight)}</span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink-500">{s.maxPerWeek}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink-500">{s.itemCount}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-ink-500">{s.recCount}</td>
                <td className="px-4 py-2.5">
                  {s.lastRun?.status === "error" ? (
                    <div>
                      <span className="font-medium text-clay-700">失败</span>
                      <div className="mt-0.5 max-w-xs text-[11px] leading-relaxed text-ink-500">
                        {s.lastRun.error}
                      </div>
                    </div>
                  ) : s.lastRun ? (
                    <span className="text-ink-500">正常</span>
                  ) : (
                    <span className="text-ink-300">未抓取</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-ink-300">
        权重现在只能改 <code className="rounded bg-ink-100 px-1">seed/goals-and-sources.json</code>{" "}
        然后重跑 <code className="rounded bg-ink-100 px-1">npm run seed</code>。
        界面上直接改、以及「AI 建议调权重、你确认」那套流程还没做。
      </p>
    </div>
  );
}
