"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * 阅读工作台右栏的 AI 聊天面板。
 * 流式读取 /api/chat 的 SSE 输出，边生成边显示。
 */
export function ChatPanel({ itemId }: { itemId: number }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError(null);

    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, messages: history }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? `请求失败（${res.status}）`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const line = block.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              acc += delta;
              setMessages((m) => {
                const copy = [...m];
                copy[copy.length - 1] = { role: "assistant", content: acc };
                return copy;
              });
            }
          } catch {
            /* 不完整的行，等下一块 */
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-ink-200 px-4 py-3">
        <div className="text-sm font-semibold">AI 助手</div>
        <p className="mt-0.5 text-[11px] text-ink-400">针对当前文章对话 · DeepSeek</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="rounded-lg bg-canvas p-3 text-xs leading-relaxed text-ink-500">
            我是你的阅读助手，正在读这篇材料。可以问我：
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-ink-400">
              <li>这篇文章讲了什么？</li>
              <li>为什么推荐给我？</li>
              <li>帮我解释某个概念 / 术语</li>
              <li>有哪些值得深挖的线索？</li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-pine-700 text-white"
                  : "border border-ink-200 bg-canvas text-ink-900"
              } ${m.content === "" && m.role === "assistant" && busy ? "animate-pulse text-ink-400" : ""}`}
            >
              {m.content === "" && m.role === "assistant" && busy ? "正在思考…" : m.content}
            </div>
          </div>
        ))}

        {error && <div className="text-xs text-clay-700">⚠ {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-ink-200 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="和 AI 聊聊这篇文章…"
            className="min-h-11 flex-1 resize-none rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-300 focus:border-pine-700"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="rounded-lg bg-pine-700 px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-pine-900 disabled:opacity-40"
          >
            发送
          </button>
        </div>
        <p className="mt-1 text-[10px] text-ink-300">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  );
}
