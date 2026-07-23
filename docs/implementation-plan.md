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

### 阶段 13：存储清理与上传限制

目标：限制上传大小，分析失败回退状态，7 天自动清理原始日志，分析超时保护。

1. [ ] 修改 `replay-server/src/tickets/routes.ts` 中 multer 配置：`fileSize` 从 500MB 改为 200MB；在 `POST /` 创建工单时校验所有上传文件总大小不超过 200MB。
2. [ ] 修改 `src/views/TicketNew.vue`：在文件上传区域增加格式说明文案（"支持 .log、.zip、.tar.gz 格式，总大小不超过 200MB"）；前端增加文件大小校验与提示。
3. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `finalizeTicketAnalysis`：用 try-catch 包裹分析主流程，分析失败时将工单状态回退为 `pending_analysis`，并在 `ticket_events` 中记录失败原因。
4. [ ] 修改 `replay-server/src/tickets/service.ts` 中 `startTicketAnalysis`：增加 10 分钟超时保护（setTimeout），超时后自动回退状态并记录超时事件。
5. [ ] 新增 `replay-server/src/core/storageCleaner.ts`：实现 `cleanExpiredFiles()` 函数，查询已完成分析超过 7 天的工单，删除其 `log_dir` 目录和上传临时文件，保留报告和数据库记录。
6. [ ] 在 `replay-server/src/index.ts` 中注册定时任务：每天凌晨 3 点执行 `cleanExpiredFiles()`。
7. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：验证超大文件上传被拒绝；分析失败后工单状态回退为待分析。
8. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 14：工单取消、编辑与评论

目标：新增已取消状态；工单未终结前可编辑基本信息；工单内纯文字评论。

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `ticket_status_add_cancelled`，扩展 `tickets.status` CHECK 约束增加 `cancelled` 状态。
2. [ ] 修改 `replay-server/src/db/tickets.ts` 中 `TicketStatus` 类型增加 `cancelled`。
3. [ ] 修改 `replay-server/src/tickets/service.ts`：新增 `cancelTicket(ticketId, actor)` 函数，只有提单人可取消自己的未终结工单（非 `resolved`/`self_solved`/`cancelled`），取消后记录事件。
4. [ ] 修改 `replay-server/src/tickets/service.ts`：新增 `updateTicketBasicInfo(ticketId, actor, fields)` 函数，允许编辑标题、描述、现场、影响程度、发生时间，校验工单未终结，编辑记录到事件流。
5. [ ] 修改 `replay-server/src/tickets/service.ts`：新增 `addTicketComment(ticketId, actor, content)` 函数，创建 action 为 `comment` 的事件。
6. [ ] 修改 `replay-server/src/tickets/routes.ts`：新增 `POST /:id/cancel`、`PATCH /:id/basic-info`、`POST /:id/comments` 接口。
7. [ ] 修改 `src/api/tickets.ts`：新增 `cancelTicket`、`updateTicketBasicInfo`、`addTicketComment` API。
8. [ ] 修改 `src/views/TicketDetail.vue`：增加「取消工单」按钮（提单人可见且工单未终结）；基本信息区域改为可编辑模式（未终结时）；底部事件流增加评论输入框。
9. [ ] 修改 `src/views/TicketList.vue`：`statusMap` 增加 `cancelled` 状态文案与标签颜色。
10. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖取消工单、编辑基本信息、发表评论流程。
11. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 15：补充上传日志

目标：工单详情支持追加上传日志文件，可选触发重新分析。

1. [ ] 修改 `replay-server/src/tickets/service.ts`：新增 `appendFilesToTicket(ticketId, actor, filePaths, originalNames)` 函数，将文件追加到工单的 `log_dir`，记录事件，校验追加后总量不超过 200MB。
2. [ ] 修改 `replay-server/src/tickets/routes.ts`：新增 `POST /:id/files` 接口，使用 multer 处理上传，调用 `appendFilesToTicket`，可选参数 `reanalyze` 控制是否触发重新分析。
3. [ ] 修改 `src/api/tickets.ts`：新增 `appendFiles` API。
4. [ ] 修改 `src/views/TicketDetail.vue`：在工单未终结时展示「补充上传」按钮，弹出上传对话框，提供"上传后重新分析"勾选项。
5. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖补充上传后文件数增加、触发重新分析。
6. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 16：列表分页与排序

