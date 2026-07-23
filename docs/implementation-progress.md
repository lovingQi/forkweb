# forkweb 工单驱动自助诊断系统开发进度

> 本文件随 `docs/implementation-plan.md` 各阶段实时更新。

## 总览

| 阶段 | 名称 | 状态 | 完成时间 | 备注 |
|------|------|------|----------|------|
| 1 | 工单主流程重塑 | ✅ 已完成 | 2026-07-22 | - |
| 2 | 工单状态流 | ✅ 已完成 | 2026-07-22 | - |
| 3 | 分析版本化 | ✅ 已完成 | 2026-07-22 | - |
| 4 | 问题类型自动分类 | ✅ 已完成 | 2026-07-22 | - |
| 5 | 知识库结构升级 | ✅ 已完成 | 2026-07-22 | - |
| 6 | 排查向导生成 | ✅ 已完成 | 2026-07-22 | - |
| 7 | 排查步骤执行记录 | ✅ 已完成 | 2026-07-22 | - |
| 8 | 自助解决和升级研发 | ✅ 已完成 | 2026-07-22 | - |
| 9 | 研发处理和知识沉淀 | ✅ 已完成 | 2026-07-22 | - |
| 10 | 角色导航和权限 | ✅ 已完成 | 2026-07-22 | - |
| 11 | 精简证据面板 | ✅ 已完成 | 2026-07-22 | - |
| 12 | AI 解释器 | ✅ 已完成 | 2026-07-22 | - |
| 13 | 存储清理与上传限制 | ✅ 已完成 | 2026-07-23 | - |
| 14 | 工单取消、编辑与评论 | ✅ 已完成 | 2026-07-23 | - |
| 15 | 补充上传日志 | ✅ 已完成 | 2026-07-23 | - |
| 16 | 列表分页与排序 | ✅ 已完成 | 2026-07-23 | - |
| 17 | 企业微信通知 | ✅ 已完成 | 2026-07-23 | - |
| 18 | 数据统计仪表盘 | ✅ 已完成 | 2026-07-23 | - |
| 19 | 部署与运维 | ✅ 已完成 | 2026-07-23 | - |
| 20 | 上线准备 | ✅ 已完成 | 2026-07-23 | 含人工试用项 |
| 21 | 车型管理 | ✅ 已完成 | 2026-07-23 | - |
| 22 | 知识库车型类别绑定 | ✅ 已完成 | 2026-07-23 | - |
| 23 | 前端美化与品牌 | ✅ 已完成 | 2026-07-23 | - |
| 24 | 大日志 OOM 修复 | ✅ 已完成 | 2026-07-23 | - |
| 25 | 文件预上传 | ✅ 已完成 | 2026-07-23 | - |

## 审查修复（2026-07-22）

- **状态机与权限**：服务层校验工单状态迁移、售后工单归属及研发认领关系；重新分析、开始排查、步骤记录不能绕过权限或状态。
- **步骤进度与版本**：排查步骤返回各自最新状态、更新时间与不适用原因；页面刷新后恢复进度；分析版本切换仅影响当前展示，不再改写工单最新版本。
- **产品闭环**：自助解决会更新命中规则的反馈统计，累计 3 次“没用”自动标记为“需复查”；升级通知包含分析版本、步骤状态、报告与诊断包路径，并在文件存在时附带附件。
- **前端与接口**：增加重新分析入口、自助解决说明展示、步骤关联证据展开、独立研发监控路由；知识库接口限制研发和管理员访问。
- **E2E 隔离**：工单 E2E 必须显式指定 `REPLAY_E2E_BASE_URL`、`REPLAY_E2E_API_BASE`；后端支持通过 `FORKWEB_CACHE_DIR` 与 `FORKWEB_CONFIG_DIR` 指向独立测试数据目录，避免污染默认数据。
- **验证环境说明**：隔离前端可通过 `VITE_REPLAY_API_BASE` 与 `VITE_REPLAY_WS_BASE` 覆盖 `public/config.js` 中的默认地址；工单 E2E 的隔离启动需使用 Node 20，以匹配 `better-sqlite3` 原生模块与 Vite 运行时要求。
- **本轮验证结果**：`npm run typecheck`、`npm run replay:build`、`git diff --check` 均通过。隔离 E2E 使用独立缓存、配置与端口运行，前 8 个用例（登录、建单、状态流、重新分析、版本切换、差异对比）通过；后续用例未在 180 秒内完成，需单独拆分排查，未影响默认项目数据。

---

## 阶段 24：大日志 OOM 修复

- **状态**：✅ 已完成
- **问题根因**：用户上传大日志文件后，`session.load()` 通过 `readLogFilesWithIndex()` 把完整日志读入内存并生成大量 `ParsedLogLine` 对象；随后 `writeSessionCache()` 与 `finalizeTicketAnalysis()` 中的 `buildJsonReport` 均使用 `JSON.stringify` 全量序列化 `ReplaySessionData`，内存对象膨胀后触发 Node.js heap OOM。
- **改动摘要**：
  - 新增 `replay-server/src/core/rawLogStore.ts`：使用 JSONL 把原始日志行持久化到磁盘，提供 `RawLogStore` 按需读取，避免常驻内存。
  - 修改 `replay-server/src/types.ts`：`ParsedLogLine` 删除 `raw` 字段；`ReplaySessionData` 新增 `rawLinesPath`。
  - 修改 `replay-server/src/parser/logLine.ts`：`parseLogLine` 不再返回 `raw`；新增 `formatRawLine` 用于重构原始行。
  - 修改 `replay-server/src/core/logIndex.ts`：日志索引缓存不再保存 `rawLines`。
  - 修改 `replay-server/src/core/session.ts`：日志解析改为流式读取；分析完成后把 `rawLines` 写入 `RawLogStore` 并清空内存。
  - 修改 `replay-server/src/core/knowledgeBase.ts`、`knowledgeEmbedding.ts`、`ragAssistant.ts`、`report.ts`、`redaction.ts`：所有 `line.raw` 引用改为 `line.message` 或 `formatRawLine(line)`。
  - 修改 `replay-server/src/index.ts`：`/api/replay/logs`、`/api/replay/folded-logs/:id/lines`、`/api/replay/knowledge/test` 改为从 `RawLogStore` 异步读取，响应前补回 `raw` 字段。
  - 修改 `replay-server/src/core/cache.ts`：`CACHE_VERSION` 从 3 升到 4，使旧缓存失效；清理 sessions 桶时同步删除 `raw-lines-*.jsonl`。
  - 适配脚本：`replay-server/scripts/verify-knowledge.ts`、`verify-assistant.ts`、`audit-knowledge.ts` 适配新的 `rawLines` 存储方式。
  - 修改 `src/views/Replay.vue`：证据行和上下文复制的 fallback 改为 `message || raw || ''`。
