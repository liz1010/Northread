"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { submitFeedback, setState } from "../app/actions.ts";
import { FEEDBACK_KINDS, type FeedbackKind } from "../lib/feedback.ts";

type Score = {
  score: number | null;
  relevance: number | null;
  sourceWeight: number | null;
  gapFit: number | null;
  novelty: number | null;
  readingCost: number | null;
};

type Props = {
  recId: number;
  itemId: number;
  title: string;
  url: string;
  summary: string | null;
  sourceName: string | null;
  sourceFragile: boolean | null;
  goalTitle: string;
  nodeTitle: string | null;
  reason: string | null;
  confidence: string | null;
  readingAdvice: string | null;
  caveat: string | null;
  readingMinutes: number | null;
  scaffold: { prereq?: string[]; questions?: string[]; selfCheck?: string[] } | null;
  score: Score | null;
  state: string;
  feedback: string[];
  deep?: boolean;
};

const CONF: Record<string, string> = { low: "低", medium: "中", high: "高" };

/** 分项条。评分必须能展开——产品愿景 §5.2.1 反对不可见的单一分数。 */
function Meter({ label, v }: { label: string; v: number | null }) {
  const pct = v == null ? 0 : Math.max(0, Math.min(1, v)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] text-ink-500">{label}</span>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-ink-200">
        <span className="block h-full rounded-full bg-ink-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 text-[11px] tabular-nums text-ink-300">
        {v == null ? "—" : v.toFixed(2)}
      </span>
    </div>
  );
}

export function RecCard(p: Props) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const given = new Set(p.feedback);

  const act = (fn: () => Promise<void>) => start(() => void fn());

  return (
    <article
      className={`rounded-xl border bg-surface p-5 ${
        p.deep ? "border-pine-700/40" : "border-ink-200"
      } ${p.state === "abandoned" ? "opacity-60" : ""}`}
    >
      {/* 目标线索 —— pine 表示「这条内容为什么和你的目标有关」 */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-pine-100 px-2 py-0.5 font-medium text-pine-700">
          {p.goalTitle}
        </span>
        {p.nodeTitle && (
          <>
            <span className="text-ink-300">→</span>
            <span className="rounded-full border border-ink-200 px-2 py-0.5 text-ink-500">
              {p.nodeTitle}
            </span>
          </>
        )}
        {p.deep && (
          <span className="rounded-full border border-pine-700/40 px-2 py-0.5 text-pine-700">
            周末深读
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-serif text-lg leading-snug font-semibold">
            <Link href={`/read/${p.itemId}`} className="hover:underline">
              {p.title}
            </Link>
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                title="查看原文"
                className="ml-2 align-middle text-xs text-ink-300 hover:text-ink-500"
              >
                ↗
              </a>
            )}
          </h3>
          <p className="mt-1 text-xs text-ink-500">
            {p.sourceName ?? "手动添加"}
            {p.sourceFragile && <span className="ml-1 text-ink-300">（脆弱源）</span>}
            {p.readingMinutes ? ` · ${p.readingMinutes} 分钟` : " · 时长待定"}
          </p>
        </div>

        {/* 陶土 3 / 5 —— 目标匹配分 */}
        {p.score?.score != null && (
          <div className="shrink-0 text-right">
            <div className="text-2xl font-semibold tabular-nums text-clay-700">
              {Math.round(p.score.score)}
            </div>
            <div className="text-[10px] tracking-wider text-ink-500">目标匹配</div>
          </div>
        )}
      </div>

      {p.reason && <p className="mt-3 text-sm leading-relaxed text-ink-700">{p.reason}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
        {p.readingAdvice && (
          <span className="rounded-full bg-pine-100 px-2 py-0.5 font-medium text-pine-700">
            {p.readingAdvice}
          </span>
        )}
        {p.confidence && <span>置信度 {CONF[p.confidence] ?? p.confidence}</span>}
        {p.caveat && <span className="text-ink-500">不足：{p.caveat}</span>}
      </div>

      {/* 脚手架 —— 难度不降，支撑要给 */}
      {p.scaffold && (p.scaffold.prereq?.length || p.scaffold.questions?.length || p.scaffold.selfCheck?.length) ? (
        <div className="mt-4 rounded-lg bg-canvas p-3">
          {!!p.scaffold.prereq?.length && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold tracking-wider text-ink-500">
                读之前需要先懂
              </div>
              <ul className="space-y-0.5 text-xs text-ink-700">
                {p.scaffold.prereq.map((x, i) => (
                  <li key={i}>· {x}</li>
                ))}
              </ul>
            </div>
          )}
          {!!p.scaffold.questions?.length && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold tracking-wider text-ink-500">
                带着这些问题读
              </div>
              <ul className="space-y-0.5 text-xs text-ink-700">
                {p.scaffold.questions.map((x, i) => (
                  <li key={i}>· {x}</li>
                ))}
              </ul>
            </div>
          )}
          {!!p.scaffold.selfCheck?.length && (
            <div>
              <div className="mb-1 text-[10px] font-semibold tracking-wider text-ink-500">
                读完这样自检
              </div>
              <ul className="space-y-0.5 text-xs text-ink-700">
                {p.scaffold.selfCheck.map((x, i) => (
                  <li key={i}>· {x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {/* 分数怎么来的 */}
      {p.score && (
        <details className="mt-3">
          <summary className="text-xs text-ink-500 hover:text-ink-700">
            {open ? "收起" : "这个分数怎么来的"}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
            <Meter label="目标相关性" v={p.score.relevance} />
            <Meter label="信源权重" v={p.score.sourceWeight != null ? p.score.sourceWeight / 2 : null} />
            <Meter label="缺口匹配" v={p.score.gapFit} />
            <Meter label="新颖度" v={p.score.novelty} />
            <Meter label="− 阅读成本" v={p.score.readingCost} />
          </div>
        </details>
      )}

      {/* 操作 */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-200 pt-3">
        {/* 立即阅读 → 进入站内阅读工作台（右栏有 AI 助手），而不是跳外部原文 */}
        <Link
          href={`/read/${p.itemId}`}
          onClick={() => act(() => setState(p.recId, "reading"))}
          className="rounded-lg bg-clay-700 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
        >
          立即阅读
        </Link>
        {p.url && (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            title="在浏览器打开原文"
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-500 hover:bg-ink-100"
          >
            原文 ↗
          </a>
        )}
        <button
          onClick={() => act(() => setState(p.recId, "later"))}
          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs hover:bg-ink-100"
        >
          稍后
        </button>
        <button
          onClick={() => act(() => setState(p.recId, "skipped"))}
          className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs text-ink-500 hover:bg-ink-100"
        >
          忽略
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-xs text-pine-700 hover:underline"
        >
          {open ? "收起反馈" : "给反馈"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_KINDS.map((f) => {
              const on = given.has(f.kind);
              return (
                <button
                  key={f.kind}
                  disabled={pending || on}
                  onClick={() => act(() => submitFeedback(p.recId, p.itemId, f.kind as FeedbackKind))}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on
                      ? "border-pine-700/40 bg-pine-100 text-pine-700"
                      : "border-ink-200 text-ink-500 hover:bg-ink-100"
                  }`}
                >
                  {f.label}
                  {on && " ✓"}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-300">
            「读不下去，放弃了」会被记成引导不够，下次给更强的脚手架——不会因此降低推荐难度。
          </p>
        </div>
      )}
    </article>
  );
}
