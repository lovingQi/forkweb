# forkweb 工单驱动自助诊断系统实施计划

> 依据：`docs/product-development-todo.md`  
> 决策确认：严格按阶段 1→12 顺序开发；使用 `migrate.ts` 新增迁移；AI 保持可选离线；每阶段补充 Playwright E2E；持续更新 `docs/implementation-progress.md`。

---

## 1. 进度文档约定

- 进度文档路径：`docs/implementation-progress.md`
- 格式：每阶段一个章节，包含「状态」「改动摘要」「验证方式」「阻塞项」。
- 每完成一个阶段，立即追加或更新该章节，并在顶部总览表中标记阶段状态。

---

## 2. 全局数据模型约定

以下新增表/字段贯穿多个阶段，统一约定字段名与类型。

### 2.1 `tickets` 表新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `issue_type` | TEXT | 问题类型枚举（阶段 4） |
| `impact_level` | TEXT | 影响/紧急程度：`low`/`medium`/`high`/`critical` |
| `occurred_start_at` | TEXT | 问题发生起始时间 ISO |
| `occurred_end_at` | TEXT | 问题发生结束时间 ISO |
| `latest_analysis_version_id` | INTEGER | 指向 `ticket_analysis_versions.id`（阶段 3） |
| `self_service_result` | TEXT | 自助解决方式分类（阶段 8） |
| `self_service_note` | TEXT | 自助解决补充说明 |
| `escalation_reason` | TEXT | 升级研发原因（阶段 8） |
| `guide_feedback` | TEXT | 向导有效性反馈：`useful`/`partial`/`useless`（阶段 8） |

### 2.2 新增表

#### `ticket_analysis_versions`（阶段 3）

```sql
CREATE TABLE IF NOT EXISTS ticket_analysis_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  input_log_dir TEXT NOT NULL,
  input_map_dir TEXT,
  input_map_file TEXT,
  input_package_source TEXT,
  occurred_start_at TEXT,
  occurred_end_at TEXT,
  issue_type TEXT,
  top_issues TEXT NOT NULL,
  troubleshooting_paths_snapshot TEXT,
  evidence_summary TEXT,
  report_path TEXT,
  package_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  UNIQUE(ticket_id, version_no)
);
CREATE INDEX IF NOT EXISTS idx_analysis_versions_ticket ON ticket_analysis_versions(ticket_id);
```

#### `ticket_troubleshooting_paths`（阶段 6/7）

```sql
CREATE TABLE IF NOT EXISTS ticket_troubleshooting_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  analysis_version_id INTEGER NOT NULL,
  rule_id TEXT NOT NULL,
  title TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (analysis_version_id) REFERENCES ticket_analysis_versions(id)
);
```

#### `ticket_troubleshooting_steps`（阶段 5/7）

```sql
CREATE TABLE IF NOT EXISTS ticket_troubleshooting_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  instruction TEXT,
  criteria TEXT,
  step_type TEXT NOT NULL,
  estimated_time TEXT,
  evidence_config TEXT,
  is_critical INTEGER NOT NULL DEFAULT 0,
  failure_action TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (path_id) REFERENCES ticket_troubleshooting_paths(id)
);
```

#### `ticket_step_events`（阶段 7）

```sql
CREATE TABLE IF NOT EXISTS ticket_step_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  analysis_version_id INTEGER NOT NULL,
  path_id INTEGER NOT NULL,
  step_id INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  FOREIGN KEY (analysis_version_id) REFERENCES ticket_analysis_versions(id),
  FOREIGN KEY (path_id) REFERENCES ticket_troubleshooting_paths(id),
  FOREIGN KEY (step_id) REFERENCES ticket_troubleshooting_steps(id),
  FOREIGN KEY (actor_id) REFERENCES users(id)
);
```

### 2.3 知识规则字段扩展（阶段 5）

在 `KnowledgeRule` 中新增：

- `guideSteps?: TroubleshootingGuideStep[]`
- `publicationStatus: 'draft' | 'verified' | 'needs_review' | 'deprecated'`
- `reviewReason?: string`
- `feedbackStats: { useful: number; partial: number; useless: number }`

---

## 3. 阶段实施清单

### 阶段 1：工单主流程重塑