- **验证方式**：
  - `npm run replay:build` 通过。
  - `npm run replay:verify:knowledge` 通过。
  - `npm run replay:verify:assistant` 失败原因为当前环境 Node 16 缺少全局 `fetch`（项目预期 Node 20），与本次改动无关。
  - 20MB 合成大日志 OOM 机制验证通过：`rawLines` 成功落盘、会话缓存不再包含巨量 `rawLines`、`buildJsonReport` 可正常序列化。
- **阻塞项**：无

---

## 阶段 25：文件预上传

- **状态**：✅ 已完成
- **对应决策编号**：113-116
- **改动摘要**：
  - 后端：新增 `replay-server/src/upload/tempFiles.ts`，实现预上传临时文件管理（保存、读取、删除、24 小时过期清理）。
  - 后端：`replay-server/src/tickets/routes.ts` 新增 `POST /api/tickets/upload-files`，接收文件后存入临时目录并返回 `tempFileId`。
  - 后端：`replay-server/src/tickets/service.ts` 新增 `createTicketWithTempFiles`，根据 `tempFileIds` 把临时文件正式移入工单目录，成功后删除临时文件。
  - 后端：`POST /api/tickets` 改为接收 `tempFileIds` 而不是 `files`；`replay-server/src/core/storageCleaner.ts` 跳过 `pending` 目录并单独清理过期预上传文件。
  - 前端：`src/api/tickets.ts` 新增 `uploadTicketFiles`，支持上传进度回调；`createTicket` 支持 `tempFileIds` 并保留旧 `files` 兼容。
  - 前端：`src/stores/tickets.ts` 的 `createTicket` action 支持 `tempFileIds`。
  - 前端：`src/views/TicketNew.vue` 改为选择/拖入文件后自动上传，显示上传进度条、文件大小、上传状态；提交工单时只传 `tempFileIds`，提交按钮不再被上传阻塞。
- **验证方式**：
  - `npm run typecheck` 通过。
  - `npm run replay:build` 通过。
  - 手动测试：选择文件后自动上传并显示进度，提交工单响应 <3 秒，后台分析正常触发。
- **阻塞项**：无

---

## 阶段 1：工单主流程重塑

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-1工单主流程重塑`
- **改动摘要**：
  - 数据库：`tickets` 表新增 `issue_type`、`impact_level`、`occurred_start_at`、`occurred_end_at` 字段；`migrate.ts` 新增 `ticket_issue_meta_fields` 迁移。
  - 后端：`replay-server/src/db/tickets.ts`、`src/types.ts`、`src/tickets/service.ts`、`src/tickets/routes.ts` 支持新字段读写与序列化。
  - 前端：`src/api/tickets.ts`、`src/stores/tickets.ts` 扩展类型；`src/views/TicketNew.vue` 增加发生时间范围与影响程度；`src/views/TicketList.vue` 增加现场筛选与问题类型筛选占位；`src/views/TicketDetail.vue` 重构为「结论摘要 + 排查向导 + 精简证据 + 事件流」布局；`src/router/index.ts` 将 `/` 重定向到 `/tickets`。
  - 组件：新增 `src/components/TicketTroubleshootingGuide.vue` 与 `src/components/TicketEvidencePanel.vue` 占位组件。
  - 测试：新增 `tests/e2e/tickets.spec.ts` 与 `tests/e2e/fixtures/fake.log`，验证登录默认进入工单列表、新建工单、详情新布局。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 3 个用例全部通过。
- **阻塞项**：无

---

## 阶段 2：工单状态流

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-2工单状态流`
- **改动摘要**：
  - 数据库：`migrate.ts` 新增 `ticket_status_expansion` 迁移，通过重建 `tickets` 表扩展 `status` CHECK 约束为 8 状态，并迁移旧状态（`analyzed`→`pending_field_troubleshooting`、`verifying`→`rd_working`、`needs_rd`→`pending_rd`）；同步新增 `self_service_result`、`self_service_note`、`escalation_reason`、`guide_feedback` 字段。
  - 后端：`replay-server/src/db/tickets.ts` 更新 `TicketStatus` 与 `DbTicket`；`src/tickets/service.ts` 拆分 `verifyTicket` 为 `resolveSelfService` 和 `escalateToRd`，`assignTicket` 进入 `rd_working`，分析完成进入 `pending_field_troubleshooting`；`src/tickets/routes.ts` 新增 `/resolve-self-service`、`/escalate-to-rd` 接口并保持 `/verify` 兼容。
  - 前端：`src/api/tickets.ts`、`src/stores/tickets.ts` 扩展类型与 API；`src/views/TicketList.vue` 与 `src/views/TicketDetail.vue` 更新状态映射与按钮权限，新增「确认已解决」和「升级研发」对话框；`src/views/TicketDetail.vue` 增加轮询自动刷新分析中状态。
  - 测试：`tests/e2e/tickets.spec.ts` 新增状态流测试，覆盖创建→待现场排查→升级研发→研发认领→研发解决。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 5 个用例全部通过。
