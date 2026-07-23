# forkweb 部署与运维指南

本指南面向 forkweb 工单系统的生产部署与日常运维。

## 环境要求

- Docker 20.10+
- Docker Compose 2.0+
- Git（用于一键更新脚本）
- 2 核 CPU / 4GB 内存（推荐）

## 首次部署

### 1. 克隆代码

```bash
git clone https://github.com/lovingQi/forkweb.git
cd forkweb
```

### 2. 启动服务

```bash
# Docker Compose V2（推荐）
docker compose up -d --build

# 或旧版 docker-compose
docker-compose up -d --build
```

默认监听宿主机 `8091` 端口，访问地址：

```
http://<服务器IP>:8091
```

### 3. 检查健康状态

```bash
curl http://localhost:8091/api/health
```

预期返回：

```json
{
  "succeed": true,
  "status": "ok",
  "timestamp": "2026-07-23T06:00:00.000Z",
  "diskUsage": {
    "cache": { "path": "/app/data/cache", "usedBytes": 123456, "totalBytes": 107374182400 },
    "config": { "path": "/app/data/config", "usedBytes": 65432, "totalBytes": 107374182400 }
  }
}
```

## 数据持久化

容器内数据统一挂载到 `./data`：

| 宿主机路径 | 容器路径 | 说明 |
|------------|----------|------|
| `./data/cache` | `/app/data/cache` | SQLite 数据库、日志上传文件、缓存 |
| `./data/config` | `/app/data/config` | 知识库、配置 JSON |

**请勿删除 `./data` 目录**，否则将丢失所有工单与知识库数据。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `REPLAY_PORT` | `8091` | 服务监听端口 |
| `REPLAY_HOST` | `0.0.0.0` | 服务监听地址 |
| `FORKWEB_CACHE_DIR` | `/app/data/cache` | 缓存与数据库目录 |
| `FORKWEB_CONFIG_DIR` | `/app/data/config` | 配置目录 |
| `WECHAT_WORK_WEBHOOK_URL` | 空 | 企业微信 Webhook，用于健康告警 |
| `JWT_SECRET` | `forkweb-dev-secret-change-in-production` | JWT 签名密钥，生产环境务必修改 |

## 一键更新

```bash
./scripts/update.sh
```

脚本执行流程：

1. 备份 `data/cache/forkweb.db` 到 `data/backups/forkweb.db.bak.<时间戳>`。
2. `git pull --ff-only` 拉取最新代码。
3. `docker compose build` 重新构建镜像。
4. `docker compose up -d` 启动服务。

常用场景：

```bash
# 仅重建并启动（不拉代码）
DATA_DIR=./data ./scripts/update.sh
```

## 回退策略

若更新后服务异常，可按以下步骤回退：

1. 停止容器：`docker compose down`
2. 回退代码：`git reset --hard <上一个稳定 commit>`
3. 恢复数据库：从 `data/backups` 复制最近的备份覆盖 `data/cache/forkweb.db`。
4. 重新启动：`docker compose up -d --build`

## 健康检查与告警

### 容器内健康检查

`docker-compose.yml` 已配置 `healthcheck`，每 60 秒探测 `/api/health`。

### 外部心跳监控

使用 `scripts/health-check.sh` 进行独立监控：

```bash
# 后台运行（推荐配合 systemd/supervisor）
WECHAT_WORK_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx \
  ./scripts/health-check.sh &
```

默认每 5 分钟检查一次，连续 2 次失败且超过 10 分钟未告警时，发送企业微信告警。

可通过环境变量调整：

- `HEALTH_URL`：健康接口地址（默认 `http://127.0.0.1:8091/api/health`）
- `INTERVAL_SECONDS`：检查间隔（默认 300）
- `MAX_FAIL_COUNT`：触发告警的连续失败次数（默认 2）

## 使用 Nginx 作为入口

若需使用 HTTPS 或 80 端口，将 `nginx/forkweb.conf` 复制到 Nginx 配置目录并修改：

```bash
sudo cp nginx/forkweb.conf /etc/nginx/conf.d/forkweb.conf
sudo nginx -s reload
```

配置文件中已包含：

- `/api` 反向代理到 forkweb 服务
- `/ws` WebSocket 升级支持
- 单页应用回退
- HTTPS 证书占位（取消注释并配置证书路径后启用）

## 日志查看

```bash
# 实时查看服务日志
docker compose logs -f

# 查看最近 100 行
docker compose logs --tail=100
```

## 安全建议

1. 首次部署后，立即通过管理员账号修改默认密码（`admin` / `admin123`）。
2. 生产环境设置强随机 `JWT_SECRET`。
3. 使用 Nginx 配置 HTTPS，并限制 8091 端口仅允许 Nginx 访问。
4. 定期备份 `data/backups` 目录到异地存储。

## 故障排查

### 容器无法启动

```bash
docker compose logs
```

常见原因：

- 端口 8091 已被占用：修改 `docker-compose.yml` 中的端口映射，例如 `"8092:8080"`。
- `data` 目录权限不足：确保 Docker 用户对 `./data` 有读写权限。

### 数据库损坏

从备份恢复：

```bash
cp data/backups/forkweb.db.bak.20260723060000 data/cache/forkweb.db
docker compose restart
```

### 健康检查失败

```bash
curl -v http://localhost:8091/api/health
```

检查服务是否监听、防火墙是否放行端口。

## 上线前检查清单

正式对外提供服务前，请逐项确认：

- [ ] 修改默认管理员密码：通过 `FORKWEB_ADMIN_PASSWORD` 环境变量设置强密码，或首次登录后立即修改。
- [ ] 设置 `JWT_SECRET` 环境变量为随机强字符串。
- [ ] 预填充知识库：运行 `npx tsx replay-server/scripts/seed-knowledge.ts` 导入常见问题的已验证规则。
- [ ] 确认 `./data` 目录已挂载并有定期备份机制。
- [ ] 确认 `WECHAT_WORK_WEBHOOK_URL` 已配置（健康告警用）。
- [ ] 启动 `scripts/health-check.sh` 进行持续健康探测。
- [ ] 使用 Nginx 配置 HTTPS（如使用公网访问）。
- [ ] 向现场人员提供 `docs/user-guide.md` 操作指南。
- [ ] 在小范围（1-2 名售后）灰度试用至少一周，收集反馈后再全面推开。

## 知识库预填充

首次上线建议导入常见叉车问题知识规则：

```bash
# 开发环境
npx tsx replay-server/scripts/seed-knowledge.ts

# 生产环境（容器内）
docker compose exec forkweb npx tsx replay-server/scripts/seed-knowledge.ts
```

脚本幂等，已存在的标题不会重复导入。导入后可在「日志诊断」->「知识库管理」中查看并继续补充。

## 灰度上线与反馈

1. 选择 1-2 名售后试用一周，覆盖常见故障场景。
2. 收集「排查向导是否有效」「步骤是否清晰」「升级研发是否顺畅」三类反馈。
3. 根据反馈优化知识库规则、排查步骤和前端交互。
4. 修复问题后，逐步扩大使用范围。

