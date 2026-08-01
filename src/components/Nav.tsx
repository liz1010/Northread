"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 五个页面，和实施计划 §5 一致 */
const LINKS = [
  { href: "/", label: "今日" },
  { href: "/goals", label: "目标" },
  { href: "/sources", label: "信源" },
  { href: "/library", label: "资料库" },
  { href: "/review", label: "复盘" },
];

export function Nav() {
  const path = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              active
                ? // 陶土 2 / 5 —— 当前导航项
                  "rounded-lg bg-clay-100 px-3 py-2 text-sm font-semibold text-clay-700"
                : "rounded-lg px-3 py-2 text-sm text-ink-500 transition-colors hover:bg-ink-100"
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
