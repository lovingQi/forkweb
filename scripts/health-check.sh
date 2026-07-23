#!/usr/bin/env bash
# forkweb 健康检查心跳脚本
# 每 5 分钟 curl /api/health，连续失败时调用企业微信 Webhook 告警
set -uo pipefail

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8091/api/health}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
MAX_FAIL_COUNT="${MAX_FAIL_COUNT:-2}"
WEBHOOK_URL="${WECHAT_WORK_WEBHOOK_URL:-}"

fail_count=0
last_alerted=0

send_alert() {
    local msg="$1"
    if [ -z "$WEBHOOK_URL" ]; then
        echo "[告警] 未配置 WECHAT_WORK_WEBHOOK_URL，仅记录日志: $msg"
        return
    fi
    curl -s -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"forkweb 健康检查告警: $msg\"}}" \
        >/dev/null 2>&1
    echo "[告警] 已发送企业微信通知: $msg"
}

while true; do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        if [ "$fail_count" -gt 0 ]; then
            echo "$(date '+%Y-%m-%d %H:%M:%S') [恢复] $HEALTH_URL 访问正常"
        fi
        fail_count=0
    else
        fail_count=$((fail_count + 1))
        echo "$(date '+%Y-%m-%d %H:%M:%S') [失败] $HEALTH_URL 访问失败 (连续 $fail_count 次)"
        if [ "$fail_count" -ge "$MAX_FAIL_COUNT" ]; then
            now=$(date +%s)
            # 同一告警至少间隔 10 分钟
            if [ $((now - last_alerted)) -ge 600 ]; then
                send_alert "健康接口连续 ${fail_count} 次检查失败: ${HEALTH_URL}"
                last_alerted=$now
            fi
        fi
    fi
    sleep "$INTERVAL_SECONDS"
done