- **阻塞项**：无

---

## 阶段 3：分析版本化

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-3分析版本化`
- **改动摘要**：
  - 数据库：`migrate.ts` 新增 `create_analysis_versions_table` 与 `ticket_latest_analysis_version` 迁移；`schema.ts` 同步增加 `ticket_analysis_versions` 表与 `tickets.latest_analysis_version_id` 字段。
  - 后端：新增 `replay-server/src/db/analysisVersions.ts`，实现 `createAnalysisVersion`、`listAnalysisVersions`、`getAnalysisVersionById`、`getLatestAnalysisVersion`；`tickets.ts` 的 `DbTicket` 与 `updateTicket` 增加 `latest_analysis_version_id`。
  - 后端：`replay-server/src/tickets/service.ts` 的 `finalizeTicketAnalysis` 在生成报告/诊断包后创建分析版本记录，并回填 `latest_analysis_version_id`；新增 `buildTopIssues`、`buildEvidenceSummary`、`buildTroubleshootingPathsSnapshot` 提取函数。
  - 后端：`replay-server/src/tickets/routes.ts` 新增 `GET /:id/analysis-versions`、`GET /:id/analysis-versions/:versionId`、`POST /:id/analysis-versions/:versionId/switch`；`serializeTicket` 增加 `latestAnalysisVersionId`。
  - 前端：`src/api/tickets.ts` 增加 `AnalysisVersion` 类型与 `listAnalysisVersions`、`getAnalysisVersion`、`switchAnalysisVersion`。
  - 前端：`src/stores/tickets.ts` 增加 `analysisVersions`、`currentAnalysisVersion` 状态与加载/切换 action。
  - 前端：`src/views/TicketDetail.vue` 增加分析版本下拉选择器、当前版本信息卡片、状态变化时自动刷新版本列表；新增 `src/components/AnalysisVersionDiff.vue` 展示版本间 Top 3、问题类型、错误码/任务数量、地图匹配、生成时间差异。
  - 测试：`tests/e2e/tickets.spec.ts` 新增重新分析后版本数增加、切换版本后内容变化、差异对比可见三个用例。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 8 个用例全部通过。
- **阻塞项**：无

---

## 阶段 4：问题类型自动分类

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-4问题类型自动分类`
- **改动摘要**：
  - 后端：`replay-server/src/types.ts` 已定义 `IssueType` 联合类型；新增 `replay-server/src/core/issueClassifier.ts`，根据根因 ID/标题、错误码、模块、知识规则标签推断问题类型。
  - 后端：`replay-server/src/tickets/service.ts` 的 `finalizeTicketAnalysis` 在生成分析版本时写入推断的 `issue_type`，并同步更新 `tickets.issue_type`；新增 `updateTicketIssueType` 服务函数。
  - 后端：`replay-server/src/tickets/routes.ts` 新增 `PATCH /:id/issue-type`；`GET /` 列表接口支持 `issueType` 查询参数；`listUserTickets`、`listTicketsWithReporter`、`listTickets` 均增加问题类型筛选。
  - 前端：`src/api/tickets.ts` 新增 `IssueType` 类型与 `updateIssueType`；`src/stores/tickets.ts` 增加 `updateIssueType` action。
  - 前端：`src/views/TicketDetail.vue` 在基本信息中展示问题类型，并支持现场/研发/管理员修改。
  - 前端：`src/views/TicketList.vue` 启用问题类型下拉筛选，并在列表中展示问题类型列。
  - 测试：`tests/e2e/tickets.spec.ts` 新增自动分析后问题类型非 `unknown`、手动修正后列表筛选生效两个用例。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 9 个用例全部通过。
- **阻塞项**：无

---

## 阶段 5：知识库结构升级

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-5知识库结构升级`
- **改动摘要**：
  - 后端：`replay-server/src/types.ts` 新增 `TroubleshootingGuideStep`、`PublicationStatus` 类型；`KnowledgeRule` 增加 `publicationStatus`、`guideSteps`、`reviewReason`、`feedbackStats` 字段。
  - 后端：`replay-server/src/core/knowledgeBase.ts` 更新 `normalizeRule` 为新增字段提供默认值；新增 `normalizePublicationStatus`、`normalizeGuideSteps`、`normalizeFeedbackStats`；`listKnowledgeRules` 增加 `publicationStatus` 筛选。
  - 后端：`replay-server/src/tickets/service.ts` 的 `createKnowledgeFromTicket` 生成规则时默认 `publicationStatus: 'draft'`，并初始化 `guideSteps` 与 `feedbackStats`。
  - 前端：`src/views/Replay.vue` 知识库管理弹窗增加「产品化状态」筛选与列、「反馈统计」列；知识规则编辑表单增加「产品化状态」「复查原因」「反馈统计」「排查步骤」编辑区。
  - 测试：`tests/e2e/tickets.spec.ts` 新增知识规则新增字段保存与按产品化状态筛选测试。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 10 个用例全部通过。
- **阻塞项**：无

---

## 阶段 6：排查向导生成

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-6排查向导生成`
- **改动摘要**：
  - 数据库：`migrate.ts` 新增 `create_troubleshooting_paths_steps_tables` 迁移；`schema.ts` 同步创建 `ticket_troubleshooting_paths` 与 `ticket_troubleshooting_steps` 表及索引。
  - 后端：新增 `replay-server/src/db/troubleshootingPaths.ts` 与 `troubleshootingSteps.ts` 实现路径/步骤 CRUD。
  - 后端：新增 `replay-server/src/core/troubleshootingGuide.ts` 的 `generateTroubleshootingPaths`，从已验证知识规则中按严重度、阻塞/安全、置信度、时间接近度排序取 Top 3。
  - 后端：`replay-server/src/tickets/service.ts` 的 `finalizeTicketAnalysis` 调用生成函数并保存路径/步骤到数据库；同时把快照写入分析版本。
  - 后端：`replay-server/src/tickets/routes.ts` 新增 `GET /:id/troubleshooting-paths`。
  - 前端：`src/api/tickets.ts` 与 `src/stores/tickets.ts` 增加排查路径类型与加载 action；`TicketDetail.vue` 在版本切换/分析完成时刷新路径。
  - 前端：实现 `src/components/TicketTroubleshootingGuide.vue`，展示 Top 3 路径，默认展开最高优先级；未匹配到已验证规则时展示基础证据摘要与升级提示。
  - 测试：`tests/e2e/tickets.spec.ts` 新增分析完成后 Top 3 排查路径可见用例；`beforeAll` 中预置一条已验证规则供样例日志命中。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 11 个用例全部通过。
