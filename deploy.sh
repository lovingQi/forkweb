#!/usr/bin/env bash
# forkweb 叉车端一键重编译并运行脚本
#   拉取最新代码 -> 构建镜像 -> 重启容器
#
# 首次部署(车端无 SSH key，用 HTTPS 克隆):
#   git clone https://github.com/lovingQi/forkweb.git
#   cd forkweb && ./deploy.sh --host <车端后端IP>
#
# 用法示例:
#   ./deploy.sh                       # 用默认参数
#   ./deploy.sh --host 172.10.25.132  # 指定车端后端 IP
#   ./deploy.sh --port 8081 --no-pull # 指定前端端口且不拉代码
set -euo pipefail

# ---- 可配置项(命令行参数或环境变量均可覆盖) ----
IMAGE="${IMAGE:-forkweb:latest}"
CONTAINER="${CONTAINER:-forkweb}"
FRONT_PORT="${FRONT_PORT:-8081}"                 # 宿主访问前端的端口
CAR_HOST="${CAR_HOST:-host.docker.internal}"     # 车端后端(jarvis-g)地址
CAR_PORT="${CAR_PORT:-8080}"                      # 车端后端 web_http_port
DO_PULL=1

usage() {
  cat <<EOF
用法: ./deploy.sh [选项]
  --host <IP/host>   车端后端地址        (默认 ${CAR_HOST})
  --car-port <port>  车端后端端口        (默认 ${CAR_PORT})
  --port <port>      前端宿主端口        (默认 ${FRONT_PORT})
  --no-pull          跳过 git pull，仅重新构建运行
  -h, --help         显示帮助
环境变量覆盖: IMAGE CONTAINER FRONT_PORT CAR_HOST CAR_PORT
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)     CAR_HOST="$2"; shift 2;;
    --car-port) CAR_PORT="$2"; shift 2;;
    --port)     FRONT_PORT="$2"; shift 2;;
    --no-pull)  DO_PULL=0; shift;;
    -h|--help)  usage; exit 0;;
    *) echo "未知参数: $1"; usage; exit 1;;
  esac
done

# 切到脚本所在目录(即项目根)
cd "$(cd "$(dirname "$0")" && pwd)"

# 选择 docker 命令(无权限则回退 sudo)
DOCKER="docker"
if ! $DOCKER info >/dev/null 2>&1; then
  echo "[提示] 当前用户无 docker 权限，改用 sudo docker"
  DOCKER="sudo docker"
fi

echo "==> [1/4] 更新代码"
if [ "$DO_PULL" = "1" ] && [ -d .git ]; then
  # 先按仓库现有配置拉取；失败则禁用代理直连重试(兜底车端坏代理)
  git pull --ff-only \
    || git -c http.proxy= -c https.proxy= pull --ff-only \
    || echo "[警告] git pull 失败，使用当前代码继续"
else
  echo "跳过 git pull"
fi

echo "==> [2/4] 构建镜像 ${IMAGE}"
$DOCKER build -t "$IMAGE" .

echo "==> [3/4] 停止并移除旧容器 ${CONTAINER}"
$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "==> [4/4] 启动新容器"
$DOCKER run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  -p "${FRONT_PORT}:80" \
  -e CAR_HOST="$CAR_HOST" \
  -e CAR_PORT="$CAR_PORT" \
  "$IMAGE"

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "完成。"
echo "  前端访问:  http://${HOST_IP:-<本机IP>}:${FRONT_PORT}/"
echo "  反代后端:  http://${CAR_HOST}:${CAR_PORT}  (容器内视角)"
echo "  查看日志:  ${DOCKER} logs -f ${CONTAINER}"
echo "  容器状态:  ${DOCKER} ps --filter name=${CONTAINER}"