目标：现场人员登录后默认落地工单列表；新建工单极简；详情页首屏改为「结论摘要 + 排查向导」布局，下方预留精简证据面板。

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `ticket_issue_meta_fields`，为 `tickets` 表添加 `issue_type`、`impact_level`、`occurred_start_at`、`occurred_end_at` 字段。
2. [ ] 修改 `replay-server/src/db/schema.ts` 中的 `tickets` 定义，加入上述字段及 `CHECK`（`impact_level` 可为空或 `low/medium/high/critical`）。
3. [ ] 修改 `replay-server/src/db/tickets.ts` 中的 `DbTicket` 类型与 CRUD 函数，支持新增字段读写。
4. [ ] 修改 `replay-server/src/types.ts`，新增 `IssueType` 与 `ImpactLevel` 类型（`IssueType` 先全部包含并在阶段 4 完善）。
5. [ ] 修改 `replay-server/src/tickets/routes.ts` 中 `POST /` 解析逻辑：读取 `impactLevel`、`occurredStartAt`、`occurredEndAt`，传入 `createTicketWithUploads`。
6. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `CreateTicketServiceInput` 与 `createTicketWithUploads`，将新增字段写入数据库。
7. [ ] 修改 `src/api/tickets.ts` 中 `Ticket` 类型与 `createTicket` 函数，新增可选字段。
8. [ ] 修改 `src/views/TicketNew.vue`：增加「发生时间」日期时间选择器（支持范围）、「影响程度」单选/下拉，保持可选。
9. [ ] 修改 `src/views/TicketList.vue`：保留状态筛选，将「提单人筛选」改为仅当研发/管理员且需要时显示；增加「项目现场筛选」与「问题类型筛选」占位（问题类型数据阶段 4 填充）。
10. [ ] 重构 `src/views/TicketDetail.vue` 布局：顶部改为左右两栏，左侧为「结论摘要 + 基本信息」，右侧为「排查向导」占位容器；下方新增「精简证据面板」占位容器。
11. [ ] 新增 `src/components/TicketTroubleshootingGuide.vue` 占位组件（阶段 6 填充内容）。
12. [ ] 新增 `src/components/TicketEvidencePanel.vue` 占位组件（阶段 11 填充内容）。
13. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：测试现场人员登录后跳转 `/tickets`；新建工单只填标题、现场、描述、文件并提交成功；详情页可见新的布局占位。
14. [ ] 更新 `docs/implementation-progress.md`，标记阶段 1 完成。

### 阶段 2：工单状态流

目标：实现新的 8 状态工单状态机与状态迁移规则，并更新列表/详情/按钮文案。

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `ticket_status_expansion`，修改 `tickets.status` 的 `CHECK` 约束。由于 SQLite 不支持直接修改 `CHECK`，采用「创建临时表 → 迁移数据 → 删除旧表 → 重命名」方案。
2. [ ] 修改 `replay-server/src/db/schema.ts` 中 `tickets.status` 的定义为新 8 状态：`pending_analysis`、`analyzing`、`pending_field_troubleshooting`、`field_troubleshooting`、`self_solved`、`pending_rd`、`rd_working`、`resolved`。
3. [ ] 修改 `replay-server/src/db/tickets.ts` 中 `TicketStatus` 类型为新 8 状态，并同步更新查询函数。
4. [ ] 修改 `src/api/tickets.ts` 中 `TicketStatus` 类型为新 8 状态。
5. [ ] 修改 `src/views/TicketList.vue` 中 `statusMap` 为新状态文案与标签颜色。
6. [ ] 修改 `src/views/TicketDetail.vue` 中 `statusMap` 与权限按钮可见条件：
   - 现场可在 `pending_field_troubleshooting`/`field_troubleshooting` 时确认解决/升级研发；
   - 研发可在 `pending_rd` 认领进入 `rd_working`；
   - 研发可在 `rd_working` 标记解决。
7. [ ] 修改 `replay-server/src/tickets/service.ts`：
   - 创建工单后状态为 `pending_analysis`；
   - 分析中进入 `analyzing`；
   - 分析完成且匹配到路径则进入 `pending_field_troubleshooting`；
   - `verifyTicket` 拆分为 `resolveSelfService`（进入 `self_solved`）与 `escalateToRd`（进入 `pending_rd`）。
