"use client";

import { useState } from "react";

/**
 * 「刷新内容」按钮：手动触发重新抓取所有源 + 重新生成今日推荐。
 * 抓取在服务器后台异步执行，点击后提示用户稍后刷新查看。
 */
export function RefreshButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const j = await res.json().catch(() => null);
      if (!res.ok) setMsg(j?.error ?? `启动失败（${res.status}）`);
      else setMsg(j?.message ?? "已开始更新");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg && <p className="max-w-64 text-xs leading-relaxed text-ink-500">{msg}</p>}
      <button
        onClick={() => void run()}
        disabled={busy}
        title="重新抓取所有源并重新生成今日推荐"
        className="shrink-0 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-xs text-ink-700 transition hover:bg-ink-100 disabled:opacity-50"
      >
        {busy ? "启动中…" : "刷新内容"}
      </button>
    </div>
  );
}
