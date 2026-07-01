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
# 通过 Vite 代理转发到车端(默认 127.0.0.1:8080，可用环境变量覆盖)
VITE_CAR_TARGET=http://192.168.1.10:8080 npm run dev
```

类型检查：`npm run typecheck`；构建：`npm run build`。

## Docker 部署

镜像内置 nginx，托管静态文件并将 `/api`、`/ws` 反代到车端：

```bash
docker compose up -d --build
# 关键环境变量：
#   CAR_HOST / CAR_PORT  车端内嵌服务地址(默认 127.0.0.1:8080)
#   API_BASE / WS_BASE   如需前端直连车端可覆盖(默认走 nginx 同源代理)
```

默认映射宿主机 `8081` -> 容器 `80`。