目标：工单列表支持分页，每页 20 条，按创建时间倒序。

1. [ ] 修改 `replay-server/src/db/tickets.ts`：`listTickets` 等查询函数增加 `page`、`pageSize` 参数与 `LIMIT/OFFSET`，增加 `countTickets` 函数返回总数。
2. [ ] 修改 `replay-server/src/tickets/service.ts`：`listUserTickets` 透传分页参数，返回 `{ tickets, total }` 结构。
3. [ ] 修改 `replay-server/src/tickets/routes.ts`：`GET /` 接口读取 `page`（默认 1）、`pageSize`（默认 20）查询参数，响应增加 `total` 字段。
4. [ ] 修改 `src/api/tickets.ts`：更新列表 API 参数与返回类型。
5. [ ] 修改 `src/stores/tickets.ts`：增加 `total`、`currentPage` 状态。
6. [ ] 修改 `src/views/TicketList.vue`：底部增加 Element Plus `el-pagination` 分页组件，切换页码时重新加载。
7. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：验证分页组件可见、翻页后内容变化。
8. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 17：企业微信通知

目标：关键工单节点通过企业微信 Webhook 发送通知。

1. [ ] 新增 `replay-server/src/notify/wechatWork.ts`：实现 `sendWechatWorkNotification(message)` 函数，读取环境变量 `WECHAT_WORK_WEBHOOK_URL`，通过 POST 请求发送 markdown 格式消息。未配置时静默跳过。
2. [ ] 修改 `replay-server/src/tickets/service.ts`：在以下节点调用通知：
   - `finalizeTicketAnalysis` 完成时通知"工单 #xxx 分析完成"。
   - `escalateToRd` 时通知"工单 #xxx 已升级研发"。
   - `assignTicket` 时通知"工单 #xxx 已被研发认领"。
   - `resolveTicket` 时通知"工单 #xxx 已由研发解决"。
3. [ ] 修改 `replay-server/src/core/knowledgeBase.ts`：知识规则被标记为 `needs_review` 时通知"知识规则 xxx 需要研发复查"。
4. [ ] 新增/更新测试：验证通知函数在 Webhook URL 未配置时不报错。
5. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 18：数据统计仪表盘

目标：为研发和管理员提供工单、知识库、人员三维度统计视图。

1. [ ] 新增 `replay-server/src/tickets/stats.ts`：实现统计查询函数：
   - `getTicketStats(dateRange)` 返回工单数量、状态分布、自助解决率、平均解决耗时。
   - `getTicketsBysite(dateRange)` 返回按现场分布。
   - `getTicketsByIssueType(dateRange)` 返回按问题类型分布。
   - `getKnowledgeStats()` 返回规则匹配次数排行、反馈分布、覆盖率。
   - `getUserStats(dateRange)` 返回售后提单量排行、研发解决量排行。
2. [ ] 修改 `replay-server/src/tickets/routes.ts` 或新增 `replay-server/src/stats/routes.ts`：新增 `GET /api/stats/tickets`、`GET /api/stats/knowledge`、`GET /api/stats/users` 接口，限制研发和管理员访问。
3. [ ] 新增 `src/api/stats.ts`：统计 API 类型与调用函数。
4. [ ] 新增 `src/views/StatsBoard.vue`：使用 Element Plus 卡片和表格展示三维度统计，支持日期范围筛选。
5. [ ] 修改 `src/router/index.ts`：新增 `/stats` 路由，`meta: { requiresRd: true }`。
6. [ ] 修改 `src/App.vue`：研发和管理员侧边栏新增"数据统计"入口。
7. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 19：部署与运维

