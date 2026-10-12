# forkweb 对外分析接口对接说明

本文档面向售后 AI 系统的开发同事。forkweb 在这里只作为日志分析引擎：你们上传日志并创建工单，forkweb 在后台完成分析，再把结果主动推送到你们提供的回调地址。

现场排查、升级研发、结案等后续流程不在本次对接范围内。

## 1. 对接流程

```text
售后 AI 系统                         forkweb                         售后 AI 回调
     |                                 |                                  |
     | POST /api/open/v1/tickets       |                                  |
     | X-API-Key + 日志文件            |                                  |
     |-------------------------------->|                                  |
     | 200 { ticketNo, status }        |                                  |
     |<--------------------------------|                                  |
     |                                 | 后台分析（通常数分钟，最长约 10 分钟） |
     |                                 | POST 回调（HMAC 签名）            |
     |                                 |--------------------------------->|
     |                                 | 2xx                              |
     |                                 |<---------------------------------|
     | 用 ticketNo + API Key 下载报告或诊断包                            |
     |-------------------------------->|                                  |
```

建单接口会立刻返回，不会等分析结束。请把 HTTP 超时设成至少 120 秒，因为上传和解压可能比较慢。分析本身的等待时间不要算进这次 HTTP 超时，结果以回调为准。

## 2. 接入准备

双方需要事先约定 4 项，由 forkweb 部署方配置到环境变量：

| 项目 | 由谁提供 | forkweb 环境变量 |
| --- | --- | --- |
| API Key | forkweb 生成后交给对方，放在请求头 `X-API-Key` | `FORKWEB_OPEN_API_KEY` |
| 回调地址 | 售后 AI 系统提供，一个固定地址 | `FORKWEB_CALLBACK_URL` |
| 签名密钥 | 双方约定，只用于校验回调 | `FORKWEB_CALLBACK_SECRET` |
| 服务根地址 | forkweb 的内网访问地址，例如 `http://192.168.1.10:8091` | `REPLAY_SERVER_BASE_URL` |

建议用内网地址，不要把 API Key 和签名密钥写进代码仓库。

## 3. 鉴权

除健康检查外，本文档里的接口都要带请求头：

```http
X-API-Key: <FORKWEB_OPEN_API_KEY>
```

| HTTP 状态 | code | 含义 |
| --- | --- | --- |
| 401 | `INVALID_API_KEY` | 没带 Key，或 Key 不正确 |
| 403 | `SYSTEM_USER_DISABLED` | 对接账号被管理员禁用，对接已临时关闭 |
| 503 | `OPEN_API_DISABLED` | 服务端没有配置 API Key，对接未启用 |

失败响应统一为：

```json
{ "succeed": false, "code": "INVALID_API_KEY", "error": "API Key 无效" }
```

## 4. 创建工单

```http
POST /api/open/v1/tickets
Content-Type: multipart/form-data
X-API-Key: <key>
```

### 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `files` | 是 | 1 到 20 个文件。单个不超过 50MB，合计不超过 200MB。支持 `.log`、`.json`，以及 `.zip`、`.tar.gz`、`.tgz` |
| `externalId` | 是 | 你们系统里的单号，去掉首尾空格后 1 到 128 个字符。用来防止重复建单，也会原样出现在回调里 |
| `title` | 是 | 标题，不超过 200 个字符 |
| `description` | 是 | 问题描述。会作为 AI 分析的问题输入 |
| `siteName` | 否 | 现场名称，与 forkweb 里的现场名称精确匹配（区分大小写，忽略首尾空格） |
| `vehicleModelName` | 否 | 车型名称，精确匹配 |
| `vehicleCategoryName` | 否 | 车型类别名称。只在传了车型名称时用来缩小匹配范围 |
| `impactLevel` | 否 | `low`、`medium`、`high`、`critical` 之一 |
| `occurredStartAt` | 否 | 故障开始时间，建议 ISO 8601，原样保存 |
| `occurredEndAt` | 否 | 故障结束时间，建议 ISO 8601，原样保存 |
| `aiEnabled` | 否 | 是否生成 AI 结论。默认开启，只有传 `false` 才关闭 |

压缩包里至少要有一个 `.log` 文件。地图文件是 `.json`，可以和日志一起上传，也可以不传。

### 请求示例

