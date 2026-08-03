#!/usr/bin/env bash
# ============================================================
# Northread 一键部署（Ubuntu/Debian，阿里云 ECS / 轻量应用服务器）
#
# 用法（分两阶段，跑两次同样的命令）：
#
#   第一次（初始化系统 + 拉代码 + 生成配置 + 配 Nginx）：
#     sudo bash deploy/setup-server.sh \
#         https://github.com/liz1010/Northread.git \
#         read.example.com
#
#   然后手动编辑 /srv/northread/.env.production 填好密钥，
#   再跑一次同样命令完成建表、构建、起服务：
#     sudo bash deploy/setup-server.sh \
#         https://github.com/liz1010/Northread.git \
#         read.example.com
#
# 脚本无法替你做的三件事：
#   1. 编辑 .env.production 填 NORTHREAD_API_KEY / NORTHREAD_PASSWORD /
#      NORTHREAD_SESSION_SECRET（用 openssl rand -hex 32 生成）
#   2. 在 DNS 服务商把域名 A 记录指向服务器公网 IP
#   3. 阿里云安全组放行 22 / 80 / 443（3000 不要放行）
# ============================================================

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "✗ 请用 sudo 运行：sudo bash deploy/setup-server.sh <repo-url> [domain]"
  exit 1
fi

REPO_URL="${1:-https://github.com/liz1010/Northread.git}"
DOMAIN="${2:-northread.example.com}"
APP_USER=northread
APP_DIR=/srv/northread
DATA_DIR="$APP_DIR/data"
LOG_DIR=/var/log/northread
ENV_FILE="$APP_DIR/.env.production"

already_setup=false
[[ -f "$ENV_FILE" ]] && already_setup=true

# ---------------- 第一阶段：系统初始化 ----------------
if [[ "$already_setup" == false ]]; then
  echo "==> [1/6] 安装系统依赖（Node 22 / 构建工具 / Nginx / certbot）"
  if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  fi
  apt-get update -y
  apt-get install -y nodejs build-essential git nginx certbot python3-certbot-nginx sqlite3

  echo "==> [2/6] 创建专用用户和目录"
  id -u "$APP_USER" &>/dev/null || useradd -r -m -d "$APP_DIR" -s /bin/bash "$APP_USER"
  mkdir -p "$DATA_DIR" "$LOG_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$LOG_DIR"

  echo "==> [3/6] 拉取代码到 $APP_DIR"
  if [[ -d "$APP_DIR/.git" ]]; then
    echo "    代码已存在，git pull 更新"
    cd "$APP_DIR" && sudo -u "$APP_USER" git pull
  else
    # 注意：$APP_DIR 是 useradd -m 创建的 home 目录，里面有 .bashrc/.profile，
    # 加上上面 mkdir 的 data/，直接 git clone 会因"目录非空"失败。
    # 所以先 clone 到临时目录，再整体移入（保留 data/ 和 home 文件）。
    rm -rf /tmp/northread-clone
    sudo -u "$APP_USER" git clone "$REPO_URL" /tmp/northread-clone
    sudo -u "$APP_USER" sh -c "cp -a /tmp/northread-clone/. '$APP_DIR/' && rm -rf /tmp/northread-clone"
  fi

  echo "==> [4/6] 安装 npm 依赖（含 better-sqlite3 编译）"
  cd "$APP_DIR"
  sudo -u "$APP_USER" npm ci

  echo "==> [5/6] 生成 .env.production 并写入绝对路径"
  sudo -u "$APP_USER" cp .env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  sudo -u "$APP_USER" sed -i "s|^NORTHREAD_DB=.*|NORTHREAD_DB=$DATA_DIR/northread.db|" "$ENV_FILE"
  sudo -u "$APP_USER" sed -i "s|^HOSTNAME=.*|HOSTNAME=0.0.0.0|" "$ENV_FILE"

  echo "==> [6/6] 配置 Nginx（域名：$DOMAIN）"
  sed -e "s/northread.example.com/$DOMAIN/g" \
      "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/northread
  ln -sf /etc/nginx/sites-available/northread /etc/nginx/sites-enabled/northread
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  echo
  echo "============================================================="
  echo "  第一阶段完成。请手动编辑环境变量："
  echo "    sudo -u northread nano $ENV_FILE"
  echo
  echo "  至少要填四项："
  echo "    NORTHREAD_API_KEY         = DeepSeek 的 API key"
  echo "    NORTHREAD_PASSWORD        = 登录密码（8 位以上）"
  echo "    NORTHREAD_SESSION_SECRET  = openssl rand -hex 32"
  echo "    NORTHREAD_HTTPS           = 先留 0，证书装好后再改 1"
  echo
  echo "  填完后重跑本脚本完成建表、构建、启动："
  echo "    sudo bash $APP_DIR/deploy/setup-server.sh"
  echo "============================================================="
  exit 0
fi

# ---------------- 第二阶段：应用初始化 ----------------
echo "==> [1/5] 校验配置（preflight，缺 key 会拒绝启动）"
cd "$APP_DIR"
sudo -u "$APP_USER" node scripts/preflight.ts

echo "==> [2/5] 建表（db:push）"
sudo -u "$APP_USER" npm run db:push

if [[ ! -f "$DATA_DIR/northread.db" ]]; then
  echo "==> [3/5] 灌入初始目标与信源（seed）"
  sudo -u "$APP_USER" npm run seed
  echo "    提示：首次抓取 / 生成推荐请手动跑（境外源可能较慢）："
  echo "      sudo -u northread node scripts/ingest.ts"
  echo "      sudo -u northread node scripts/recommend.ts"
else
  echo "==> [3/5] 数据库已存在，跳过 seed"
fi

echo "==> [4/5] 构建 standalone 并拷贝静态资源"
sudo -u "$APP_USER" npm run build
sudo -u "$APP_USER" cp -r .next/static .next/standalone/.next/
sudo -u "$APP_USER" cp -r public .next/standalone/ 2>/dev/null || true

echo "==> [5/5] 安装 systemd 服务并启动"
cp "$APP_DIR/deploy/northread.service" /etc/systemd/system/northread.service
systemctl daemon-reload
systemctl enable --now northread
systemctl restart nginx
sleep 2
systemctl status northread --no-pager || true

echo
echo "============================================================="
echo "  服务已启动。接下来："
echo "  1) 访问 http://$DOMAIN 验证（先不加 HTTPS 也能用）"
echo "  2) 签 HTTPS 证书：sudo certbot --nginx -d $DOMAIN"
echo "  3) 证书装好后开 HTTPS cookie："
echo "       sed -i 's/^NORTHREAD_HTTPS=0/NORTHREAD_HTTPS=1/' $ENV_FILE"
echo "       sudo systemctl restart northread"
echo "  4) 装定时任务：cp $APP_DIR/deploy/northread-cron /etc/cron.d/northread"
echo "============================================================="
