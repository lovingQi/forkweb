# forkweb — 叉车单机监控与配置前端

基于 Vue3 + Vite + Element Plus + Pinia 的单机 Web 界面，配合车端 `jarvis-g` 内嵌的 HTTP/WebSocket 服务（civetweb，默认端口 `8080`）使用。

## 功能

- 监控总览：俯视图渲染地图、机器人、激光点云、规划路径、避障范围；侧栏显示电量/定位分/速度/位姿/告警/IO/叉车信息。
- 激光配置：各激光使能开关 + 安装/角度/量程参数表单（车辆运动中后端拒绝修改）。
- 避障配置：避障距离/速度阈值/超声/急停等参数表单 + 避障范围实时预览。
- 控制面板：停止/空闲/回充、电机使能、安全模式、点动控制、重定位。

## 通信

- WebSocket：`/ws/high`（位姿/速度/激光/路径/避障，高频），`/ws/low`（状态/电量/IO/叉车，低频）。
- REST：`GET /api/state|/api/map|/api/params|/api/routes/rules`；`POST /api/config|/api/laser/enable|/api/control/*`。

后端地址由 `public/config.js` 的 `window.__APP_CONFIG__` 决定（默认同源 `/api`、`/ws`）。

## 本地开发

```bash
npm install
# 同时启动前端 Vite 与后端 replay-server
npm run replay:dev:all
```

类型检查：`npm run typecheck`；前端构建：`npm run build`；后端构建：`npm run replay:build`。

## 工单系统 Docker 部署（推荐）

镜像基于 Node.js 官方镜像，构建前后端并运行 Express 服务，同时托管前端静态文件：

```bash
# 首次部署
docker-compose up -d --build

# 后续更新（自动备份数据库、拉代码、重建、启动）
./scripts/update.sh
```

默认映射宿主机 `8080` -> 容器 `8080`，数据持久化到 `./data`。

关键环境变量：

- `REPLAY_PORT` / `REPLAY_HOST`：服务监听地址与端口。
- `FORKWEB_CACHE_DIR` / `FORKWEB_CONFIG_DIR`：数据库、日志、知识库目录。
- `JWT_SECRET`：生产环境务必修改为强随机字符串。
- `WECHAT_WORK_WEBHOOK_URL`：健康检查告警用企业微信 Webhook。

详细部署、Nginx 入口、HTTPS、回退策略见 `docs/deployment.md`。

## 健康检查

```bash
curl http://localhost:8080/api/health
```

`scripts/health-check.sh` 可独立运行，每 5 分钟探测健康接口，失败时发送企业微信告警。

## 原车端监控部署

如需继续以 nginx 静态托管方式部署原车端监控前端，仍可使用：

```bash
docker build -f Dockerfile.legacy -t forkweb-legacy .
docker run -d -p 8081:80 -e CAR_HOST=192.168.1.10 forkweb-legacy
```

（注：当前 Dockerfile 已改为工单系统运行模式，原车端监控模式需保留旧 Dockerfile。）