目标：Docker 容器化部署、一键更新、HTTPS、健康监控。

1. [ ] 新增 `Dockerfile`：基于 Node.js 官方镜像，安装依赖、编译前后端、配置启动命令。
2. [ ] 新增 `docker-compose.yml`：配置服务、端口映射、数据卷（数据库和日志目录）、`restart: unless-stopped`。
3. [ ] 新增 `scripts/update.sh`：一键更新脚本，依次执行数据库备份（`cp forkweb.db forkweb.db.bak.$(date +%Y%m%d%H%M%S)`）、`git pull`、`docker-compose build`、`docker-compose up -d`。
4. [ ] 新增 `nginx/forkweb.conf`：Nginx 反向代理配置，支持 WebSocket、HTTPS。
5. [ ] 新增 `scripts/health-check.sh`：心跳脚本，每 5 分钟 curl 健康接口，失败时调用企业微信 Webhook 告警。
6. [ ] 修改 `replay-server/src/index.ts`：新增 `GET /api/health` 健康检查接口，返回服务状态与磁盘使用量。
7. [ ] 编写部署说明文档。
8. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 20：上线准备

目标：真实日志测试、知识库预填充、操作指南、灰度上线。

1. [ ] 使用 `tests/e2e/fixtures/log-20260720-114052.log` 及更多真实叉车日志运行端到端测试，验证完整分析流程。
2. [ ] 组织研发团队预填充 10-20 条常见问题的已验证知识规则。
3. [ ] 编写一页纸操作指南（截图 + 步骤），覆盖登录、建工单、上传日志、查看排查向导、勾选步骤、升级研发。
4. [ ] 上线前修改默认管理员密码。
5. [ ] 部署到云服务器，让一两个售后试用一周。
6. [ ] 根据反馈修复问题，全面推开。
7. [ ] 更新 `docs/implementation-progress.md`。

### 阶段 21：车型管理

目标：实现车型类别和型号的两级管理；现场关联车型；工单必填车型并联动现场；列表筛选和统计。

#### 21.1 数据库

1. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `create_vehicle_tables`，创建以下表：

```sql
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicle_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES vehicle_categories(id),
  UNIQUE(category_id, name)
);

CREATE TABLE IF NOT EXISTS site_vehicle_models (
  site_id INTEGER NOT NULL,
  vehicle_model_id INTEGER NOT NULL,
  PRIMARY KEY (site_id, vehicle_model_id),
  FOREIGN KEY (site_id) REFERENCES sites(id),
  FOREIGN KEY (vehicle_model_id) REFERENCES vehicle_models(id)
);
```

2. [ ] 在 `replay-server/src/db/migrate.ts` 新增迁移 `ticket_vehicle_model_id`，为 `tickets` 表添加 `vehicle_model_id INTEGER` 字段。

#### 21.2 后端

3. [ ] 新增 `replay-server/src/db/vehicleCategories.ts`：实现 `createCategory`、`listCategories`、`updateCategory`、`deleteCategory`（删除前校验无关联型号）。
4. [ ] 新增 `replay-server/src/db/vehicleModels.ts`：实现 `createModel`、`listModelsByCategoryId`、`listAllModels`、`updateModel`、`deleteModel`（删除前校验无关联现场和工单）。
5. [ ] 修改 `replay-server/src/db/sites.ts`：`DbSite` 增加 `vehicleModelIds?: number[]`；新增 `setSiteVehicleModels(siteId, modelIds)`、`getSiteVehicleModels(siteId)` 函数。
6. [ ] 修改 `replay-server/src/db/tickets.ts`：`DbTicket` 增加 `vehicle_model_id` 字段；查询函数支持按 `vehicle_model_id` 筛选。
7. [ ] 新增 `replay-server/src/vehicles/routes.ts`：实现车型类别和型号的 CRUD 接口，限制研发和管理员访问：
   - `GET /api/vehicle-categories`
   - `POST /api/vehicle-categories`
   - `PUT /api/vehicle-categories/:id`
   - `DELETE /api/vehicle-categories/:id`
   - `GET /api/vehicle-categories/:id/models`
   - `POST /api/vehicle-categories/:id/models`
   - `PUT /api/vehicle-models/:id`
   - `DELETE /api/vehicle-models/:id`
   - `GET /api/vehicle-models`（全量列表，用于筛选）