```bash
curl -X POST "http://192.168.1.10:8091/api/open/v1/tickets" \
  -H "X-API-Key: $FORKWEB_OPEN_API_KEY" \
  -F "externalId=AS-0001" \
  -F "title=叉车无法举升" \
  -F "description=现场反馈货叉不动作，已导出当天日志" \
  -F "siteName=苏州一号仓" \
  -F "vehicleModelName=FE-1500" \
  -F "vehicleCategoryName=平衡重" \
  -F "impactLevel=high" \
  -F "occurredStartAt=2026-10-12T01:00:00.000Z" \
  -F "occurredEndAt=2026-10-12T02:00:00.000Z" \
  -F "files=@/path/to/logs.zip"
```

### 成功响应

HTTP 200：

```json
{
  "succeed": true,
  "duplicated": false,
  "ticket": {
    "ticketNo": "TK20261012-AB12CD",
    "externalId": "AS-0001",
    "status": "analyzing",
    "createdAt": "2026-10-12 06:00:00"
  },
  "matches": {
    "site": { "matched": true, "name": "苏州一号仓" },
    "vehicleModel": { "matched": true, "reason": "matched" }
  },
  "warnings": []
}
```

请保存 `ticketNo`。下载报告和诊断包时要用它。`createdAt` 是数据库里的 UTC 时间字符串。

## 5. 重复提交

`externalId` 在 forkweb 里唯一。

- 用同一个 `externalId` 再次调用时，不会新建工单，也不会重新分析。
- 响应仍是 HTTP 200，`duplicated` 为 `true`，`ticket` 是第一次创建的那张工单。
- 这次上传的文件会被丢弃。
- 如果两次请求几乎同时到达，后到的请求同样返回已存在的工单。

网络超时后可以用同一个 `externalId` 安全重试。

## 6. 现场和车型匹配

匹配失败不会拒绝建单。

- 现场：按 `siteName` 精确匹配。匹配不到时 `matches.site.matched` 为 `false`，`warnings` 里会有说明，工单不关联现场。
- 车型：按 `vehicleModelName` 精确匹配。如果同时传了 `vehicleCategoryName`，则名称和类别都要一致。
- 只匹配到 1 个车型时才会写入工单。匹配不到时 `reason` 为 `not_found`；同名车型有多个时 `reason` 为 `ambiguous`。这两种情况都不关联车型。
- 没有传对应字段时，`reason` 为 `not_provided`，现场的 `name` 为 `null`。

车型匹配不上时，知识库不会按车型类别过滤，规则命中范围会更宽。建议尽量传入与 forkweb 中一致的车型名称。

`duplicated: true` 的响应用于告诉你“这张单已经存在”，不会重新计算匹配结果。此时 `matches` 为空占位，`warnings` 为空数组。

## 7. 回调

只对本次对接创建的工单发送回调。触发时机：

| 事件 | 何时发送 |
| --- | --- |
| `analysis.completed` | 自动分析成功，规则结论已经生成。AI 调用失败时也会发这个事件，此时 `result.ai.offline` 为 `true` |
| `analysis.failed` | 分析失败，或超过 10 分钟超时 |

后续如果这张工单被人工重新分析，或服务重启后自动重新分析并成功，会再发送一次 `analysis.completed`。两次的 `eventId` 不同，`externalId` 相同。请以最新一次为准。

### 分析成功

