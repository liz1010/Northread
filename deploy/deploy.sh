#!/usr/bin/env bash
# ============================================================
# Northread 日常更新部署。在服务器上跑一次：
#   sudo bash /srv/northread/deploy/deploy.sh
#
# = 拉最新代码 → 装依赖 → 建表 → 构建 → 拷静态资源 → 重启
# 本地改完代码 push 到 GitHub 后，服务器上跑这一条命令即可。
# ============================================================
set -euo pipefail

APP_DIR=/srv/northread

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "✗ 在 $APP_DIR 找不到代码，请先跑 setup-server.sh"
  exit 1
fi

cd "$APP_DIR"

echo "==> [1/6] git pull"
sudo -u northread git pull

echo "==> [2/6] npm ci"
sudo -u northread npm ci

echo "==> [3/6] db:push（schema 无变动时是空操作）"
sudo -u northread npm run db:push

echo "==> [4/6] build"
sudo -u northread npm run build

echo "==> [5/6] 拷贝静态资源到 standalone"
sudo -u northread cp -r .next/static .next/standalone/.next/
sudo -u northread cp -r public .next/standalone/ 2>/dev/null || true

echo "==> [6/6] 重启服务"
sudo systemctl restart northread

echo "✓ 部署完成：$(date '+%F %T')"
