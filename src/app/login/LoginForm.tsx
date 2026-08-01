"use client";

import { useActionState } from "react";

import { login } from "./actions.ts";

export function LoginForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(login, null);

  return (
    <form action={action} className="w-full max-w-xs">
      <div className="mb-6 flex items-center gap-2">
        <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden>
          <path d="M9 0 L18 16 L0 16 Z" fill="var(--color-clay-700)" />
        </svg>
        <span className="text-lg font-semibold tracking-tight">Northread</span>
      </div>

      <label className="block text-xs font-semibold text-ink-500" htmlFor="pw">
        访问密码
      </label>
      <input
        id="pw"
        name="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        className="mt-1 w-full rounded-lg border border-ink-200 bg-surface px-3 py-2 text-sm outline-none focus:border-clay-700"
      />
      <input type="hidden" name="next" value={next} />

      {error && <p className="mt-2 text-xs text-clay-700">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-clay-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "验证中…" : "进入"}
      </button>
    </form>
  );
}