8. [ ] 修改 `replay-server/src/tickets/routes.ts`：新增/调整状态流转接口，旧 `verifyTicket` 接口标记为 deprecated 并转发到新逻辑。
9. [ ] 新增 `src/api/tickets.ts` 中 `resolveSelfService` 与 `escalateToRd` API。
10. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖「创建→待分析→分析中→待现场排查→现场排查中→已自助解决」主状态流。
11. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 3：分析版本化

目标：每次分析生成独立版本记录，支持历史版本切换与差异对比。

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `create_analysis_versions_table`，创建 `ticket_analysis_versions` 表。
2. [ ] 新增 `replay-server/src/db/analysisVersions.ts`：实现 `createAnalysisVersion`、`listAnalysisVersions`、`getAnalysisVersionById`、`getLatestAnalysisVersion`。
3. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `ticket_latest_analysis_version`，为 `tickets` 表添加 `latest_analysis_version_id` 字段。
4. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `finalizeTicketAnalysis`：在生成报告/诊断包后，创建 `ticket_analysis_versions` 记录，并更新 `tickets.latest_analysis_version_id`。
5. [ ] 修改 `ReplaySessionData` 提取函数，生成 `topIssues`、`evidenceSummary`、`troubleshootingPathsSnapshot` 等 JSON 字段。
6. [ ] 在 `replay-server/src/tickets/routes.ts` 新增接口：
   - `GET /:id/analysis-versions` 列表；
   - `GET /:id/analysis-versions/:versionId` 详情；
   - `POST /:id/analysis-versions/:versionId/switch` 切换当前展示版本（仅前端状态，不修改工单核心状态）。
7. [ ] 新增 `src/api/tickets.ts` 中分析版本相关 API 与类型。
8. [ ] 修改 `src/views/TicketDetail.vue`：在顶部增加「分析版本」下拉选择器，切换时刷新排查向导与证据面板。
9. [ ] 新增 `src/components/AnalysisVersionDiff.vue`：展示两个版本的 Top 3、问题类型、错误码数量、任务数量、地图匹配、生成时间差异。
10. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：触发重新分析后验证版本数增加；切换版本后内容变化；差异对比可见。
11. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 4：问题类型自动分类

目标：定义问题类型枚举，自动分类并允许手动修正，加入筛选与统计。

1. [ ] 在 `replay-server/src/types.ts` 定义 `IssueType` 联合类型：`positioning`、`laser`、`obstacle_avoidance`、`map`、`task_failure`、`charging`、`hardware_communication`、`fork_sensor`、`unknown`。
2. [ ] 修改 `replay-server/src/core/rootCause.ts` 或新增 `replay-server/src/core/issueClassifier.ts`，根据根因标题/知识规则标签/错误码/模块推断 `issue_type`。
3. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `finalizeTicketAnalysis`，将推断的 `issue_type` 写入 `ticket_analysis_versions.issue_type`，并同步更新 `tickets.issue_type`。
4. [ ] 在 `replay-server/src/tickets/routes.ts` 新增接口 `PATCH /:id/issue-type`，允许现场/研发修正问题类型。
5. [ ] 修改 `src/api/tickets.ts` 中 `Ticket` 类型与新增 `updateIssueType` API。
6. [ ] 修改 `src/views/TicketDetail.vue`：在基本信息中展示并允许编辑问题类型。
7. [ ] 修改 `src/views/TicketList.vue`：启用问题类型筛选，并展示问题类型列。
8. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：自动分析后问题类型非 `unknown`；手动修正后列表筛选生效。
9. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 5：知识库结构升级

目标：知识规则支持排查向导字段与产品化状态，仅已验证规则进入现场排查向导。

