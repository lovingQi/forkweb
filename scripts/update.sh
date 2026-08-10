#!/usr/bin/env bash
# forkweb 一键更新脚本
# 依次执行：数据库备份 -> git pull -> docker-compose build -> docker-compose up -d
set -euo pipefail

# 切到脚本所在目录（即项目根目录）
cd "$(cd "$(dirname "$0")" && pwd)/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DATA_DIR="${DATA_DIR:-./data}"
HOST_PORT="${HOST_PORT:-8091}"
DB_FILE="${DATA_DIR}/cache/forkweb.db"
BACKUP_DIR="${DATA_DIR}/backups"

# 检测 Docker Compose 命令
# 朋友服务器：FORCE_COMPOSE_V1=1 强制使用 docker-compose（v1）
if [ "${FORCE_COMPOSE_V1:-}" = "1" ] || [ "${COMPOSE_CMD:-}" = "docker-compose" ]; then
  if ! docker-compose version >/dev/null 2>&1; then
    echo "[错误] 已要求使用 docker-compose（v1），但未找到该命令"
    exit 1
  fi
  COMPOSE_CMD="docker-compose"
elif [ -n "${COMPOSE_CMD:-}" ]; then
  :
elif docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "[错误] 未找到 docker compose 或 docker-compose 命令，请安装 Docker Compose"
  exit 1
fi

COMPOSE_ARGS=(-f "$COMPOSE_FILE")

mkdir -p "$DATA_DIR" "$BACKUP_DIR"

echo "==> [1/4] 备份数据库"
if [ -f "$DB_FILE" ]; then
  BACKUP_NAME="forkweb.db.bak.$(date +%Y%m%d%H%M%S)"
  cp "$DB_FILE" "$BACKUP_DIR/$BACKUP_NAME"
  echo "    已备份: $BACKUP_DIR/$BACKUP_NAME"
else
  echo "    数据库文件不存在，跳过备份: $DB_FILE"
fi

echo "==> [2/4] 拉取最新代码"
if [ -d .git ]; then
  git pull --ff-only \
    || git -c http.proxy= -c https.proxy= pull --ff-only \
    || { echo "[错误] git pull 失败，更新中止"; exit 1; }
else
  echo "    非 git 仓库，跳过拉取"
fi

echo "==> [3/4] 构建镜像"
$COMPOSE_CMD "${COMPOSE_ARGS[@]}" build

echo "==> [4/4] 启动服务"
$COMPOSE_CMD "${COMPOSE_ARGS[@]}" up -d

echo
echo "完成。"
echo "  Compose 文件: $COMPOSE_FILE"
echo "  服务地址: http://localhost:${HOST_PORT}"
echo "  查看日志: $COMPOSE_CMD ${COMPOSE_ARGS[*]} logs -f"
echo "  数据库备份目录: $BACKUP_DIR"
