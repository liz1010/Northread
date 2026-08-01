import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Northread",
  description: "让每一次阅读，都有方向。",
};

/**
 * 根布局只管 html/body。侧边导航在 (app) 路由组里——
 * 登录页不该套着导航栏，那看起来像是已经登录了。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-canvas text-ink-900">{children}</body>
    </html>
  );
}
