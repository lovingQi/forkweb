# forkweb 优化实施提示词

> 每条提示词是一个独立的任务单元，包含：背景、目标、涉及文件、具体要求、验收标准。
> 按优先级从高到低排列。

---

## 1. Replay 接口补全权限校验

**背景：**
`replay-server/src/index.ts` 中注册了约 30+ 个 `/api/replay/*` 路由，其中只有 `/api/replay/knowledge*` 系列加了 `authMiddleware` + `requireRole`。其余接口（session、events、frames、logs、assistant、map-aliases、package、cache、control 等）完全没有认证，任何人无需登录即可直接访问。

**目标：**
为所有未保护的 replay 接口添加权限校验。

**涉及文件：**
- `replay-server/src/index.ts`
- `replay-server/src/auth/middleware.ts`（已有 `authMiddleware` 和 `requireRole`，无需修改）

**具体要求：**

1. 以下接口添加 `authMiddleware`（只需登录即可访问，不限角色）：
   - `POST /api/replay/session`
   - `POST /api/replay/session/jobs`
   - `GET /api/replay/session/jobs/:id`
   - `GET /api/replay/session`
   - `GET /api/replay/overview`
   - `GET /api/replay/events`
   - `GET /api/replay/event-markers`
   - `GET /api/replay/frames`
   - `GET /api/replay/error-codes`
   - `GET/POST/DELETE /api/replay/bookmarks`
   - `GET/POST /api/replay/case-meta`
   - `GET /api/replay/assistant/status`
   - `GET /api/replay/assistant/similar`
   - `POST /api/replay/assistant/context-preview`
   - `POST /api/replay/assistant/ask`
   - `GET /api/replay/tasks`
   - `GET /api/replay/map-aliases`
   - `GET /api/replay/map-aliases/export`
   - `POST /api/replay/root-causes/:id/feedback`
   - `GET /api/replay/logs`
   - `GET /api/replay/folded-logs/:id/lines`
   - `GET /api/replay/report.md`
   - `GET /api/replay/report.json`
   - `GET /api/replay/package`
   - `POST /api/replay/package/export`
   - `POST /api/replay/package/compare`
   - `POST /api/replay/package/import`
   - `POST /api/replay/package/import-path`
   - `GET /api/replay/cache`
   - `POST /api/replay/control`
   - `POST /api/replay/seek`

2. 以下接口添加 `authMiddleware` + `requireRole('rd', 'admin')`（涉及配置修改/管理操作）：
   - `GET/POST /api/replay/assistant/config`
   - `DELETE /api/replay/assistant/config`
   - `POST /api/replay/assistant/config/test`
   - `POST /api/replay/assistant/reindex`
   - `POST /api/replay/map-aliases`（写入）
   - `DELETE /api/replay/map-aliases/:id`
   - `POST /api/replay/map-aliases/import`（写入）
   - `DELETE /api/replay/cache`

3. 以下公开接口不需要加认证：
   - `GET /api/health`
   - `GET /api/state`、`GET /api/map`、`GET /api/params`（legacy 车端兼容接口，如果确认只在内网车端调用可不加）

**验收标准：**
- 未携带有效 JWT token 访问以上接口，返回 `401 { succeed: false, error: '未登录或 token 已过期' }`
- `after_sales` 角色访问 assistant/config 等管理接口，返回 `403 { succeed: false, error: '权限不足' }`
- 已有的 knowledge 接口权限不受影响
- 前端正常登录后所有功能不受影响（前端已在 axios interceptor 中携带 token）

---

## 2. 修复 Replay 页面假超时问题

**背景：**
`src/api/replay.ts` 中 `replayHttp` 的 axios timeout 设置为 30000ms（30 秒）。回放诊断页面加载日志后，`refreshAll()` 并发请求 8 个数据接口（overview、events、frames、errors、tasks、logs、bookmarks、caseMeta），大日志场景下某些接口响应超过 30 秒导致 axios 抛出 timeout 错误，前端表现为"超时失败"。

**目标：**
调整 timeout 配置，消除假超时。

**涉及文件：**
- `src/api/replay.ts`

**具体要求：**

1. 将 `replayHttp` 的默认 timeout 从 `30000` 提高到 `120000`（120 秒）
2. 对于已知快速返回的接口（如 bookmarks、case-meta），可以保持较短 timeout（可选，不强制）
3. 考虑在 `pollSessionJob` 的轮询请求中使用较短 timeout（10s 即可，因为轮询只是查状态）