```json
{
  "eventId": "0b1c2d3e-4f50-4612-a789-abcdef012345",
  "eventType": "analysis.completed",
  "status": "succeeded",
  "occurredAt": "2026-10-12T06:05:00.000Z",
  "ticket": {
    "ticketNo": "TK20261012-AB12CD",
    "externalId": "AS-0001",
    "title": "叉车无法举升"
  },
  "result": {
    "analysisVersionNo": 1,
    "conclusion": "[error] 液压阀无响应（置信度 86%）",
    "issueType": "hydraulic",
    "topIssues": [
      { "title": "液压阀无响应", "severity": "error", "confidence": 0.86, "suggestion": "检查阀线圈供电" }
    ],
    "evidenceSummary": {
      "errorCount": 12,
      "warningCount": 3,
      "errorCodeCount": 4,
      "taskCount": 2,
      "durationMs": 600000,
      "robotName": "FORK-01",
      "version": "1.2.3"
    },
    "troubleshootingPaths": [
      {
        "title": "检查液压阀",
        "severity": "error",
        "confidence": 0.86,
        "steps": [
          { "stepNo": 1, "title": "测量线圈电压", "instruction": "在阀插头处测量", "criteria": "电压接近 24V" }
        ]
      }
    ],
    "ai": {
      "answer": "日志显示举升指令已下发，但阀反馈一直为 0。",
      "rootCauseCandidates": ["液压阀线圈未吸合"],
      "suggestions": ["检查 24V 供电和插头"],
      "uncertainties": ["缺少阀体温度数据"],
      "offline": false,
      "provider": "deepseek",
      "model": "deepseek-chat"
    }
  },
  "links": {
    "reportUrl": "http://192.168.1.10:8091/api/open/v1/tickets/TK20261012-AB12CD/report",
    "packageUrl": "http://192.168.1.10:8091/api/open/v1/tickets/TK20261012-AB12CD/package"
  }
}
```

说明：

- `conclusion` 是最多 3 条根因的短文本。没有识别到根因时会是一句固定提示。
- `topIssues` 优先来自根因候选；没有根因时退化为日志里的前几条问题，字段可能只有 `title`、`severity`、`timestamp`、`detail`。
- `ai` 在建单时关闭 AI 分析的情况下为 `null`。
- `links` 在服务端未配置 `REPLAY_SERVER_BASE_URL` 时，两个地址都是 `null`。下载时仍要带 `X-API-Key`。
- 回调里不会包含服务器本地路径。

### 分析失败

```json
{
  "eventId": "9aa1c0d2-1e3f-4b55-9c20-1234567890ab",
  "eventType": "analysis.failed",
  "status": "failed",
  "occurredAt": "2026-10-12T06:15:00.000Z",
  "ticket": {
    "ticketNo": "TK20261012-AB12CD",
    "externalId": "AS-0001",
    "title": "叉车无法举升"
  },
  "error": {
    "reason": "analysis_timeout",
    "message": "自动分析超时（超过 10 分钟）"
  }
}
```

`error.reason` 为 `analysis_failed` 或 `analysis_timeout`。

## 8. 回调签名

每次回调都是 `POST`，`Content-Type: application/json`，body 是上面的 JSON 原文。请对**原始 body 字节**验签，不要先解析再重新序列化。

请求头：

| 头 | 含义 |
| --- | --- |
| `X-Forkweb-Event` | `analysis.completed` 或 `analysis.failed` |
| `X-Forkweb-Delivery` | 与 body 里的 `eventId` 相同 |
| `X-Forkweb-Timestamp` | 本次发送时的 Unix 秒级时间戳 |
| `X-Forkweb-Signature` | `sha256=` 加上 `HMAC-SHA256(secret, "<timestamp>.<原始 body>")` 的十六进制小写结果 |

建议：

1. 用常数字符串比较验签结果，避免提前返回导致的时序差异。
2. 拒绝时间戳与当前时间相差超过 300 秒的请求。
3. 按 `eventId` 去重。同一次投递会在失败后原样重试，body 不变，但时间戳和签名每次都会变。
4. 收到并验签通过后尽快返回 HTTP 2xx。2xx 以外的状态，以及连接超时，都会被视为失败并重试。

### Node.js 验签

```js
import crypto from 'crypto'

function verifyForkwebCallback(secret, rawBody, timestamp, signature) {
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const actualBuf = Buffer.from(signature)
  const expectedBuf = Buffer.from(expected)
  if (actualBuf.length !== expectedBuf.length) return false
  return crypto.timingSafeEqual(actualBuf, expectedBuf)
}
```

`rawBody` 必须是未经改写的请求体字符串。

### Python 验签

```python
import hashlib
import hmac
import time

def verify_forkweb_callback(secret: str, raw_body: bytes, timestamp: str, signature: str) -> bool:
    if abs(time.time() - int(timestamp)) > 300:
        return False
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    expected = f"sha256={digest}"
    return hmac.compare_digest(expected, signature)
```

仓库里的 `replay-server/scripts/mock-callback-receiver.ts` 是一个可运行的接收示例。设置 `MOCK_FAIL=1` 时它会返回 500，用来观察重试。

