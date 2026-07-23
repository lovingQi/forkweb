# forkweb 工单系统 Docker 镜像
# 采用单一 Node.js 容器运行前后端：Express 提供 API 并托管前端静态文件

# ---- 构建阶段 ----
FROM node:20-slim AS build
WORKDIR /app

# 先复制包清单并安装全部依赖（含 devDependencies 用于构建）
COPY package.json package-lock.json* ./
RUN npm install

# 复制源码并构建前后端
COPY . .
# 生产环境前后端同源，API 使用相对路径
RUN echo "window.__APP_CONFIG__ = { apiBase: '/api', wsBase: '/ws', replayApiBase: '/api', replayWsBase: '/ws' }" > public/config.js
RUN npm run build
RUN npm run replay:build
# ESM 要求相对 import 必须带 .js 后缀，TypeScript 编译不会自动添加
RUN node scripts/fix-esm-imports.mjs replay-server/dist

# ---- 运行阶段 ----
FROM node:20-slim AS runtime
WORKDIR /app

# 安装原生模块编译工具（better-sqlite3 可能需要源码编译）以及 zip/unzip（诊断包生成需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ zip unzip \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV REPLAY_PORT=8080
ENV REPLAY_HOST=0.0.0.0
ENV FORKWEB_CACHE_DIR=/app/data/cache
ENV FORKWEB_CONFIG_DIR=/app/data/config

# 仅安装生产依赖
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# 复制构建产物
COPY --from=build /app/dist ./dist
COPY --from=build /app/replay-server/dist ./replay-server/dist

# 数据卷目录
RUN mkdir -p /app/data/cache /app/data/config

EXPOSE 8080

CMD ["node", "replay-server/dist/index.js"]