1. [ ] 修改 `replay-server/src/types.ts` 中 `KnowledgeRule`，新增 `guideSteps`、`publicationStatus`、`reviewReason`、`feedbackStats` 字段；新增 `TroubleshootingGuideStep` 类型。
2. [ ] 修改 `replay-server/src/core/knowledgeBase.ts` 中 `normalizeRule`，处理新增字段默认值。
3. [ ] 修改 `replay-server/src/core/knowledgeBase.ts` 中 `listKnowledgeRules`，增加按 `publicationStatus` 筛选。
4. [ ] 修改 `src/views/Replay.vue` 中知识库管理弹窗：新增「排查步骤」表单、「产品化状态」下拉、「反馈统计」展示。
5. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `createKnowledgeFromTicket`，生成的规则默认 `publicationStatus: 'draft'`，并预填阶段 9 所需字段。
6. [ ] 新增/更新 `tests/e2e/replay.spec.ts` 或 `knowledge.spec.ts`：验证新增字段保存、按状态筛选、草稿规则不进入排查向导。
7. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 6：排查向导生成

目标：自动分析完成后，基于已验证知识规则生成 Top 3 排查路径；未匹配时给出明确提示。

1. [ ] 新增 `replay-server/src/core/troubleshootingGuide.ts`：实现 `generateTroubleshootingPaths(sessionData, ticket, analysisVersion)`，从 `knowledgeMatches` 中过滤 `publicationStatus === 'verified'` 的规则，按严重度、阻塞任务/安全、置信度、时间接近度排序，取 Top 3。
2. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `finalizeTicketAnalysis`：调用生成函数，并将结果保存到 `ticket_troubleshooting_paths` 与 `ticket_troubleshooting_steps`（步骤从 `rule.guideSteps` 转换）。
3. [ ] 修改 `replay-server/src/tickets/service.ts`：分析完成后将工单状态从 `analyzing` 更新为 `pending_field_troubleshooting`。
4. [ ] 修改 `src/views/TicketDetail.vue`：在排查向导区域展示 Top 3 路径，默认展开最高优先级。
5. [ ] 实现 `src/components/TicketTroubleshootingGuide.vue`：展示路径标题、置信度、严重度；展开步骤列表；未匹配时展示提示与基础证据摘要。
6. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：验证分析完成后 Top 3 路径可见、未匹配提示可见。
7. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 7：排查步骤执行记录

目标：实现步骤四态、处理人/时间记录、不适用原因、安全确认、暂停继续。

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `create_troubleshooting_paths_steps_tables`，创建 `ticket_troubleshooting_paths`、`ticket_troubleshooting_steps`、`ticket_step_events` 表。
2. [ ] 新增 `replay-server/src/db/troubleshootingPaths.ts` 与 `troubleshootingSteps.ts`：实现路径/步骤 CRUD 与状态查询。
3. [ ] 新增 `replay-server/src/db/stepEvents.ts`：实现 `createStepEvent`、`listStepEvents`。
4. [ ] 在 `replay-server/src/tickets/service.ts` 新增：
   - `recordStepStatus(ticketId, pathId, stepId, actor, status, reason?)`；
   - `startFieldTroubleshooting(ticketId, actor)`（将工单状态从 `pending_field_troubleshooting` 改为 `field_troubleshooting`）。
5. [ ] 在 `replay-server/src/tickets/routes.ts` 新增接口：
   - `POST /:id/start-troubleshooting`；
   - `POST /:paths/:pathId/steps/:stepId/status`。
6. [ ] 新增 `src/api/tickets.ts` 中步骤状态 API。
7. [ ] 实现 `src/components/TicketTroubleshootingGuide.vue` 中步骤状态切换：未检查/已通过/未通过/不适用；不适用必须选原因；现场操作类步骤首次执行前弹安全确认；状态变化即时记录。
8. [ ] 修改 `src/views/TicketDetail.vue`：增加「稍后继续」按钮，仅保存当前步骤状态而不改变工单状态。
9. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖步骤切换、不适用原因、安全确认弹窗、事件流记录。
10. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 8：自助解决和升级研发

目标：现场解决时选择解决方式与向导反馈；升级研发时选择原因并自动附带材料。

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `ticket_resolution_meta_fields`，为 `tickets` 表添加 `self_service_result`、`self_service_note`、`escalation_reason`、`guide_feedback` 字段。
2. [ ] 修改 `replay-server/src/tickets/service.ts`：
   - 新增 `resolveSelfService(ticketId, actor, result, guideFeedback, note?)`；
   - 新增 `escalateToRd(ticketId, actor, reason)`；
   - `escalateToRd` 自动将日志/报告/诊断包路径、步骤状态、分析版本信息写入 `ticket_events` payload。
