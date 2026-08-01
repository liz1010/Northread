import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 和 jsdom 是原生 / Node-only 依赖，不能被打进浏览器 bundle。
  serverExternalPackages: ["better-sqlite3", "jsdom", "@mozilla/readability"],

  // standalone 会把运行需要的依赖收进 .next/standalone，
  // 服务器上不用装 devDependencies，也不用整个 node_modules。
  output: "standalone",

  // 反代后面拿真实来源 IP
  poweredByHeader: false,
};

export default nextConfig;