8. [ ] 修改 `replay-server/src/sites/routes.ts`：创建/更新现场接口支持 `vehicleModelIds` 参数；列表接口返回关联的型号信息。
9. [ ] 修改 `replay-server/src/tickets/routes.ts`：
   - `POST /` 创建工单接口要求 `siteId` 和 `vehicleModelId` 必填；校验 `vehicleModelId` 属于所选现场关联的型号。
   - `GET /` 列表接口支持 `vehicleModelId` 查询参数。
   - `PATCH /:id/basic-info` 支持修改 `vehicleModelId`。
   - `serializeTicket` 增加 `vehicleModelId`、`vehicleModelName`、`vehicleCategoryName` 字段。
10. [ ] 修改 `replay-server/src/tickets/stats.ts`：新增 `getTicketsByVehicleModel(dateRange)` 统计函数。
11. [ ] 在 `replay-server/src/index.ts` 中注册 `/api` 下的车型路由。

#### 21.3 前端

12. [ ] 新增 `src/api/vehicles.ts`：车型类别和型号的 API 类型与调用函数。
13. [ ] 新增 `src/views/VehicleManage.vue`：车型管理页面，左侧类别列表（新增/编辑/删除），右侧选中类别下的型号列表（新增/编辑/删除）。删除时提示已关联的不允许删除。
14. [ ] 修改 `src/router/index.ts`：新增 `/vehicles` 路由，`meta: { requiresRd: true }`。
15. [ ] 修改 `src/App.vue`：研发和管理员侧边栏新增"车型管理"入口。
16. [ ] 修改 `src/views/SiteManage.vue`：新增/编辑现场对话框增加"关联车型"多选组件（按类别分组的多选下拉或穿梭框）；现场列表展示关联的车型。
17. [ ] 修改 `src/views/TicketNew.vue`：
   - 现场改为必填。
   - 新增车型选择器（必填），按类别 > 型号两级联动。
   - 选择现场后自动加载该现场关联的型号列表；切换现场时清空车型选择。
18. [ ] 修改 `src/views/TicketDetail.vue`：基本信息区域展示车型信息（类别 + 型号）；编辑模式支持修改车型。
19. [ ] 修改 `src/views/TicketList.vue`：增加车型筛选下拉；列表增加车型列。
20. [ ] 修改 `src/views/StatsBoard.vue`：增加"按车型分布"统计图表。
21. [ ] 修改 `src/api/tickets.ts`：`Ticket` 类型增加 `vehicleModelId`、`vehicleModelName`、`vehicleCategoryName`；`createTicket` 增加 `vehicleModelId` 参数。

#### 21.4 测试与文档

