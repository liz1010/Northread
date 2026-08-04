"use client";

import { useEffect, useState } from "react";

/**
 * 阅读工作台的文章正文。
 *
 * 若 items.contentText 为空（ingest 阶段不抽正文），打开时自动调 /api/extract
 * 实时抓取原文 + Readability 提取，存库并显示。之后再次打开走缓存。
 */
export function ArticleContent({
  itemId,
  url,
  summary,
  initialText,
  initialHtml,
}: {
  itemId: number;
  url: string;
  summary: string | null;
  initialText: string | null;
  initialHtml: string | null;
}) {
  const [text, setText] = useState<string | null>(initialText);
  const [html, setHtml] = useState<string | null>(initialHtml);
  const [loading, setLoading] = useState(initialText ? false : true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (text) return; // 已有正文，直接用
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j?.contentText) {
          if (!cancelled) setError(j?.error ?? `提取失败（${res.status}）`);
          return;
        }
        if (!cancelled) {
          setText(j.contentText);
          if (j.contentHtml) setHtml(j.contentHtml);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, text]);

  // 优先富文本 HTML（保留段落/标题/列表/引用/代码排版）
  if (html) {
    return (
      <div
        className="article-body mt-6"
        // Readability 已剥离 script/style/iframe 等危险元素，可安全渲染
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (text) {
    return (
      <div className="mt-6 whitespace-pre-wrap text-[15px] leading-7 text-ink-900">
        {text}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-6 rounded-lg bg-canvas p-4 text-sm text-ink-500">
        <p className="animate-pulse font-medium text-ink-700">
          正在抓取正文…（首次打开需要几秒，之后会缓存）
        </p>
        {summary && (
          <p className="mt-2 text-xs leading-relaxed text-ink-400">摘要：{summary}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg bg-canvas p-4 text-sm text-ink-500">
      <p className="font-semibold text-ink-700">正文提取失败</p>
      {error && <p className="mt-1 text-xs text-clay-700">{error}</p>}
      {summary && <p className="mt-2 text-xs leading-relaxed">{summary}</p>}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-block text-xs text-pine-700 underline"
      >
        打开原文阅读 ↗
      </a>
    </div>
  );
}
