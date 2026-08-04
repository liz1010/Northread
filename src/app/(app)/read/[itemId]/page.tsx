import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleContent } from "../../../../components/ArticleContent.tsx";
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
    // 响应式：宽屏三栏横排（lg），窄屏纵向堆叠——保证聊天框在窄窗口下也可见
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-7rem)] lg:flex-row">
      {/* 左栏：目标线索 */}
      <aside className="w-full shrink-0 space-y-3 lg:w-60 lg:overflow-y-auto lg:pr-1">
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
      <article className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-ink-200 bg-surface lg:h-auto">
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

          {/* 正文：为空时自动实时拉取全文（ArticleContent 调 /api/extract） */}
          <ArticleContent
            itemId={item.id}
            url={item.url}
            summary={item.summary}
            initialText={item.contentText}
          />
        </div>
      </article>

      {/* 右栏：AI 聊天。窄屏时全宽显示在文章下方，固定高度；宽屏时靠右占满 */}
      <aside className="w-full shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-surface lg:w-72">
        <div className="h-[28rem] lg:h-full">
          <ChatPanel itemId={item.id} />
        </div>
      </aside>
    </div>
  );
}
