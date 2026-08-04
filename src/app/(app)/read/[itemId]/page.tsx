import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatPanel } from "../../../../components/ChatPanel.tsx";
import { getReadingContext } from "../../../../lib/queries.ts";

export const dynamic = "force-dynamic";

/** 评分分项条。分数必须能展开，不能给裸分数。 */
function Meter({ label, v }: { label: string; v: number | null }) {
  const pct = v == null ? 0 : Math.max(0, Math.min(1, v)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] text-ink-500">{label}</span>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-ink-200">
        <span className="block h-full rounded-full bg-pine-700" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-[11px] tabular-nums text-ink-300">
        {v == null ? "—" : v.toFixed(2)}
      </span>
    </div>
  );
}

export default async function ReadPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const ctx = await getReadingContext(Number(itemId));
  if (!ctx) notFound();
  const { item, rec, goal, score, source } = ctx;

  const meta = [
    source?.name,
    item.author,
    item.readingMinutes ? `约 ${item.readingMinutes} 分钟` : null,
    item.publishedAt
      ? new Date(item.publishedAt * 1000).toLocaleDateString("zh-CN")
      : null,
  ].filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      {/* 左栏：目标线索 */}
      <aside className="w-60 shrink-0 space-y-3 overflow-y-auto pr-1">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
        >
          ← 返回今日
        </Link>

        {goal && (
          <section className="rounded-xl border border-ink-200 bg-surface p-4">
            <div className="text-[11px] font-semibold tracking-wide text-ink-500">关联目标</div>
            <div className="mt-1 text-sm font-semibold leading-snug">{goal.title}</div>
          </section>
        )}

        {rec?.reason && (
          <section className="rounded-xl border border-ink-200 bg-surface p-4">
            <div className="text-[11px] font-semibold tracking-wide text-ink-500">为什么推荐</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-700">{rec.reason}</p>
          </section>
        )}

        {score && (
          <section className="space-y-2 rounded-xl border border-ink-200 bg-surface p-4">
            <div className="text-[11px] font-semibold tracking-wide text-ink-500">评分构成</div>
            <Meter label="相关" v={score.relevance} />
            <Meter label="信源" v={score.sourceWeight} />
            <Meter label="补缺口" v={score.gapFit} />
            <Meter label="新颖" v={score.novelty} />
            <Meter label="成本" v={score.readingCost} />
          </section>
        )}

        {score?.caveat && (
          <section className="rounded-xl border border-clay-700/30 bg-clay-100 p-4">
            <div className="text-[11px] font-semibold tracking-wide text-clay-700">已知不足</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-700">{score.caveat}</p>
          </section>
        )}
      </aside>

      {/* 中栏：文章正文 */}
      <article className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-ink-200 bg-surface">
        <div className="p-8">
          <h1 className="text-2xl font-semibold leading-snug tracking-tight">{item.title}</h1>
          {meta.length > 0 && (
            <p className="mt-2 text-xs text-ink-500">{meta.join(" · ")}</p>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs text-pine-700 underline underline-offset-2 hover:text-pine-900"
            >
              查看原文 ↗
            </a>
          )}

          {item.contentText ? (
            <div className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-ink-900">
              {item.contentText}
            </div>
          ) : (
            <div className="mt-6 rounded-lg bg-canvas p-4 text-sm text-ink-500">
              <p className="font-semibold text-ink-700">正文未能提取</p>
              {item.summary && <p className="mt-1 text-xs leading-relaxed">{item.summary}</p>}
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-pine-700 underline"
                >
                  打开原文阅读 ↗
                </a>
              )}
            </div>
          )}
        </div>
      </article>

      {/* 右栏：AI 聊天 */}
      <aside className="w-80 shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-surface">
        <ChatPanel itemId={item.id} />
      </aside>
    </div>
  );
}
