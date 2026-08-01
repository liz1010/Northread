import type { ReactNode } from "react";

import { Nav } from "../../components/Nav.tsx";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
      <aside className="w-44 shrink-0">
        <div className="mb-8 flex items-center gap-2">
          {/* 陶土 1 / 5 —— 品牌标记 */}
          <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden>
            <path d="M9 0 L18 16 L0 16 Z" fill="var(--color-clay-700)" />
          </svg>
          <span className="text-lg font-semibold tracking-tight">Northread</span>
        </div>
        <Nav />
        <p className="mt-8 text-xs leading-relaxed text-ink-300">
          不推荐让你停留更久的内容，
          <br />
          只推荐让你离目标更近的内容。
        </p>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
