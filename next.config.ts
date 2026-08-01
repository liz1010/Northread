import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 和 jsdom 是原生/Node-only 依赖，不能被打进浏览器 bundle。
  serverExternalPackages: ["better-sqlite3", "jsdom", "@mozilla/readability"],
};

export default nextConfig;
