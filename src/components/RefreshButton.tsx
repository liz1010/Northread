"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * 「刷新内容」按钮：手动触发重新抓取所有源 + 重新生成今日推荐。
 * 点击后显示「抓取中…」状态，后台完成后自动刷新页面呈现新内容，
 * 不需要用户手动等待再刷新。
 */
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setMsg("正在重新抓取并生成推荐…");

    const res = await fetch("/api/refresh", { method: "POST" });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      setMsg(j?.error ?? `启动失败（${res.status}）`);
      setBusy(false);
      return;
    }
    if (j?.busy) {
      setMsg("已有一次抓取在进行中，稍等它完成…");
    }

    // 轮询状态，完成后自动刷新页面
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch("/api/refresh", { method: "GET" });
        const s = await r.json().catch(() => null);
        if (s && !s.running) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          setBusy(false);
          setMsg("更新完成 ✓");
          // 重新请求 server component，自动呈现新抓取与新推荐
          router.refresh();
        }
      } catch {
        /* 网络抖动忽略，下轮再试 */
      }
    }, 4000);
  }

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  return (
    <div className="flex items-center gap-3">
      {msg && (
        <p className="flex max-w-64 items-center gap-1.5 text-xs leading-relaxed text-ink-500">
          {busy && <span className="h-3 w-3 animate-spin rounded-full border border-ink-300 border-t-pine-700" />}
          {msg}
        </p>
      )}
      <button
        onClick={() => void start()}
        disabled={busy}
        title="重新抓取所有源并重新生成今日推荐"
        className="shrink-0 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 transition hover:bg-ink-100 disabled:opacity-50"
      >
        {busy ? "抓取中…" : "刷新内容"}
      </button>
    </div>
  );
}