**验收标准：**
- 大日志（100MB+）场景下，回放页面能正常加载完成，不再出现假超时
- 小日志场景下体验不变
- 如果后端确实卡死（超过 120 秒），仍然会触发 timeout 报错（不能设为无限）

---

## 3. 日志分析移到 Worker Threads

**背景：**
`replay-server/src/tickets/service.ts` 中的 `runTicketAnalysisInBackground()` 在主进程的 `setImmediate` 中执行 `ReplaySession.load()`。大日志解析是 CPU 密集操作，会阻塞 Node.js 事件循环，影响其他 API 请求的响应。

**目标：**
将 `ReplaySession` 的日志解析和分析逻辑移到 Node.js Worker Thread 中执行，主进程保持轻量。

**涉及文件：**
- `replay-server/src/tickets/service.ts`（修改 `runTicketAnalysisInBackground`）
- 新建 `replay-server/src/workers/analysisWorker.ts`（Worker 入口）
- `replay-server/src/core/session.ts`（可能需要确保可序列化传参）

**具体要求：**

1. 创建 `replay-server/src/workers/analysisWorker.ts`：
   - 接收参数：`{ logDir, mapDir, mapFile, forceReload, vehicleModelId }`
   - 内部实例化 `ReplaySession`，执行 `load()` 和知识匹配
   - 通过 `parentPort.postMessage()` 返回分析结果（overview、knowledgeMatches、rootCauses、errorSummaries）
   - 异常时 post error message

2. 修改 `runTicketAnalysisInBackground()`：
   - 用 `new Worker('./workers/analysisWorker.js', { workerData: { ... } })` 启动 worker
   - 监听 `message` 事件获取结果，调用 `finalizeTicketAnalysis()`
   - 监听 `error` 事件处理失败
   - 保留现有的 `activeAnalysisRuns` 超时机制（10 分钟 timeout 依然由主进程 `setTimeout` 管理）
   - worker 完成时 `terminate()` 释放资源

3. 注意事项：
   - Worker 中不能共享主进程的数据库连接，如果 worker 需要查数据库（如 vehicle model），通过 workerData 提前传入
   - `ReplaySession` 的结果需要是可 JSON 序列化的（检查有无 Map/Set/Function 等不可序列化类型）
   - 编译配置：确保 `replay-server/tsconfig.json` 包含 worker 文件

**验收标准：**
- 工单触发分析时，主进程 CPU 不会被长时间阻塞
- 分析期间其他 API 请求正常响应（< 100ms）
- 分析结果与之前一致（无功能回归）
- 超时机制仍正常工作
- 分析失败时错误信息正确写入工单

---

## 4. 诊断包延迟生成（Lazy Export）

**背景：**
`replay-server/src/tickets/service.ts` 的 `finalizeTicketAnalysis()` 中，分析完成后会立即调用 `exportDiagnosticPackage()` 生成 zip 包并写入 `tickets/{id}/package.zip`。这个打包操作是 I/O 密集的，增加了分析链路的总耗时。

**目标：**
将诊断包生成从分析流程中移除，改为用户点击"导出诊断包"时按需生成。

**涉及文件：**
- `replay-server/src/tickets/service.ts`（`finalizeTicketAnalysis` 函数）
- `replay-server/src/tickets/routes.ts`（新增或修改导出接口）
- 前端对应的导出按钮逻辑（如有）

**具体要求：**

1. 在 `finalizeTicketAnalysis()` 中删除以下代码块：
   ```typescript
   const pkg = await exportDiagnosticPackage(session.data, { includeReports: true });
   const pkgDest = path.join(ticketDir, 'package.zip');
   await fs.copyFile(pkg.file, pkgDest);
   ```

2. 新增（或修改已有的）工单诊断包导出接口 `GET /api/tickets/:id/package`：
   - 检查 `tickets/{id}/package.zip` 是否已存在且 mtime 晚于最新分析时间
   - 如果不存在或过期：重新加载分析数据 → 调用 `exportDiagnosticPackage()` → 生成并缓存
   - 返回 zip 文件流（`Content-Type: application/zip`）
   - 加 `authMiddleware`

3. 前端导出按钮改为调用此接口，并显示加载状态（生成可能需要几秒）

**验收标准：**
- 工单分析完成时间明显缩短（少了打包环节）
- 用户点击导出后能正常下载 zip 包
- 多次点击导出不会重复生成（有缓存）
- 重新分析后再次导出能获得最新版本

