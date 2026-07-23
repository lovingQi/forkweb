#!/usr/bin/env bash
# forkweb 一键更新脚本
# 依次执行：数据库备份 -> git pull -> docker-compose build -> docker-compose up -d
set -euo pipefail

# 检测 Docker Compose 命令（V2 优先）
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  echo "[错误] 未找到 docker compose 或 docker-compose 命令，请安装 Docker Compose"
  exit 1
fi

# 切到脚本所在目录（即项目根目录）
cd "$(cd "$(dirname "$0")" && pwd)/.."

DATA_DIR="${DATA_DIR:-./data}"
DB_FILE="${DATA_DIR}/cache/forkweb.db"
BACKUP_DIR="${DATA_DIR}/backups"

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
$COMPOSE_CMD build

echo "==> [4/4] 启动服务"
$COMPOSE_CMD up -d

echo
echo "完成。"
echo "  服务地址: http://localhost:8091"
echo "  查看日志: $COMPOSE_CMD logs -f"
echo "  数据库备份目录: $BACKUP_DIR"