22. [ ] 新增/更新 `tests/e2e/tickets.spec.ts`：覆盖车型管理 CRUD、现场关联车型、新建工单车型联动、工单列表车型筛选。
23. [ ] 更新 `docs/implementation-progress.md`。

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
| 31. 上传文件总大小不超过 200MB | 13 |
| 32. 分析失败后工单状态回退并显示失败原因 | 13 |
| 33. 分析超时 10 分钟自动标记失败 | 13 |
| 34. 原始日志文件保留 7 天后自动清理 | 13 |
| 35. 已取消状态用于废弃工单 | 14 |
| 36. 工单未终结前可编辑基本信息 | 14 |
| 37. 工单内支持纯文字评论 | 14 |
| 38. 工单详情可追加上传日志文件 | 15 |
| 39. 工单列表每页 20 条按创建时间倒序 | 16 |
| 40. 关键节点发送企业微信通知 | 17 |
| 41. 三维度数据统计仪表盘 | 18 |
| 42. Docker 容器化部署 | 19 |
| 43. 一键更新脚本含自动数据库备份 | 19 |
| 44. HTTPS + 健康监控 | 19 |
| 45. 真实日志端到端测试通过 | 20 |
| 46. 知识库预填充完成 | 20 |
| 47. 管理员可动态管理车型类别和具体型号 | 21 |
| 48. 新增/编辑现场时可关联多种具体型号 | 21 |
| 49. 新建工单时现场和车型均为必填，车型列表根据现场联动 | 21 |
| 50. 工单列表支持按车型筛选 | 21 |
| 51. 统计仪表盘展示按车型分布 | 21 |
| 52. 已被关联的车型不允许删除 | 21 |
| 53. 知识规则可绑定车型类别（多选），不绑定为通用规则 | 22 |
| 54. 工单分析时按车型类别过滤知识库匹配结果 | 22 |
| 55. 从工单沉淀知识时自动预填车型类别 | 22 |
| 56. 知识库管理列表支持按车型类别筛选 | 22 |
| 57. 知识库导出支持按车型类别筛选（含通用规则选项） | 22 |
| 58. 登录页品牌化：Logo + "Junion 单机售后工单系统" + 工业风背景 + 毛玻璃卡片 | 23 |
| 59. 全局顶栏增加角色标签 | 23 |
| 60. 浏览器标签页标题和 favicon 更新 | 23 |
| 61. 工单状态颜色明确区分 | 23 |
| 62. 统计仪表盘和工单详情页美化 | 23 |

---

## 阶段 22：知识库车型类别绑定（决策 85-94）

### 步骤

1. `replay-server/src/types.ts`：`KnowledgeRule` 接口新增 `vehicleCategoryIds?: number[]`
2. `replay-server/src/core/knowledgeBase.ts`：
   - `normalizeRule` 添加 `vehicleCategoryIds` 规范化（新增 `normalizeNumberArray` 辅助函数）
   - `matchKnowledgeRules` 添加可选 `vehicleCategoryId` 参数，按类别过滤（通用规则始终保留）
   - `listKnowledgeRules` 添加 `vehicleCategoryId` 查询过滤（支持 `universal` 特殊值）
   - `exportKnowledgeLibraryPayload` 添加可选 `categoryIds` + `includeUniversal` 参数
3. `replay-server/src/tickets/service.ts`：
   - `runTicketAnalysisInBackground`：session.load 后根据工单 vehicle_model_id 查 category_id 过滤 knowledgeMatches
   - `createKnowledgeFromTicket`：从工单获取 vehicle_model_id 对应 category_id 预填 vehicleCategoryIds
4. `replay-server/src/index.ts`：`GET /api/replay/knowledge/export` 路由支持 `categoryIds` 和 `includeUniversal` 查询参数
5. `src/api/replay.ts`：`exportReplayKnowledge` 添加可选的类别筛选参数
6. `src/views/Replay.vue`：
   - `emptyKnowledgeShape` / `buildKnowledgeDraft` 增加 `vehicleCategoryIds`
   - 编辑表单添加"适用车型类别"多选字段
   - 知识库管理列表添加"车型类别"筛选下拉和"适用类别"表格列
   - 导出功能改为弹出对话框支持按类别筛选

---

## 阶段 23：前端美化与品牌（决策 95-107）

### 步骤

1. 资源准备：复制 Logo 到 `public/logo.png`；用 ffmpeg 从 Logo 裁剪左侧圆形图标生成 `public/favicon.png`（64x64）
2. `index.html`：标题改为 "Junion 售后系统"，添加 `<link rel="icon" href="/favicon.png">`
3. `src/views/Login.vue`：完全重写——深蓝色渐变+点阵纹理背景，毛玻璃卡片，Logo 居中，标题 "Junion 单机售后工单系统"，竖排表单，渐变蓝色按钮，底部版权 © 2026 Junion
4. `src/App.vue`：
   - 侧边栏 logo 改为 favicon 图标 + "Junion" 文字
   - 顶栏右侧增加角色标签（roleLabel + roleTagType computed）
   - currentTitle 默认值改为 "Junion"
   - 全局样式：卡片圆角 10px、表头背景色、section-title 蓝色竖线、app-main 背景色