```bash
FORKWEB_CALLBACK_SECRET=your-secret \
MOCK_CALLBACK_PORT=19091 \
npx tsx replay-server/scripts/mock-callback-receiver.ts
```

## 9. 重试

回调先写入数据库，再发送。对方返回 2xx 记为已送达。单次请求超时 10 秒。

失败后按下面的间隔重试，最多再试 6 次，加上第一次一共 7 次：

1. 30 秒
2. 1 分钟
3. 5 分钟
4. 15 分钟
5. 1 小时
6. 6 小时

7 次都失败后不再自动发送。forkweb 管理员可以在工单详情页看到回调状态，并手动重推。重推会把发送次数清零，然后重新走上面的间隔。

因此请保证回调接口可用，并做到按 `eventId` 去重。没有对外查询接口，回调是拿到结果的唯一途径。

## 10. 下载报告和诊断包

两个地址都在回调的 `links` 里，也可以按 `ticketNo` 自己拼。都需要 `X-API-Key`。

```http
GET /api/open/v1/tickets/{ticketNo}/report
GET /api/open/v1/tickets/{ticketNo}/package
```

- 报告是 Markdown 文本，`Content-Type: text/markdown`。
- 诊断包是 zip 文件。
- 工单不是这次对接创建的、单号不存在，或文件还没生成，都返回 404，`code` 为 `NOT_FOUND`。

```bash
curl -H "X-API-Key: $FORKWEB_OPEN_API_KEY" \
  "http://192.168.1.10:8091/api/open/v1/tickets/TK20261012-AB12CD/report"
```

## 11. 错误码

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 字段缺失、超长，或 `impactLevel` 不在允许值里 |
| 400 | `NO_FILES` | 没有上传文件 |
| 400 | `NO_LOG_FILE` | 上传内容里没有 `.log` |
| 401 | `INVALID_API_KEY` | API Key 缺失或不正确 |
| 403 | `SYSTEM_USER_DISABLED` | 对接账号被禁用 |
| 404 | `NOT_FOUND` | 下载时工单或文件不存在 |
| 413 | `FILE_TOO_LARGE` | 单个文件超过 50MB，或合计超过 200MB |
| 500 | `INTERNAL_ERROR` | 服务内部错误 |
| 503 | `OPEN_API_DISABLED` | 未配置 API Key |

## 12. 限制

- 单个文件不超过 50MB，一次上传合计不超过 200MB，最多 20 个文件。
- 自动分析超过 10 分钟会失败，并发送 `analysis.failed`，`reason` 为 `analysis_timeout`。
- 建单请求的客户端超时建议不少于 120 秒。
- 回调处理请在几秒内返回，不要在回调请求里同步做耗时工作。10 秒无响应会被当成失败。

## 13. 常见问题

**同一个 externalId 收到了多次 analysis.completed。**  
这张工单被重新分析过。比较 `occurredAt` 或 `result.analysisVersionNo`，采用最新的一次。`eventId` 不要当成工单号。

**回调里的 ai.offline 为 true。**  
规则分析已经成功。AI 结论不可用，原因写在 `ai.answer` 里。不要把这次回调当成分析失败。

**links 里的地址是 null。**  
forkweb 没有配置 `REPLAY_SERVER_BASE_URL`。把情况告诉 forkweb 维护人。配置后，新的回调会带上地址。已经生成的回调内容不会自动改写。

**一直收不到回调。**  
先确认你们的回调地址从 forkweb 所在机器可以访问，并且对验签通过的请求返回了 2xx。7 次都失败后需要 forkweb 管理员在页面上重推。

## 14. 联调清单

- [ ] 用正确的 API Key 上传一份含 `.log` 的压缩包，收到 `duplicated: false` 和 `ticketNo`。
- [ ] 用同一个 `externalId` 再提交一次，收到 `duplicated: true`，且 `ticketNo` 不变。
- [ ] 用错误的 API Key 调用，收到 401。
- [ ] 上传一个不含 `.log` 的文件，收到 400 `NO_LOG_FILE`。
- [ ] 收到 `analysis.completed`，验签通过，并按 `eventId` 记下这次投递。
- [ ] 用返回的地址下载报告和诊断包。
- [ ] 让回调接口先返回 500，确认 forkweb 会重试；恢复 200 后能送达。
- [ ] 确认同一条回调的重试不会在你们系统里创建重复记录。
