#!/usr/bin/env bash
# forkweb 一键更新脚本
# 依次执行：数据库备份 -> git pull -> docker-compose build -> docker-compose up -d
set -euo pipefail

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
docker-compose build

echo "==> [4/4] 启动服务"
docker-compose up -d

echo
echo "完成。"
echo "  服务地址: http://localhost:8091"
echo "  查看日志: docker-compose logs -f"
echo "  数据库备份目录: $BACKUP_DIR"
