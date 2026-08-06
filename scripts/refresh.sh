#!/bin/bash
# Northread 一键刷新：重新抓取所有源 + 重新生成今日推荐。
# 由 /api/refresh 的 POST 通过 setsid 启动（脱离 Next server 进程）。
# 用绝对路径 /usr/bin/node，逐步写日志到 refresh.log，方便排查。

STAGE=/srv/northread/data/.refresh-stage
LOG=/var/log/northread/refresh.log
cd /srv/northread || exit 1

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

log "===== 刷新开始 ====="

# 标记进入 ingest 阶段（前端靠这个文件显示进度）
printf 'ingest' > "$STAGE"

# 加载 .env.production（含 DeepSeek key / HTTPS_PROXY 等）
set -a
# shellcheck disable=SC1091
. ./.env.production
set +a

log "抓取开始"
/usr/bin/node scripts/ingest.ts >> /var/log/northread/ingest.log 2>&1
INGEST_EXIT=$?
log "抓取完成 exit=$INGEST_EXIT"
if [ "$INGEST_EXIT" -ne 0 ]; then
  log "抓取失败，中止（保留 stage 便于诊断）"
  exit "$INGEST_EXIT"
fi

# 标记进入 recommend 阶段
printf 'recommend' > "$STAGE"
log "推荐开始"
/usr/bin/node scripts/recommend.ts >> /var/log/northread/recommend.log 2>&1
RECOMMEND_EXIT=$?
log "推荐完成 exit=$RECOMMEND_EXIT"

rm -f "$STAGE"
log "===== 刷新完成 ====="
