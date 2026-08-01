# 部署到阿里云

目标：跑在阿里云服务器上，公司电脑用浏览器访问，登录后使用。

---

## ⚠️ 先读这一条：境外源可能抓不到

**这是整个部署里最可能出问题的地方，而且和代码无关。**

Northread 现在的 31 个信源里，**30 个在境外**：SemiAnalysis、Fabricated Knowledge、
Stratechery、The Chip Letter 这些都在 Substack 上；LWN、arXiv、Quanta、Astral Codex Ten
同理；`nitter.net` 更是随时可能被墙。中国大陆的阿里云服务器直连这些站点，
**大概率超时或极慢**。

先在服务器上实测再决定怎么办：

```bash
for u in https://semianalysis.com/feed/ \
         https://www.fabricatedknowledge.com/feed \
         https://lwn.net/headlines/newrss \
         http://export.arxiv.org/rss/cs.CL \
         https://nitter.net/Phoenixyin13/rss ; do
  printf '%-52s ' "$u"
  curl -sS -o /dev/null -w '%{http_code}  %{time_total}s\n' --max-time 20 "$u" || echo "失败"
done
```

结果对应的选择：

| 实测结果 | 怎么办 |
|---|---|
| 都能通、耗时可接受 | 什么都不用做 |
| 大部分超时 | 服务器上配代理，在 `.env.production` 里设 `HTTPS_PROXY`。代码已经支持——`fetchFeed` 会读这个变量。 |
| 不方便配代理 | 买香港/新加坡区域的轻量服务器专门跑抓取，或者把服务整个部署到境外节点 |

**抓取失败不会静默。** 每个源每次抓取都记进 `fetch_runs`，今日页顶部会显示
「有 N 个源抓取失败」并列出原因。但如果 30 个源全挂，你看到的就是一个空页面——
所以先测。

---

## 一次性准备

```bash
# 1. Node 22（原生支持 TypeScript，不需要 tsx/ts-node）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential   # build-essential 用来编译 better-sqlite3

# 2. 专用用户和目录
sudo useradd -r -m -d /srv/northread -s /bin/bash northread
sudo mkdir -p /srv/northread/data /var/log/northread
sudo chown -R northread:northread /srv/northread /var/log/northread

# 3. 拉代码
sudo -u northread git clone <你的 GitHub 仓库> /srv/northread
cd /srv/northread
sudo -u northread npm ci
```

## 配置

```bash
sudo -u northread cp .env.example .env.production
sudo -u northread nano .env.production
sudo chmod 600 .env.production     # 里面有 API key 和访问密码
```

必填四项：

```ini
NORTHREAD_API_KEY=sk-...                    # DeepSeek 的 key
NORTHREAD_PASSWORD=<你自己定的访问密码>
NORTHREAD_SESSION_SECRET=<openssl rand -hex 32 的输出>
NORTHREAD_DB=/srv/northread/data/northread.db   # 绝对路径，重新部署不会被覆盖
```

装了 HTTPS 之后再把 `NORTHREAD_HTTPS` 改成 `1`。**改早了会一直跳登录页**——
浏览器不会在 http 连接上回传带 `Secure` 标记的 cookie。

## 初始化数据

```bash
cd /srv/northread
set -a && . ./.env.production && set +a
sudo -u northread node scripts/preflight.ts     # 配置检查
sudo -u northread npm run db:push               # 建表
sudo -u northread npm run seed                  # 灌 3 个目标 + 31 个源
sudo -u northread npm run ingest                # 首次抓取，看看多少源能通
sudo -u northread npm run recommend             # 生成今天的推荐
```

## 构建和启动

```bash
sudo -u northread npm run build

# standalone 产物不会自动带上静态资源，必须手工拷
sudo -u northread cp -r .next/static .next/standalone/.next/
sudo -u northread cp -r public .next/standalone/ 2>/dev/null || true

sudo cp deploy/northread.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now northread
sudo systemctl status northread
```

看日志：`sudo journalctl -u northread -f`

## Nginx + HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/northread
sudo nano /etc/nginx/sites-available/northread     # 改域名
sudo ln -s /etc/nginx/sites-available/northread /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d <你的域名>

# 证书装好后
sudo -u northread sed -i 's/^NORTHREAD_HTTPS=0/NORTHREAD_HTTPS=1/' .env.production
sudo systemctl restart northread
```

**阿里云安全组只放行 80 和 443，不要放 3000。** 3000 由 Nginx 在本机转发，
直接暴露的话就绕过了 HTTPS。

## 定时任务

```bash
sudo cp deploy/northread-cron /etc/cron.d/northread
sudo chmod 644 /etc/cron.d/northread
```

每天 6:00 抓取、6:10 生成推荐。cron 的环境变量极少，所以那个文件里
显式 source 了 `.env.production`——**漏掉这一步的后果是 key 读不到、
静默退回 Mock**，你会看到推荐每天照常更新但全是关键词匹配的结果。

## 后续更新

```bash
cd /srv/northread
sudo -u northread git pull
sudo -u northread npm ci
sudo -u northread npm run db:push        # schema 有变动时
sudo -u northread npm run build
sudo -u northread cp -r .next/static .next/standalone/.next/
sudo systemctl restart northread
```

---

## 排查

| 现象 | 原因 |
|---|---|
| 一直跳登录页 | `NORTHREAD_HTTPS=1` 但用的是 http 访问。改回 0 或配好 HTTPS |
| 今日页空的 | 还没跑 `npm run recommend`；或者所有源都抓取失败（页面顶部会显示） |
| 推荐理由都带「规则打分，非模型判断」 | 退回了 Mock。`node scripts/preflight.ts` 看哪个变量没读到 |
| 页面样式全丢 | 忘了拷 `.next/static` 到 standalone 目录 |
| `better-sqlite3` 装不上 | 缺 `build-essential` |
| 改代码不生效 | 生产模式不热更新，要重新 `npm run build` |

## 数据备份

整个应用的状态就是一个 SQLite 文件，直接复制即可：

```bash
sudo -u northread sqlite3 /srv/northread/data/northread.db ".backup '/srv/northread/data/backup-$(date +%F).db'"
```

**不要直接 `cp` 正在运行的库**——WAL 模式下会拷到不一致的状态。
