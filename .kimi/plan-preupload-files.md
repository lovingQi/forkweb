# 规划：文件预上传（阶段 25）

## 目标

- 用户在「新建工单」页面拖入/选择文件后，文件立即开始上传，显示进度。
- 点击「提交工单」时只提交元信息（标题、现场、车型、描述、时间、影响程度、AI 开关）和已上传文件的临时 ID。
- 提交工单响应快速（<3 秒），不再被大文件上传阻塞。
- 临时文件需要可清理，避免磁盘无限增长。

## 技术方案（方案 A：临时文件路径）

### 后端

1. 新增 `POST /api/tickets/upload-files`
   - 使用现有 multer 中间件，接收 `files` 字段（复用 `uploadTicketFiles`）。
   - 校验总大小不超过 200MB。
   - 把文件从 multer 临时目录移动到持久化临时目录 `CACHE_DIR/uploads/pending/<uuid>`，避免被 `removeUploadedTempFiles` 清理。
   - 返回 `{ succeed: true, files: [{ tempFileId, originalName, size }] }`。

2. 新增临时文件记录
   - 在 `CACHE_DIR/uploads/pending-meta.json` 中记录 `{ tempFileId, path, originalName, size, createdAt, uploadedBy }`。
   - 不引入新数据库表，用 JSON 文件即可。

3. 修改 `POST /api/tickets`
   - 不再接收 `files`，改为接收 `tempFileIds: string[]`。
   - 根据 `tempFileIds` 从 `pending-meta.json` 读取真实路径，调用 `processUploadFiles` 处理到工单目录。
   - 成功后从 pending-meta.json 删除对应记录并删除临时文件。
   - 校验失败时保留临时文件（前端可以重试或重新选择）。

4. 临时文件清理
   - 在 `storageCleaner.ts` 的 `cleanExpiredFiles()` 中增加：删除 `CACHE_DIR/uploads/pending` 下创建时间超过 24 小时的临时文件及 meta 记录。
   - 创建工单成功后立即删除已使用的临时文件。

5. 修改 `createTicketWithUploads`
   - 支持传入 `tempFilePaths` 和 `originalNames`。
   - 保持原有接口不变，新增重载或新函数 `createTicketWithTempFiles`。

### 前端

1. 新增 `src/api/tickets.ts` 函数 `uploadTicketFiles(files: File[])`
   - 使用 `FormData`，`POST /api/tickets/upload-files`。
   - 设置较长超时（5 分钟）并支持 `onUploadProgress`。

2. 修改 `src/views/TicketNew.vue`
   - `el-upload` 改为 `:auto-upload="true"`，`:http-request="uploadFileAction"`。
   - 每个文件单独上传，上传成功后在 `fileList` 中记录 `tempFileId`。
   - 显示每个文件上传进度条/状态。
   - 文件总大小校验保留（前端和双端）。
   - `onSubmit` 时从 `fileList` 收集 `tempFileId`，调用 `ticketStore.createTicket` 的 `tempFileIds` 版本。
   - 提交按钮 loading 状态不再被上传阻塞，只在提交元信息时显示 loading。

3. 修改 `src/stores/tickets.ts`
   - `createTicket` 支持 `tempFileIds?: string[]` 替代 `files?: File[]`。
   - 向后兼容保留 `files` 参数（内部可转一次性上传，或仅用于测试）。

4. 修改 `src/api/tickets.ts` 的 `createTicket`
   - 支持 `tempFileIds?: string[]`。
   - 优先使用 `tempFileIds`，无文件时兜底保留旧 `files` 逻辑。

### 文档更新

1. `docs/implementation-progress.md`
   - 总览表新增「阶段 25 | 文件预上传 | ✅ 已完成 | 2026-07-23 | -」。
   - 新增「阶段 25：文件预上传」章节，包含改动摘要、验证方式、阻塞项。

2. `docs/implementation-plan.md`
   - 在阶段 24 之后新增「阶段 25：文件预上传」实施清单。

3. `docs/product-development-todo.md`
   - 新增「阶段 25：文件预上传」条目。

4. `docs/product-key-decisions.md`
   - 新增第五轮关键决策（阶段 25：文件预上传），决策 113-116：
     - 113. 文件在表单填写期间预上传，不等待提交按钮。
     - 114. 创建工单时只提交元信息和临时文件 ID，不再传输文件内容。
     - 115. 临时文件保存 24 小时，过期自动清理。
     - 116. 提交失败时保留临时文件，允许用户重试而不必重新上传。

## 实现清单

1. [ ] 后端：`replay-server/src/tickets/routes.ts` 新增 `POST /api/tickets/upload-files`。
2. [ ] 后端：新增 `replay-server/src/upload/tempFiles.ts`，实现临时文件存储、meta 记录、读取、删除、过期清理。
3. [ ] 后端：`replay-server/src/tickets/service.ts` 新增 `createTicketWithTempFiles` 函数。
4. [ ] 后端：修改 `POST /api/tickets` 接收 `tempFileIds` 并调用新函数。
5. [ ] 后端：`replay-server/src/core/storageCleaner.ts` 增加临时文件过期清理。
6. [ ] 前端：`src/api/tickets.ts` 新增 `uploadTicketFiles` 并修改 `createTicket` 支持 `tempFileIds`。
7. [ ] 前端：`src/stores/tickets.ts` 修改 `createTicket` action 支持 `tempFileIds`。
8. [ ] 前端：`src/views/TicketNew.vue` 改为自动上传、显示进度、提交时只传 `tempFileIds`。
9. [ ] 文档：更新 `docs/implementation-progress.md`。
10. [ ] 文档：更新 `docs/implementation-plan.md`。
11. [ ] 文档：更新 `docs/product-development-todo.md`。
12. [ ] 文档：更新 `docs/product-key-decisions.md`。
13. [ ] 验证：`npm run typecheck` 和 `npm run replay:build` 通过。
14. [ ] 验证：手动测试文件预上传 + 提交工单流程。