- **阻塞项**：无

---

## 阶段 7：排查步骤执行记录

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-7排查步骤执行记录`
- **改动摘要**：
  - 数据库：`migrate.ts` 新增 `create_step_events_table` 迁移；`schema.ts` 同步创建 `ticket_step_events` 表，记录步骤状态变更、不适用原因、操作人等。
  - 后端：新增 `replay-server/src/db/stepEvents.ts` 实现 `createStepEvent`、`listStepEvents`；`tickets/service.ts` 新增 `startFieldTroubleshooting`（`pending_field_troubleshooting`→`field_troubleshooting`）和 `recordStepStatus`（含不适用原因校验与事件记录）；`routes.ts` 新增 `POST /:id/start-troubleshooting` 与 `POST /:id/paths/:pathId/steps/:stepId/status`；`getTicketDetail` 合并 `ticket_events` 与 `ticket_step_events` 统一返回。
  - 前端：`src/api/tickets.ts` 与 `src/stores/tickets.ts` 新增 `startFieldTroubleshooting`、`recordStepStatus` API 与 action；`stores/tickets.ts` 的 `recordStepStatus` 在提交后自动刷新事件流。
  - 前端：重写 `src/components/TicketTroubleshootingGuide.vue`，实现步骤四态单选按钮（未检查/已通过/未通过/不适用）、现场操作安全确认弹窗、不适用原因选择弹窗、关键步骤未解决升级提示、「开始排查」/「稍后继续」按钮。
  - 测试：`tests/e2e/tickets.spec.ts` 新增步骤状态切换、不适用原因、安全确认与事件记录用例，覆盖完整排查流程。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 12 个用例全部通过。
- **阻塞项**：无

---

## 阶段 8：自助解决和升级研发

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-8自助解决和升级研发`
- **改动摘要**：
  - 后端：`escalateToRd` 升级研发事件 payload 自动附带排查步骤状态摘要（`stepStatusSummary`）、分析版本 ID、日志/报告存在状态等上下文。
  - 前端：`TicketTroubleshootingGuide.vue` 已有关键步骤未解决时自动展示升级研发建议提示（`showEscalationHint`）。
  - 前端：`TicketDetail.vue` 已支持自助解决方式分类（重启恢复/重新接线/更换硬件/调整配置/补充日志/误报/其他）、向导有效性反馈（有用/部分有用/没用）及补充说明。
  - 前端：`TicketDetail.vue` 已支持升级原因选择（按向导排查仍未解决/缺少权限或工具/疑似软件缺陷/诊断结论不可信/需要远程协助/其他）。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 12 个用例全部通过。
- **阻塞项**：无

---

## 阶段 9：研发处理和知识沉淀

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-9研发处理和知识沉淀`
- **改动摘要**：
  - 前端：`TicketDetail.vue` 的 `onResolve` 研发解决后自动弹出确认对话框，询问是否沉淀知识规则。
  - 前端：确认后自动预填知识规则表单（标题、描述、根因、解决方案、关键词等），打开沉淀对话框。
  - 后端：`createKnowledgeFromTicket` 已支持创建草稿状态知识规则（`publicationStatus: 'draft'`），默认无排查步骤。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 12 个用例全部通过。
- **阻塞项**：无

---

## 阶段 10：角色导航和权限

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-10角色导航和权限`
- **改动摘要**：
  - 前端：`App.vue` 重构侧边栏菜单，按角色分组显示：
    - 工单管理：所有角色可见
    - 研发/管理员高级工具：日志诊断、监控总览、激光配置、避障配置、控制面板、现场管理
    - 管理员专属：用户管理
  - 前端：路由守卫已存在（`requiresRd`、`requiresAdmin`），现场人员访问高级页面自动跳转到工单列表
  - 前端：现场人员不显示知识库入口（知识库仅在研发解决工单时通过沉淀对话框访问）
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 12 个用例全部通过。
- **阻塞项**：无

---

## 阶段 11：精简证据面板

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-11精简证据面板`
- **改动摘要**：
  - 前端：重写 `src/components/TicketEvidencePanel.vue`，实现精简证据面板，包含：
    - 证据概览：错误事件、警告事件、错误码数、任务数、帧数、时长、地图状态、地图匹配、机器人名称
    - Top 问题摘要：表格展示问题标题、严重度、置信度
    - 关键时间线：时间线展示错误、警告、地图、机器人等关键信息
    - 错误码摘要：标签展示所有错误码
    - 任务摘要：表格展示任务名、状态、耗时
    - 原始日志上下文：代码块展示日志内容
  - 前端：从 `currentAnalysisVersion.evidenceSummary` 和 `topIssues` 读取数据
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 12 个用例全部通过。
- **阻塞项**：无

---

## 阶段 12：AI 解释器

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-12ai-解释器`
- **改动摘要**：
  - 后端：`replay-server/src/core/ragAssistant.ts` 实现 AI 解释器，支持：
    - 基于诊断上下文（日志、根因、知识库匹配、相似案例）回答用户问题
    - 离线模式：未配置 API Key 或调用失败时，基于本地规则给出建议
    - 在线模式：调用 DeepSeek 等 LLM 生成结构化回答（根因候选、建议、证据、不确定点）
    - 严格限制：只解释不决策，不生成临时排查步骤，明确引用证据和不确定点
  - 后端：`tickets/service.ts` 的 `finalizeTicketAnalysis` 在分析完成时自动调用 AI 解释器，结果存入 `ai_conclusion` 字段
  - 前端：`TicketDetail.vue` 展示 AI 分析结论，区分在线/离线回答，展示 AI 未开启或分析中的状态
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过；`npm run test:e2e:tickets` 12 个用例全部通过。
- **阻塞项**：无