3. [ ] 修改 `replay-server/src/tickets/routes.ts`：调整 `POST /:id/verify` 或新增 `POST /:id/resolve-self-service`、`POST /:id/escalate-to-rd`。
4. [ ] 修改 `src/api/tickets.ts`：更新 `verifyTicket` 或新增上述 API。
5. [ ] 修改 `src/views/TicketDetail.vue`：将「确认已解决」改为弹出对话框，要求选择解决方式与向导反馈；「需要研发介入」改为弹出对话框，要求选择升级原因。
6. [ ] 在 `src/components/TicketTroubleshootingGuide.vue` 中实现：关键步骤走完仍未解决或出现「未通过且无现场可处理动作」时，提示建议升级研发。
7. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖自助解决对话框、升级研发对话框、关键步骤未解决提示、事件流附带材料。
8. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 9：研发处理和知识沉淀

目标：研发认领/解决，解决时提示沉淀知识规则草稿，草稿预填并需补充验证。

1. [ ] 修改 `replay-server/src/tickets/service.ts`：
   - `assignTicket` 进入 `rd_working`；
   - `resolveTicket` 进入 `resolved`，并返回 `draftSuggestion` 提示标志；
   - 新增 `createKnowledgeDraftFromTicket(ticketId, solution, actor)`，预填标题、现象、根因、解决方案、错误码、模块、关键词、证据样本，默认 `publicationStatus: 'draft'`。
2. [ ] 修改 `replay-server/src/tickets/routes.ts`：
   - `POST /:id/resolve` 返回是否建议沉淀；
   - `POST /:id/knowledge` 生成的规则为草稿，并返回 `draftId`。
3. [ ] 修改 `src/views/TicketDetail.vue`：研发标记已解决后，若后端返回建议沉淀，弹出「沉淀到知识库」对话框，预填字段；研发可补充匹配条件、适用范围、排查步骤后提交。
4. [ ] 修改 `src/views/Replay.vue` 知识库管理：支持编辑草稿并标记为 `verified`。
5. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖研发认领→解决→沉淀草稿流程。
6. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 10：角色导航和权限

目标：区分现场/售后、研发、管理员导航；隐藏实时控制等旧能力入口。

1. [ ] 修改 `src/App.vue` 侧边栏：
   - 现场/售后：工单管理（列表/新建）、我的待排查（指向 `/tickets?status=pending_field_troubleshooting,field_troubleshooting` 或独立视图 `/tickets/my-pending`）；
   - 研发：待研发工单（`/tickets/rd-pending` 或 `/tickets?status=pending_rd,rd_working`）、知识库（`/knowledge`，新页面）、高级诊断工具（`/replay`）、现场管理；
   - 管理员：用户管理 + 研发导航。
2. [ ] 修改 `src/router/index.ts`：新增 `/tickets/my-pending`、`/tickets/rd-pending`、`/knowledge` 路由，配置相应 `meta` 权限。
3. [ ] 新增 `src/views/KnowledgeBase.vue`：研发知识库管理页面（可复用 `Replay.vue` 中的知识库弹窗组件，或独立实现）。
4. [ ] 修改 `src/router/index.ts`：确保现场人员访问 `/laser`、`/avoid`、`/control`、`/replay` 时重定向到 `/tickets`。
5. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：验证不同角色登录后可见菜单项、访问越权路由被重定向。
6. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 11：精简证据面板

目标：工单详情默认展示精简证据，而非完整 `/replay`。

1. [ ] 实现 `src/components/TicketEvidencePanel.vue`：从 `analysisVersion` 读取 `evidence_summary`，展示 Top 问题摘要、关键时间线、地图快照/小回放、错误码摘要、任务摘要、原始日志上下文。
2. [ ] 修改 `src/views/TicketDetail.vue`：在下方区域嵌入 `TicketEvidencePanel`；研发/管理员显示「进入高级诊断」按钮，跳转 `/replay?ticketId=xxx`。
3. [ ] 修改 `src/views/Replay.vue`：支持通过 `ticketId` 查询参数加载工单对应的日志/地图/报告。
4. [ ] 在 `replay-server/src/tickets/routes.ts` 新增 `GET /:id/evidence` 接口，返回精简证据 JSON。
5. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：验证精简证据面板可见、证据可展开、高级诊断按钮仅研发可见。
6. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 12：AI 解释器