5. `src/views/TicketList.vue`：优化 statusMap 颜色映射；筛选行改用 flex gap
6. `src/views/StatsBoard.vue`：数字卡片彩色左边框 + hover 阴影；副标题蓝色竖线
7. `src/views/TicketDetail.vue`：工单号蓝色高亮；section-title 蓝色竖线；AI 结论渐变蓝背景；版本栏蓝色背景

---

## 阶段 25：文件预上传

### 目标

- 用户在「新建工单」页面拖入/选择文件后，文件立即开始上传并显示进度条。
- 点击「提交工单」时只提交元信息（标题、现场、车型、描述、时间、影响程度、AI 开关）和已上传文件的临时 ID。
- 提交工单响应快速（<3 秒），不再被大文件上传阻塞。
- 临时文件 24 小时过期自动清理。

### 步骤

1. 新增 `replay-server/src/upload/tempFiles.ts`：实现预上传临时文件管理，包括保存、读取、删除、24 小时过期清理。
2. `replay-server/src/tickets/routes.ts` 新增 `POST /api/tickets/upload-files`：接收 `files`，总大小校验 ≤200MB，保存到 `CACHE_DIR/uploads/pending/<uuid>`，返回 `{ tempFileId, originalName, size }`。
3. `replay-server/src/tickets/service.ts` 新增 `createTicketWithTempFiles`：根据 `tempFileIds` 读取临时文件，调用 `createTicketWithUploads` 移入工单目录，成功后删除临时文件。
4. 修改 `POST /api/tickets`：不再接收 `files`，改为接收 `tempFileIds: string[]`。
5. 修改 `replay-server/src/core/storageCleaner.ts`：跳过 `CACHE_DIR/uploads/pending` 目录，并调用 `cleanupExpiredTempFiles` 单独清理 24 小时过期的预上传文件。
6. 前端 `src/api/tickets.ts` 新增 `uploadTicketFiles(files, onProgress)`；修改 `createTicket` 支持 `tempFileIds`，保留旧 `files` 参数兜底兼容。
7. 前端 `src/stores/tickets.ts` 的 `createTicket` action 支持 `tempFileIds`。
8. 前端 `src/views/TicketNew.vue`：
   - `el-upload` 改为 `:auto-upload="true"`，使用 `:http-request="uploadFileAction"`。
   - 显示每个文件的上传进度条、文件大小、上传状态。
   - 提交工单时只收集 `tempFileId`，调用 `createTicket`。
   - 提交按钮 loading 仅表示元信息提交中，不再被上传阻塞。
9. 更新四个文档：`implementation-progress.md`、`implementation-plan.md`、`product-development-todo.md`、`product-key-decisions.md`。

### 验收标准

- 选择文件后立即开始上传，进度条可见。
- 提交工单请求在 3 秒内返回。
- 创建工单成功后临时文件被删除。
- 超过 24 小时未使用的临时文件被自动清理。
- `npm run typecheck` 和 `npm run replay:build` 通过。

---

## 5. 风险与回退策略

1. **数据库迁移失败**：所有迁移在 `migrate.ts` 中通过 `columnExists`/`tableExists` 做幂等判断；关键重命名迁移先备份数据到临时表。
2. **状态流与现有数据不兼容**：迁移时旧状态映射到新状态：`analyzed` → `pending_field_troubleshooting`，`verifying` → `rd_working`，`needs_rd` → `pending_rd`，其余保持不变。
3. **E2E 测试依赖本地日志**：工单相关 E2E 使用最小伪造日志（`tests/e2e/fixtures/minimal-log`），不依赖真实设备日志。
4. **AI 离线导致测试不稳定**：E2E 中关闭 AI 介入，仅测试 UI 与状态流。