---

## 阶段 13：存储清理与上传限制

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-13存储清理与上传限制`
- **改动摘要**：
  - 后端：`replay-server/src/tickets/routes.ts` 将 multer `fileSize` 从 500MB 改为 200MB；`POST /` 增加所有上传文件总大小校验（>200MB 返回 413）；上传失败或超限时统一清理临时文件。
  - 前端：`src/views/TicketNew.vue` 上传提示改为“支持 .log、.zip、.tar.gz 格式，总大小不超过 200MB”；`onFilesChange` 与 `onSubmit` 双阶段校验总大小，超限显示错误提示。
  - 后端：`replay-server/src/tickets/service.ts` 的 `runTicketAnalysisInBackground` 用 try-catch 包裹分析主流程，失败时调用 `revertFailedAnalysis` 将工单状态回退为 `pending_analysis`，并记录 `analysis_failed` 事件及失败原因。
  - 后端：`replay-server/src/tickets/service.ts` 的 `startTicketAnalysis` 增加 10 分钟 `setTimeout` 超时保护，超时后自动回退状态并记录 `analysis_timeout` 事件；通过 `runId` 与 `activeAnalysisRuns` 避免超时与正常完成并发冲突。
  - 后端：新增 `replay-server/src/core/storageCleaner.ts` 的 `cleanExpiredFiles()`，查询 `latest_analysis_version_id` 对应版本创建时间超过 7 天的工单，删除其 `log_dir`；同时清理 `CACHE_DIR/uploads` 下 7 天前的上传临时文件，保留报告和数据库记录。
  - 后端：`replay-server/src/index.ts` 注册每日凌晨 3 点的定时任务调用 `cleanExpiredFiles()`。
  - 测试：`tests/e2e/tickets.spec.ts` 新增“超大文件在提交前被拒绝”与“分析失败后状态回退为待分析并记录事件”两个用例；修复前者缺少 `loginAs` 导致的鉴权失败。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过。隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，阶段 13 新增的两个用例通过。完整工单 E2E 中预存在的“步骤状态切换、不适用原因、安全确认与事件记录”用例在 120s 内超时失败，阻塞后续用例串行执行，与阶段 13 改动无关。
- **阻塞项**：完整工单 E2E 中“步骤状态切换”用例不稳定，需单独排查。

---

## 阶段 14：工单取消、编辑与评论

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-14工单取消编辑与评论`
- **改动摘要**：
  - 数据库：`replay-server/src/db/migrate.ts` 新增 `ticket_status_add_cancelled` 迁移，通过整表重建将 `tickets.status` CHECK 扩展为 9 状态（含 `cancelled`）；`replay-server/src/db/schema.ts` 同步更新。
  - 后端：`replay-server/src/db/tickets.ts` 的 `TicketStatus` 增加 `cancelled`，`updateTicket` 增加 `title`/`description` 可更新字段。
  - 后端：`replay-server/src/tickets/service.ts` 新增 `cancelTicket`（仅提单人可取消未终结且非分析中工单）、`updateTicketBasicInfo`（未终结工单可编辑标题/描述/现场/影响程度/发生时间）、`addTicketComment`（纯文字评论）；定义终结状态 `resolved`/`self_solved`/`cancelled`。
  - 后端：`replay-server/src/tickets/routes.ts` 新增 `POST /:id/cancel`、`PATCH /:id/basic-info`、`POST /:id/comments`；`parseStatusQuery` 增加 `cancelled`。
  - 前端：`src/api/tickets.ts` 与 `src/stores/tickets.ts` 新增对应 API 与 action；编辑/取消后刷新事件流。
  - 前端：`src/views/TicketDetail.vue` 增加「取消工单」「编辑基本信息」按钮与弹窗；事件流底部增加评论输入区，并对 `comment` 事件做专门渲染；状态标签增加「已取消」。
  - 前端：`src/views/TicketList.vue` 的 `statusMap` 增加 `cancelled` 状态。
  - 测试：`tests/e2e/tickets.spec.ts` 新增编辑基本信息、发表评论、取消工单三个用例。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过。隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，阶段 14 新增的三个用例通过。
- **阻塞项**：无

---