目标：AI 仅用于解释，不生成决策/临时排查步骤。

1. [ ] 修改 `replay-server/src/core/ragAssistant.ts` 中 prompt：明确约束 AI 只解释自动结论、错误码、日志上下文、知识规则匹配原因；禁止生成处置动作或临时排查步骤。
2. [ ] 修改 `src/views/TicketDetail.vue`：将「AI 分析结论」区域改为「AI 解释」，提供「解释此结论」「解释该错误码」「为什么匹配这条规则」等快捷提问按钮。
3. [ ] 修改 `src/components/TicketTroubleshootingGuide.vue`：每个排查步骤增加「AI 解释此步骤」按钮，调用现有问诊接口但传入系统提示限定解释范围。
4. [ ] 修改 `replay-server/src/tickets/service.ts`：未匹配已验证规则时，不调用 AI 生成临时排查步骤。
5. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：验证 AI 解释区域可见、未匹配规则时无临时 AI 步骤。
6. [ ] 更新 `docs/implementation-progress.md`。

---

## 4. 验收检查清单映射

| 验收项 | 覆盖阶段 |
|--------|----------|
| 1. 现场人员登录后默认进入工单列表 | 1、10 |
| 2. 新建工单可只填标题、现场、描述、日志/诊断包 | 1 |
| 3. 发生时间和影响程度可选 | 1 |
| 4. 自动分析完成后生成分析版本 | 3 |
| 5. 工单详情默认展示最新分析版本 | 3 |
| 6. 工单详情顶部展示结论摘要和排查向导 | 1、6 |
| 7. 排查向导最多 Top 3，默认展开最高优先级 | 6 |
| 8. 排查步骤展示标题、操作说明和判断标准 | 5、6 |
| 9. 步骤证据可展开查看 | 6、11 |
| 10. 步骤状态支持四态 | 7 |
| 11. 不适用必须选择原因 | 7 |
| 12. 现场操作步骤首次执行前需要安全确认 | 7 |
| 13. 步骤状态变化记录处理人和时间戳 | 7 |
| 14. 工单支持暂停排查并稍后继续 | 7 |
| 15. 关键步骤走完仍未解决建议升级研发 | 8 |
| 16. 升级研发必须选择升级原因 | 8 |
| 17. 升级研发自动附带报告/诊断包/步骤状态 | 8 |
| 18. 现场确认已解决必须选择解决方式分类 | 8 |
| 19. 现场确认已解决记录向导有效性反馈 | 8 |
| 20. 多次「没用」反馈标记规则需研发复查 | 5、8 |
| 21. 未匹配已验证规则时不生成临时 AI 排查步骤 | 6、12 |
| 22. 研发解决工单时提示是否沉淀知识规则 | 9 |
| 23. 从研发解决方案生成的知识规则默认为草稿 | 9 |
| 24. 只有已验证规则进入现场排查向导 | 5、6 |
| 25. 研发和管理员能进入高级诊断，现场不能 | 10、11 |
| 26. 现场人员没有独立知识库入口 | 10 |
| 27. 实时控制和配置页面不再出现在现场主导航 | 10 |
| 28. 工单列表支持状态、现场、问题类型筛选 | 1、4 |
| 29. 历史分析版本可以查看 | 3 |
| 30. 分析版本之间可以查看摘要差异 | 3 |

---

## 5. 风险与回退策略

1. **数据库迁移失败**：所有迁移在 `migrate.ts` 中通过 `columnExists`/`tableExists` 做幂等判断；关键重命名迁移先备份数据到临时表。
2. **状态流与现有数据不兼容**：迁移时旧状态映射到新状态：`analyzed` → `pending_field_troubleshooting`，`verifying` → `rd_working`，`needs_rd` → `pending_rd`，其余保持不变。
3. **E2E 测试依赖本地日志**：工单相关 E2E 使用最小伪造日志（`tests/e2e/fixtures/minimal-log`），不依赖真实设备日志。
4. **AI 离线导致测试不稳定**：E2E 中关闭 AI 介入，仅测试 UI 与状态流。
