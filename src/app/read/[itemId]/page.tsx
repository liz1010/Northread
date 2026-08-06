import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleContent } from "../../../components/ArticleContent.tsx";
import { ChatPanel } from "../../../components/ChatPanel.tsx";
import { getReadingContext } from "../../../lib/queries.ts";
import { originalUrl } from "../../../lib/urls.ts";

export const dynamic = "force-dynamic";

export default async function ReadPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const ctx = await getReadingContext(Number(itemId));
  if (!ctx) notFound();
  const { item, source } = ctx;

  const meta = [
    source?.name,
    item.author,
    item.readingMinutes ? `约 ${item.readingMinutes} 分钟` : null,
    item.publishedAt
      ? new Date(item.publishedAt * 1000).toLocaleDateString("zh-CN")
      : null,
  ].filter(Boolean);

  return (
    // 全屏阅读工作台：没有外层导航。宽屏两栏（lg）——左栏阅读区占满剩余宽度、
    // 右栏 AI 聊天；窄屏纵向堆叠。
    // 目标、推荐理由、评分、不足等线索主页卡片已有，这里不再重复。
    <div className="flex flex-col gap-4 p-4 lg:h-[calc(100vh-3rem)] lg:flex-row lg:gap-6 lg:p-6">
      {/* 左栏：文章正文（宽屏占满剩余宽度） */}
      <article className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-ink-200 bg-surface lg:h-auto">
        <div className="p-8">
          <Link
            href="/"
            className="mb-3 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
          >
            ← 返回今日
          </Link>
          <h1 className="text-2xl font-semibold leading-snug tracking-tight">{item.title}</h1>
          {meta.length > 0 && (
            <p className="mt-2 text-xs text-ink-500">{meta.join(" · ")}</p>
          )}
          {item.url && (
            <a
              href={originalUrl(item.url)}
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
            initialHtml={item.contentHtml}
          />
        </div>
      </article>

      {/* 右栏：AI 聊天。窄屏时全宽显示在文章下方，固定高度；宽屏时靠右占满 */}
      <aside className="w-full shrink-0 overflow-hidden rounded-xl border border-ink-200 bg-surface lg:w-80">
        <div className="h-[28rem] lg:h-full">
          <ChatPanel itemId={item.id} />
        </div>
      </aside>
    </div>
  );
}