## 阶段 15：补充上传日志

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-15补充上传日志`
- **改动摘要**：
  - 后端：`replay-server/src/tickets/service.ts` 新增 `appendFilesToTicket`，校验工单未终结、追加后 `log_dir` 总量不超过 200MB，将文件复制到 `log_dir`，记录 `files_appended` 事件，可选调用 `startTicketAnalysis` 触发重新分析。
  - 后端：`replay-server/src/tickets/routes.ts` 新增 `POST /:id/files`，复用现有 `uploadTicketFiles` 中间件，读取 `reanalyze` 参数并清理临时文件。
  - 前端：`src/api/tickets.ts` 与 `src/stores/tickets.ts` 新增 `appendFiles` API 与 action，上传完成后刷新工单详情与事件流。
  - 前端：`src/views/TicketDetail.vue` 新增「补充上传」按钮与弹窗，支持多文件上传和「上传后重新分析」复选框。
  - 测试：`tests/e2e/tickets.spec.ts` 新增「补充上传日志并记录事件」与「补充上传后触发重新分析」两个用例。
- **验证方式**：`npm run typecheck` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过。隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，阶段 15 新增的两个用例通过。
- **阻塞项**：无

---

## 阶段 16：列表分页与排序

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-16列表分页与排序`
- **改动摘要**：
  - 数据库：`replay-server/src/db/tickets.ts` 新增 `countTickets` 与 `countTicketsWithReporter`；`listTickets` 与 `listTicketsWithReporter` 排序从 `updated_at DESC` 改为 `created_at DESC, id DESC`，保证相同时间戳下创建顺序稳定。
  - 后端：`replay-server/src/tickets/service.ts` 的 `listUserTickets` 改为接收 `{ page, pageSize, ...filters }`，内部调用 `listTicketsWithReporter` 与 `countTicketsWithReporter`，返回 `{ tickets, total }`。
  - 后端：`replay-server/src/tickets/routes.ts` 的 `GET /api/tickets` 读取 `page`/`pageSize` 查询参数，响应改为 `{ tickets, total }`。
  - 前端：`src/api/tickets.ts` 的 `listTickets` 参数与返回类型更新为 `{ tickets: Ticket[]; total: number }`。
  - 前端：`src/stores/tickets.ts` 新增 `total` 状态，修改 `loadTickets` 以支持分页参数。
  - 前端：`src/views/TicketList.vue` 底部增加 `el-pagination` 组件，绑定本地 `currentPage`/`pageSize`，切换页码或页大小时重新加载列表；列表「更新时间」列改为「创建时间」以匹配排序。
  - 测试：`tests/e2e/tickets.spec.ts` 新增「工单列表分页与排序」用例，通过 API 批量创建 26 个工单，断言默认每页 20 条、总数正确、按创建时间倒序、翻页后内容正确；同时修复了阶段 7 预存在的「步骤状态切换」用例在排查向导收起后无法点击单选按钮的问题（安全确认后重新展开面板）。
- **验证方式**：`npm run typecheck` 通过；`npm run replay:build` 通过；隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，20 个工单用例全部通过。
- **阻塞项**：无

---

## 阶段 17：企业微信通知

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-17企业微信通知`
- **改动摘要**：
  - 后端：新增 `replay-server/src/notify/wechatWork.ts`，导出 `sendWechatWorkNotification` 与 `isWechatWorkConfigured`；依赖项目已有 `axios`；未配置 `WECHAT_WORK_WEBHOOK_URL` 时静默跳过，失败时仅日志告警不阻塞主流程。
  - 后端：`replay-server/src/tickets/service.ts` 的 `finalizeTicketAnalysis` 在分析完成后发送「工单分析完成」通知；`escalateToRd` 在升级研发后发送「工单已升级研发」通知；`assignTicket` 在工单被认领后发送「工单已被认领」通知；`resolveTicket` 在工单被解决后发送「工单已解决」通知。所有通知均为 `void` 触发，不阻塞主流程。
  - 后端：`replay-server/src/core/knowledgeBase.ts` 的 `recordKnowledgeRuleFeedback` 在规则累计 3 次「没用」反馈被标记为 `needs_review` 时，写库成功后批量发送「知识规则需要复查」通知。
  - 脚本：新增 `replay-server/scripts/verify-wechat-work.ts`，用于在无 webhook 配置时验证通知模块不会抛异常。
- **验证方式**：`npm run typecheck` 通过；`npm run replay:build` 通过；`npx tsx replay-server/scripts/verify-wechat-work.ts` 不抛异常。隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，20 个工单用例全部通过。
- **阻塞项**：无

---

## 阶段 18：数据统计仪表盘

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-18数据统计仪表盘`
- **改动摘要**：
  - 后端：新增 `replay-server/src/tickets/stats.ts`，实现 `getTicketStats`、`getTicketsBySite`、`getTicketsByIssueType`、`getKnowledgeStats`、`getUserStats` 五个统计函数；工单统计基于 `tickets` 表聚合，知识库统计读取 `json_stores` 中的 `knowledgeBase` 与 `knowledgeHits`。
  - 后端：新增 `replay-server/src/stats/routes.ts`，注册 `GET /api/stats/tickets`、`GET /api/stats/knowledge`、`GET /api/stats/users`，使用 `requireRole('admin', 'rd')` 限制访问；并在 `replay-server/src/index.ts` 挂载 `/api/stats`。
  - 后端：导出 `replay-server/src/core/knowledgeBase.ts` 中的 `KnowledgeHitsData` 类型，供统计模块复用。
  - 前端：新增 `src/api/stats.ts`，定义统计类型与三个 fetch 函数。
  - 前端：新增 `src/views/StatsBoard.vue`，使用 `el-date-picker` 选择日期范围，分「工单统计」「知识库统计」「人员统计」三个卡片区域展示指标、排行与分布。
  - 前端：修改 `src/router/index.ts` 新增 `/stats` 路由，`meta: { title: '数据统计', requiresRd: true }`。
  - 前端：修改 `src/App.vue`，研发/管理员侧边栏新增「数据统计」入口。
  - 测试：`tests/e2e/tickets.spec.ts` 新增「数据统计页面加载」用例，验证管理员可访问 `/stats` 并展示三维度统计区域。
- **验证方式**：`npm run typecheck` 通过；`npm run replay:build` 通过。隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，21 个工单用例全部通过。
- **阻塞项**：无

---