---

## 5. SQLite 添加 busy_timeout

**背景：**
`replay-server/src/db/index.ts` 中已启用 WAL 模式，但未设置 `busy_timeout`。并发写操作时 SQLite 可能立即抛出 `SQLITE_BUSY` 错误。

**目标：**
添加 `busy_timeout` 配置，允许写冲突时等待而非立即报错。

**涉及文件：**
- `replay-server/src/db/index.ts`

**具体要求：**

在 `getDb()` 函数中，`db.pragma('journal_mode = WAL')` 之后添加：
```typescript
db.pragma('busy_timeout = 5000');
```

**验收标准：**
- 并发写操作不再出现 `SQLITE_BUSY` 错误（在 5 秒等待内）
- 如果 5 秒后仍无法获取锁，才抛出错误（这是预期行为）
- 不影响读操作性能

---

## 6. index.ts 精简为纯组装器

**背景：**
`replay-server/src/index.ts` 约 1000 行，包含所有 replay 路由的内联处理函数、中间件配置、WebSocket 设置等。维护困难，且不利于后续拆分测试。

**目标：**
将 `index.ts` 精简为纯粹的"组装文件"，只负责注册中间件和挂载路由模块。

**涉及文件：**
- `replay-server/src/index.ts`（大幅精简）
- 新建 `replay-server/src/replay/routes.ts`（承接所有 `/api/replay/*` 路由）
- 新建 `replay-server/src/replay/wsHandler.ts`（承接 WebSocket 逻辑）
- 可选：新建 `replay-server/src/legacy/routes.ts`（承接 `/api/state`、`/api/map` 等）

**具体要求：**

1. 创建 `replay-server/src/replay/routes.ts`：
   - 导出一个 Express Router
   - 将 `index.ts` 中所有 `app.get('/api/replay/...')` 和 `app.post('/api/replay/...')` 迁移到此 router
   - 路由路径去掉 `/api/replay` 前缀（由 `index.ts` 挂载时指定）

2. 创建 `replay-server/src/replay/wsHandler.ts`：
   - 导出 WebSocket upgrade 处理函数
   - 承接 `/ws/high`、`/ws/low` 的逻辑

3. 精简后的 `index.ts` 结构应类似：
   ```typescript
   import express from 'express';
   import cors from 'cors';
   import { authMiddleware } from './auth/middleware';
   import { userRoutes } from './users/routes';
   import { ticketRoutes } from './tickets/routes';
   import { replayRoutes } from './replay/routes';
   import { siteRoutes } from './sites/routes';
   import { vehicleRoutes } from './vehicles/routes';
   import { statsRoutes } from './stats/routes';
   import { setupWebSocket } from './replay/wsHandler';

   const app = express();
   app.use(cors());
   app.use(express.json({ limit: '50mb' }));
   app.use(express.static('dist'));

   app.use('/api/auth', userRoutes);
   app.use('/api/tickets', ticketRoutes);
   app.use('/api/replay', replayRoutes);
   app.use('/api/sites', siteRoutes);
   app.use('/api/vehicles', vehicleRoutes);
   app.use('/api/stats', statsRoutes);

   // health & legacy
   app.get('/api/health', healthHandler);

   const server = app.listen(PORT);
   setupWebSocket(server);
   ```

4. 确保所有现有接口的路径、行为、中间件不变（纯重构，无功能变更）

**验收标准：**
- 所有 E2E 测试通过
- API 行为完全不变（可用 curl 对比关键接口的响应）
- `index.ts` 行数降至 < 100 行
- 每个路由模块可独立阅读和维护

---

## 7. 引入 pino 结构化日志

**背景：**
后端目前使用 `console.log` / `console.error` 输出日志，无结构化格式、无请求 ID 追踪、无分级过滤，生产排查困难。

**目标：**
引入 `pino` + `pino-http`，实现结构化 JSON 日志输出。

**涉及文件：**
- `package.json`（添加依赖）
- 新建 `replay-server/src/logger.ts`（logger 实例）
- `replay-server/src/index.ts`（注册 pino-http 中间件）
- 全局替换 `console.log` / `console.error` 为 logger 调用

**具体要求：**

1. 安装依赖：`pino`、`pino-http`、`pino-pretty`（dev）

2. 创建 `replay-server/src/logger.ts`：
   ```typescript
   import pino from 'pino';

   export const logger = pino({
     level: process.env.LOG_LEVEL || 'info',
     ...(process.env.NODE_ENV !== 'production' && {
       transport: { target: 'pino-pretty' }
     })
   });
   ```

