import { getGoalsWithNodes } from "../../../lib/queries.ts";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { pending: "未开始", active: "进行中", done: "已补上" };

export default async function Goals() {
  const goals = await getGoalsWithNodes();
  const active = goals.filter((g) => g.status === "active");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">目标</h1>
        <p className="mt-1 text-sm text-ink-500">
          {active.length} 个进行中
          {active.length >= 3 && (
            <span className="text-clay-700">
              　·　已到上限。你说过最好只开 1–2 个，考虑暂停一个。
            </span>
          )}
        </p>
      </header>

      {goals.map((g) => (
        <section key={g.id} className="rounded-xl border border-ink-200 bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{g.title}</h2>
            <span className="shrink-0 rounded-full border border-ink-200 px-2 py-0.5 text-xs text-ink-500">
              {g.status === "active" ? "进行中" : "已暂停"}
            </span>
          </div>

          {g.why && <p className="mt-2 text-sm leading-relaxed text-ink-700">{g.why}</p>}

          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            {g.currentLevel && (
              <div>
                <dt className="font-semibold text-ink-500">当前水平</dt>
                <dd className="mt-0.5 leading-relaxed text-ink-700">{g.currentLevel}</dd>
              </div>
            )}
            {g.expectedOutput && (
              <div>
                <dt className="font-semibold text-ink-500">期望产出</dt>
                <dd className="mt-0.5 leading-relaxed text-ink-700">{g.expectedOutput}</dd>
              </div>
            )}
            {g.avoid && (
              <div>
                <dt className="font-semibold text-ink-500">不想看到</dt>
                <dd className="mt-0.5 leading-relaxed text-ink-700">{g.avoid}</dd>
              </div>
            )}
            <div>
              <dt className="font-semibold text-ink-500">已推荐</dt>
              <dd className="mt-0.5 text-ink-700">{g.recommended} 条</dd>
            </div>
          </dl>

          <div className="mt-5 border-t border-ink-200 pt-4">
            <h3 className="text-[11px] font-semibold tracking-wider text-ink-500">子目标</h3>
            {g.nodes.length === 0 ? (
              <div className="mt-2 rounded-lg border border-dashed border-ink-200 p-4">
                <p className="text-xs text-ink-500">还没有拆解。</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-300">
                  子目标由 AI 从大目标拆出来，拆到几层由模型决定。需要真模型——
                  Mock 拆不出有意义的结果，所以现在留空而不是塞占位内容。
                </p>
              </div>
            ) : (
              <ul className="mt-2 space-y-2">
                {g.nodes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-canvas p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium">{n.title}</span>
                      <span className="shrink-0 text-[11px] text-ink-500">
                        {STATUS[n.status] ?? n.status}
                        {n.createdBy === "user" && " · 手动添加"}
                      </span>
                    </div>
                    {n.why && <p className="mt-1 text-xs text-ink-500">{n.why}</p>}
                    {n.doneCriteria && (
                      <p className="mt-1 text-xs text-pine-700">
                        怎么算补上了：{n.doneCriteria}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