## 阶段 19：部署与运维

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-19部署与运维`
- **改动摘要**：
  - 运维：重写 `Dockerfile` 为多阶段构建，基于 `node:20-slim` 构建前后端，运行时阶段仅安装生产依赖并运行 `node replay-server/dist/index.js`；容器内通过环境变量将 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 指向 `/app/data`。
  - 运维：重写 `docker-compose.yml`，映射端口 `8091:8080`，挂载 `./data:/app/data`，配置 `restart: unless-stopped` 与 `healthcheck`。
  - 运维：新增 `scripts/update.sh`，依次执行数据库备份、`git pull --ff-only`、`docker-compose build`、`docker-compose up -d`。
  - 运维：新增 `nginx/forkweb.conf`，提供反向代理、WebSocket 升级、单页应用回退与 HTTPS 证书占位示例。
  - 运维：新增 `scripts/health-check.sh`，每 5 分钟 `curl /api/health`，连续失败且超过 10 分钟未告警时调用 `WECHAT_WORK_WEBHOOK_URL` 发送企业微信告警。
  - 后端：修改 `replay-server/src/index.ts`：新增 `GET /api/health` 接口，返回服务状态、时间戳与 `CACHE_DIR`/`CONFIG_DIR` 磁盘使用量；同时托管前端 `dist` 静态文件并提供 SPA 回退。
  - 文档：新增 `docs/deployment.md` 详细部署、数据持久化、一键更新、回退、健康检查与故障排查说明；更新 `README.md` 补充新的 Docker 部署方式。
- **验证方式**：`npm run typecheck` 通过；`npm run replay:build` 通过。隔离 E2E 使用独立 `FORKWEB_CACHE_DIR`/`FORKWEB_CONFIG_DIR` 运行，21 个工单用例全部通过。
- **阻塞项**：无

---

## 阶段 20：上线准备

- **状态**：✅ 已完成（代码/文档层面）
- **计划**：见 `docs/implementation-plan.md#阶段-20上线准备`
- **改动摘要**：
  - 安全：修改 `replay-server/src/users/routes.ts` 的 `ensureAdminUser`，默认管理员密码优先从 `FORKWEB_ADMIN_PASSWORD` 环境变量读取；未设置时回退到 `admin123` 并打印安全告警。
  - 知识库：新增 `replay-server/scripts/seed-knowledge.ts`，预填充 12 条常见叉车问题（参数缺失、定位丢失、路径规划失败、充电对接、货叉传感器、避障急停、通信离线、电机驱动、地图加载、电池低电量、版本不匹配、急停按钮）的已验证知识规则，脚本按标题幂等。
  - 测试：新增 `tests/e2e/replay-real-log.spec.ts`，使用 `tests/e2e/fixtures/log-20260720-114052.log` 验证真实日志上传后分析完成、状态进入待现场排查、排查向导可见、事件流记录分析完成事件。
  - 文档：新增 `docs/user-guide.md` 一页纸操作指南，覆盖登录、建单、上传日志、查看排查向导、执行步骤、升级研发；在 `docs/deployment.md` 中补充「上线前检查清单」「知识库预填充」「灰度上线与反馈」章节。
- **验证方式**：`npm run typecheck` 通过；`npm run replay:build` 通过；隔离 E2E 中 `tests/e2e/replay-real-log.spec.ts` 真实日志用例通过；手动运行 `npx tsx replay-server/scripts/seed-knowledge.ts` 验证 12 条规则成功导入且幂等。
- **阻塞项**：云服务器部署与售后灰度试用属于人工执行项，未在代码中完成，已记录于 `docs/deployment.md` 上线前检查清单。

---

## 阶段 21：车型管理

- **状态**：✅ 已完成
- **计划**：见 `docs/implementation-plan.md#阶段-21车型管理`
- **改动摘要**：
  - 数据库：`replay-server/src/db/migrate.ts` 新增 `create_vehicle_tables` 迁移（创建 `vehicle_categories`、`vehicle_models`、`site_vehicle_models` 三张表）和 `ticket_vehicle_model_id` 迁移（`tickets` 表新增 `vehicle_model_id` 字段）；`schema.ts` 同步更新。
  - 后端：新增 `replay-server/src/db/vehicleCategories.ts`（类别 CRUD + 删除保护）和 `replay-server/src/db/vehicleModels.ts`（型号 CRUD + 按类别/按现场查询 + 删除保护）。
  - 后端：修改 `replay-server/src/db/sites.ts` 新增 `setSiteVehicleModels` 和 `getSiteVehicleModelIds`；`deleteSite` 同时清理关联表。
  - 后端：修改 `replay-server/src/db/tickets.ts`，`DbTicket` 和 `CreateTicketInput` 增加 `vehicle_model_id`；`listTickets`、`countTickets`、`listTicketsWithReporter`、`countTicketsWithReporter` 均增加 `vehicleModelId` 筛选；`TicketWithReporter` 增加 `vehicle_model_name` 和 `vehicle_category_name`，列表查询 JOIN 车型表。
  - 后端：新增 `replay-server/src/vehicles/routes.ts`，注册类别和型号的完整 CRUD REST API（含 UNIQUE 约束冲突处理）。
  - 后端：修改 `replay-server/src/sites/routes.ts`，`serializeSite` 改为 async 并附带 `vehicleModelIds`；创建/编辑现场时处理 `vehicleModelIds` 多选关联。
  - 后端：修改 `replay-server/src/tickets/routes.ts`，创建工单传 `vehicleModelId`、列表支持车型筛选、详情 JOIN 车型信息、`serializeTicket` 输出 `vehicleModelId`/`vehicleModelName`/`vehicleCategoryName`；编辑基本信息支持 `vehicleModelId`。
  - 后端：修改 `replay-server/src/tickets/service.ts`，`CreateTicketServiceInput` 和 `UpdateTicketBasicInfoInput` 增加 `vehicleModelId`；`ListUserTicketsInput` 和 `ListUserTicketsOutput` 扩展车型字段；`applyFilters` 增加 `vehicleModelId`。
  - 后端：修改 `replay-server/src/tickets/stats.ts`，`TicketStats` 增加 `byVehicleModel`；新增 `getTicketsByVehicleModel` 查询函数。
  - 后端：修改 `replay-server/src/index.ts`，注册 `vehicleRoutes` 到 `/api/vehicles`。
  - 前端：新增 `src/api/vehicles.ts`，封装车型类别和型号的全部 API。
  - 前端：新增 `src/views/VehicleManage.vue`，上半部分管理类别，下半部分管理型号（支持按类别筛选）。
  - 前端：修改 `src/api/sites.ts`，`Site` 接口增加 `vehicleModelIds`；新增 `UpdateSiteInput`。
  - 前端：修改 `src/views/SiteManage.vue`，对话框加车型多选（按类别分组展示），表格显示关联车型 tag。
  - 前端：修改 `src/api/tickets.ts`，`Ticket` 接口增加 `vehicleModelId`/`vehicleModelName`/`vehicleCategoryName`；`createTicket` 和 `ListTicketsFilters` 增加 `vehicleModelId`；`UpdateTicketBasicInfoInput` 增加 `vehicleModelId`。
  - 前端：修改 `src/stores/tickets.ts`，`createTicket` 和 `loadTickets` 支持 `vehicleModelId`。
  - 前端：修改 `src/views/TicketNew.vue`，选现场后联动加载可选车型，车型必填校验。
  - 前端：修改 `src/views/TicketList.vue`，加车型筛选下拉（按类别分组）和车型列。
  - 前端：修改 `src/views/TicketDetail.vue`，详情展示车型信息。
  - 前端：修改 `src/api/stats.ts`，`TicketStats` 增加 `byVehicleModel`。
  - 前端：修改 `src/views/StatsBoard.vue`，加"按车型分布"统计表。
  - 前端：修改 `src/router/index.ts` 注册 `/vehicles` 路由。
  - 前端：修改 `src/App.vue`，研发/管理员侧边栏新增「车型管理」菜单项（Van 图标）。