3. 在 Express app 中注册 `pino-http`：
   ```typescript
   import pinoHttp from 'pino-http';
   app.use(pinoHttp({ logger }));
   ```

4. 将 `replay-server/src/` 中所有 `console.log(...)` 替换为 `logger.info(...)`，`console.error(...)` 替换为 `logger.error(...)`，并尽量附带上下文对象：
   ```typescript
   // Before:
   console.error('[ticket] 自动分析失败:', e);
   // After:
   logger.error({ ticketId, err: e }, '自动分析失败');
   ```

5. 生产环境输出 JSON 到 stdout（Docker logs 自动收集），开发环境用 pino-pretty 格式化

**验收标准：**
- 生产模式下日志输出为一行一条 JSON，包含 `level`、`time`、`msg`、`req.id`（HTTP 请求）
- 开发模式下日志彩色格式化可读
- 不再有裸 `console.log` / `console.error`（搜索确认）
- 请求级别日志包含 method、url、statusCode、responseTime

---

## 8. 管理员后台显示磁盘用量

**背景：**
后端已有 `/api/health` 接口返回磁盘使用信息，但前端没有展示入口。管理员希望在界面上看到当前系统的磁盘使用情况。

**目标：**
在管理员可见的页面（如 Stats 仪表盘或独立的系统状态页面）展示磁盘用量。

**涉及文件：**
- `src/views/StatsBoard.vue`（或新建 `src/views/SystemStatus.vue`）
- `src/api/` 下新增或复用 health 接口调用
- `src/router/index.ts`（如果新增页面则添加路由）

**具体要求：**

1. 调用 `GET /api/health` 获取磁盘信息（该接口已返回 disk 相关字段）

2. 在 StatsBoard 或新增的系统状态区域展示：
   - 磁盘总量 / 已用 / 可用（格式化为 GB）
   - 使用率百分比（配合 Element Plus 的 `el-progress` 组件）
   - 数据目录大小（如 uploads、cache 等子目录各占多少）
   - 当使用率 > 80% 时显示黄色警告，> 90% 显示红色

3. 仅 `admin` 角色可见此面板（路由守卫或组件内 v-if 判断）

4. 自动刷新：每 60 秒刷新一次，或提供手动刷新按钮

**验收标准：**
- admin 登录后能在界面上看到当前磁盘用量
- 非 admin 角色看不到此面板
- 数据准确（与 `df -h` 命令输出一致）
- 超过阈值时有视觉警告

---

## 9. Element Plus 按需引入

**背景：**
`src/main.ts` 中全量引入了 Element Plus（`import ElementPlus from 'element-plus'` + 全量 CSS + 全量注册所有 icons），导致打包体积偏大。

**目标：**
改为按需引入，减小打包体积。

**涉及文件：**
- `package.json`（添加 dev 依赖）
- `vite.config.ts`（配置自动导入插件）
- `src/main.ts`（移除全量引入）
- 各 `.vue` 文件中已有的手动 `import { ElMessage } from 'element-plus'` 可保留

**具体要求：**

1. 安装 dev 依赖：`unplugin-vue-components`、`unplugin-auto-import`

2. 配置 `vite.config.ts`：
   ```typescript
   import AutoImport from 'unplugin-auto-import/vite'
   import Components from 'unplugin-vue-components/vite'
   import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

   export default defineConfig({
     plugins: [
       vue(),
       AutoImport({ resolvers: [ElementPlusResolver()] }),
       Components({ resolvers: [ElementPlusResolver()] }),
     ]
   })
   ```

3. 修改 `src/main.ts`：
   - 删除 `import ElementPlus from 'element-plus'`
   - 删除 `import 'element-plus/dist/index.css'`
   - 删除 `app.use(ElementPlus)`
   - 删除全量注册 icons 的 for 循环
   - 对于项目中使用的 icons，改为在使用处按需 import

4. 各组件中已有的 `import { ElMessage, ElMessageBox } from 'element-plus'` 保持不变（运行时 API 仍需手动导入）

5. 构建后对比前后 bundle 大小（`npm run build` 查看 dist 产物）

**验收标准：**
- 构建成功，无缺失组件报错
- 所有页面 UI 正常显示（重点检查 icon 是否缺失）
- gzip 后总 JS + CSS 体积明显减小（预期减少 200-400KB）
- 开发模式热更新正常

