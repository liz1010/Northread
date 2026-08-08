"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { updateGoal } from "./actions.ts";

type GoalEditorProps = {
  id: string;
  title: string;
  why: string | null;
  currentLevel: string | null;
  expectedOutput: string | null;
  avoid: string | null;
  status: "active" | "paused";
};

const inputCls =
  "mt-1 w-full rounded-md border border-ink-200 bg-surface px-2.5 py-1.5 text-sm text-ink-900 " +
  "placeholder:text-ink-300 focus:border-pine-600 focus:outline-none";
const labelCls = "text-xs font-semibold text-ink-500";

/** 目标编辑。点击「编辑」展开表单，保存后调用 server action 落库并刷新。 */
export function GoalEditor({
  id,
  title,
  why,
  currentLevel,
  expectedOutput,
  avoid,
  status,
}: GoalEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const err = await updateGoal(id, new FormData(e.currentTarget));
    setPending(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-md border border-ink-200 px-2 py-0.5 text-xs text-ink-500 transition-colors hover:border-pine-600 hover:text-pine-700"
      >
        编辑
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 rounded-lg border border-pine-200 bg-canvas p-4">
      <div>
        <label className={labelCls} htmlFor="goal-title">目标标题</label>
        <input
          id="goal-title"
          name="title"
          defaultValue={title}
          required
          className={inputCls}
          placeholder="一句话说清这个目标"
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="goal-why">为什么</label>
        <textarea
          id="goal-why"
          name="why"
          defaultValue={why ?? ""}
          rows={2}
          className={inputCls}
          placeholder="为什么要设这个目标（会写进推荐理由）"
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="goal-level">当前水平</label>
        <textarea
          id="goal-level"
          name="currentLevel"
          defaultValue={currentLevel ?? ""}
          rows={2}
          className={inputCls}
          placeholder="你现在处在什么位置"
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="goal-output">期望产出</label>
        <textarea
          id="goal-output"
          name="expectedOutput"
          defaultValue={expectedOutput ?? ""}
          rows={2}
          className={inputCls}
          placeholder="做到什么程度算达成"
        />
      </div>
      <div>
        <label className={labelCls} htmlFor="goal-avoid">不想看到</label>
        <textarea
          id="goal-avoid"
          name="avoid"
          defaultValue={avoid ?? ""}
          rows={2}
          className={inputCls}
          placeholder="明确排除的内容"
        />
      </div>
      <div className="flex items-center gap-3">
        <label className={labelCls} htmlFor="goal-status">状态</label>
        <select
          id="goal-status"
          name="status"
          defaultValue={status}
          className="rounded-md border border-ink-200 bg-surface px-2 py-1 text-sm"
        >
          <option value="active">进行中</option>
          <option value="paused">已暂停</option>
        </select>
      </div>

      {error && <p className="text-xs text-clay-700">{error}</p>}

      <p className="text-[11px] leading-relaxed text-ink-300">
        保存后，下次生成推荐（今日页「刷新内容」）会以更新后的目标作为筛选与打分标准。
      </p>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-pine-700 px-3 py-1.5 text-xs font-semibold text-surface transition-colors hover:bg-pine-800 disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-ink-200 px-3 py-1.5 text-xs text-ink-500 hover:bg-ink-100"
        >
          取消
        </button>
      </div>
    </form>
  );
}