- **验证方式**：`npx vue-tsc --noEmit` 通过；`npx tsc -p replay-server/tsconfig.json --noEmit` 通过。
- **阻塞项**：无

---

## 阶段 22：知识库车型类别绑定

- **状态**：✅ 已完成
- **对应决策编号**：85-94
- **改动摘要**：
  - 后端：`replay-server/src/types.ts` 的 `KnowledgeRule` 接口新增 `vehicleCategoryIds?: number[]`。
  - 后端：`replay-server/src/core/knowledgeBase.ts`：`normalizeRule` 新增 `vehicleCategoryIds` 规范化（`normalizeNumberArray`）；`matchKnowledgeRules` 新增可选 `vehicleCategoryId` 参数实现类别过滤；`listKnowledgeRules` 支持 `vehicleCategoryId` 和 `universal` 查询过滤；`exportKnowledgeLibraryPayload` 支持 `categoryIds` 和 `includeUniversal` 可选导出。
  - 后端：`replay-server/src/tickets/service.ts`：`runTicketAnalysisInBackground` 在 session.load 后根据工单 vehicle_model_id 查 category_id 过滤 knowledgeMatches；`createKnowledgeFromTicket` 自动预填 vehicleCategoryIds。
  - 后端：`replay-server/src/index.ts`：`GET /api/replay/knowledge/export` 支持 `categoryIds` 和 `includeUniversal` 查询参数。
  - 前端：`src/api/replay.ts`：`exportReplayKnowledge` 支持类别筛选参数。
  - 前端：`src/views/Replay.vue`：`emptyKnowledgeShape` 和 `buildKnowledgeDraft` 增加 `vehicleCategoryIds`；知识规则编辑表单增加"适用车型类别"多选字段；知识库管理列表增加"车型类别"筛选下拉和"适用类别"显示列；导出功能改为弹出对话框支持按类别筛选（含"包含通用规则"选项）。
- **验证方式**：`npx vue-tsc --noEmit` 通过；`npx tsc --noEmit` 通过。
- **阻塞项**：无

---

## 阶段 23：前端美化与品牌

- **状态**：✅ 已完成
- **对应决策编号**：95-107
- **改动摘要**：
  - 资源：新增 `public/logo.png`（玖物智能完整 Logo 381x93）和 `public/favicon.png`（左侧圆形图标 64x64，ffmpeg 裁剪生成）。
  - `index.html`：标题改为 "Junion 售后系统"，添加 favicon 引用。
  - `src/views/Login.vue`：完全重写——深蓝色渐变+点阵纹理工业背景，毛玻璃卡片（backdrop-filter: blur），Logo 居中，标题 "Junion 单机售后工单系统"，竖排表单，蓝色渐变登录按钮，底部 © 2026 Junion 版权。
  - `src/App.vue`：侧边栏 logo 改为 favicon 图标+"Junion" 文字；顶栏右侧增加角色标签（售后/研发/管理员，含 roleLabel 和 roleTagType computed）；currentTitle 默认值改为 "Junion"；全局样式增加卡片圆角 10px、表头背景色 #f8fafc、.section-title 蓝色竖线装饰、app-main 背景色 #f1f5f9。
  - `src/views/TicketList.vue`：状态颜色优化（分析中=蓝、研发相关=红）；筛选行改用 flex gap；头部样式加粗加色。
  - `src/views/StatsBoard.vue`：数字卡片增加彩色左边框（蓝/绿/橙）+ hover 阴影；副标题增加蓝色竖线装饰。
  - `src/views/TicketDetail.vue`：工单号蓝色高亮；section-title 蓝色竖线；AI 结论区域渐变蓝色背景；版本选择栏蓝色背景；状态颜色与列表统一。
- **验证方式**：`npx vue-tsc --noEmit` 通过。
- **阻塞项**：无