---

## 10. Vitest 补核心模块单元测试

**背景：**
项目目前只有 Playwright E2E 测试，缺少对核心解析和匹配逻辑的单元测试覆盖。

**目标：**
引入 vitest，为高价值模块补充单元测试。

**涉及文件：**
- `package.json`（添加 vitest 依赖和 scripts）
- 新建 `replay-server/src/__tests__/` 或 `replay-server/tests/` 目录
- 新建测试文件

**具体要求：**

1. 安装 dev 依赖：`vitest`

2. 在 `package.json` 中添加脚本：`"test:unit": "vitest run --config replay-server/vitest.config.ts"`

3. 创建 `replay-server/vitest.config.ts`（配置 resolve alias 等）

4. 为以下模块编写测试：

   **a) `replay-server/src/parser/logLine.ts`**（5-10 cases）
   - 标准日志行解析（提取时间戳、级别、模块、内容）
   - 异常格式行的容错处理
   - 多行日志拼接

   **b) `replay-server/src/parser/errorCode.ts`**（5-10 cases）
   - ERROR 码提取与分类
   - 已知错误码的描述匹配
   - 未知错误码的兜底处理

   **c) `replay-server/src/parser/task.ts`**（5-10 cases）
   - 任务段落切分
   - 任务开始/结束时间提取
   - 异常中断任务的识别

   **d) `replay-server/src/core/knowledgeBase.ts`**（5-10 cases）
   - 规则匹配：单条件匹配、多条件 AND/OR
   - 优先级排序
   - 禁用规则不应匹配

   **e) `replay-server/src/core/troubleshootingGuide.ts`**（5-10 cases）
   - 路径生成数量（Top 3）
   - 优先级排序正确性
   - 无匹配规则时返回空

5. 测试数据：从 `replay-server/samples/` 或真实日志中截取小片段作为 fixture

**验收标准：**
- `npm run test:unit` 全部通过
- 覆盖核心解析逻辑的主要分支
- 测试可在 CI 中运行（不依赖外部服务或文件系统绝对路径）
- 每个测试文件可独立运行

---

## 11. 前端全局错误拦截 + 分析状态机

**背景：**
前端各 view 中零散地处理 API 错误（`ElMessage.error`），没有统一的全局拦截。401/403/5xx 的处理逻辑重复且不一致。工单分析过程缺少进度反馈。

**目标：**
1. 统一全局 HTTP 错误处理
2. 工单分析流程增加状态提示

**涉及文件：**
- `src/api/tickets.ts`、`src/api/replay.ts` 等（添加 response interceptor）
- 或新建 `src/api/interceptors.ts`（统一拦截逻辑）
- `src/views/TicketDetail.vue`（分析状态 UI）
- `src/stores/auth.ts`（logout 逻辑）

**具体要求：**

**Part A: 全局错误拦截**

1. 为所有 axios 实例（`ticketHttp`、`replayHttp` 等）添加 response error interceptor：
   ```typescript
   instance.interceptors.response.use(
     (res) => res,
     (error) => {
       if (error.response?.status === 401) {
         // token 过期，清除登录态，跳转登录页
         authStore.logout();
         router.push('/login');
         ElMessage.error('登录已过期，请重新登录');
       } else if (error.response?.status === 403) {
         ElMessage.error('权限不足，无法执行此操作');
       } else if (error.response?.status >= 500) {
         ElMessage.error('服务器错误，请稍后重试');
       } else if (error.code === 'ECONNABORTED') {
         ElMessage.error('请求超时，请检查网络后重试');
       }
       return Promise.reject(error);
     }
   );
   ```

2. 抽取为公共函数，各 axios 实例统一调用

**Part B: 分析状态机**

1. 工单详情页的"分析"操作，显示分析状态：
   - 上传中 → 显示上传进度条
   - 分析中 → 显示"正在分析..."动画 + 已用时间（从工单 events 中获取 analysis_started 时间）
   - 完成 → 显示成功提示 + 自动刷新工单详情
   - 失败 → 显示错误原因 + 重试按钮

2. 使用轮询（已有 `analyzing` 状态判断）或 WebSocket 推送来更新状态

**验收标准：**
- 401 错误自动跳转登录页，不再出现多个重复错误提示
- 403 错误有统一提示
- 网络超时有明确的中文提示
- 分析过程中用户能看到当前状态和已用时间
- 分析失败时有重试入口
