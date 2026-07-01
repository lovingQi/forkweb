#!/bin/sh
set -e

# 车端内嵌 HTTP/WebSocket 服务地址(被 nginx 反代)
: "${CAR_HOST:=127.0.0.1}"
: "${CAR_PORT:=8080}"

# 生成 nginx 配置(仅替换 CAR_HOST/CAR_PORT，保留 nginx 自身变量)
envsubst '${CAR_HOST} ${CAR_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/default.conf

# 前端运行时配置：默认同源(由 nginx 代理)，也可用 API_BASE/WS_BASE 覆盖为直连地址
: "${API_BASE:=/api}"
: "${WS_BASE:=/ws}"
cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { apiBase: '${API_BASE}', wsBase: '${WS_BASE}' }
EOF

echo "[forkweb] proxy -> http://${CAR_HOST}:${CAR_PORT}  (apiBase=${API_BASE}, wsBase=${WS_BASE})"

exec nginx -g 'daemon off;'
