# 规划：统一后端文件/数据库/缓存路径，避免 `process.cwd()` 导致数据丢失

## 问题根因

后端多处用 `path.resolve(process.cwd(), 'replay-server/.cache')` 或 `'replay-server/config'` 计算持久化路径。当启动命令的工作目录与项目根目录不一致时，数据库、缓存、配置会被写到错误位置，甚至被重新初始化成空库，导致用户之前创建的工单全部消失。

## 目标

把所有依赖 `process.cwd()` 的持久化路径改成基于项目根目录的绝对路径，确保无论从哪个 cwd 启动服务，数据都落在 `/home/xbl/Desktop/learn/forkweb/replay-server/.cache` 和 `.../config` 下。

## 方案（推荐方案 A）

新增统一路径模块 `replay-server/src/paths.ts`，导出：

- `REPLAY_SERVER_DIR`：`.../forkweb/replay-server`
- `CACHE_DIR`：`.../forkweb/replay-server/.cache`
- `CONFIG_DIR`：`.../forkweb/replay-server/config`

其余模块导入并使用这些常量，不再使用 `process.cwd()`。

## 需要修改的文件清单

1. **新增** `replay-server/src/paths.ts`
2. `replay-server/src/db/index.ts` — `DB_DIR`
3. `replay-server/src/upload/handler.ts` — `UPLOAD_BASE`
4. `replay-server/src/core/cache.ts` — `CACHE_DIR`（需重命名内部常量避免与 paths.ts 导出冲突）
5. `replay-server/src/core/logIndex.ts` — `INDEX_DIR`
6. `replay-server/src/core/diagnosticPackage.ts` — `PACKAGE_DIR`、`IMPORT_DIR`
7. `replay-server/src/core/rootCauseFeedback.ts` — `FEEDBACK_FILE`
8. `replay-server/src/core/caseMeta.ts` — `CASE_META_FILE`
9. `replay-server/src/core/vectorStore.ts` — `VECTOR_STORE_FILE`
10. `replay-server/src/core/bookmarks.ts` — `BOOKMARK_FILE`
11. `replay-server/src/tickets/routes.ts` — multer `dest`
12. `replay-server/src/core/errorDictionary.ts` — `MANUAL_DICTIONARY_FILE`
13. `replay-server/src/core/mapAlias.ts` — `ALIAS_FILE`
14. `replay-server/src/core/llmConfigStore.ts` — `LLM_LOCAL_FILE`
15. `replay-server/src/core/knowledgeBase.ts` — `KNOWLEDGE_FILE`、`KNOWLEDGE_HITS_FILE`

## 精确改动内容

### 1. 新增 `replay-server/src/paths.ts`

```ts
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPLAY_SERVER_DIR = path.resolve(__dirname, '..');
export const CACHE_DIR = path.join(REPLAY_SERVER_DIR, '.cache');
export const CONFIG_DIR = path.join(REPLAY_SERVER_DIR, 'config');
```

### 2. 各文件替换规则

| 文件 | 旧代码 | 新代码 |
|---|---|---|
| `db/index.ts` | `path.resolve(process.cwd(), 'replay-server/.cache')` | `CACHE_DIR` |
| `upload/handler.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/tickets')` | `path.join(CACHE_DIR, 'tickets')` |
| `core/cache.ts` | `path.resolve(process.cwd(), 'replay-server/.cache')` | `path.join(CACHE_DIR)`；内部常量改名为 `CACHE_ROOT_DIR` |
| `core/logIndex.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/indexes')` | `path.join(CACHE_DIR, 'indexes')` |
| `core/diagnosticPackage.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/packages')` | `path.join(CACHE_DIR, 'packages')` |
| `core/diagnosticPackage.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/imports')` | `path.join(CACHE_DIR, 'imports')` |
| `core/rootCauseFeedback.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/root-cause-feedback.json')` | `path.join(CACHE_DIR, 'root-cause-feedback.json')` |
| `core/caseMeta.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/case-meta.json')` | `path.join(CACHE_DIR, 'case-meta.json')` |
| `core/vectorStore.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/vector-store.json')` | `path.join(CACHE_DIR, 'vector-store.json')` |
| `core/bookmarks.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/bookmarks.json')` | `path.join(CACHE_DIR, 'bookmarks.json')` |
| `tickets/routes.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/uploads')` | `path.join(CACHE_DIR, 'uploads')` |
| `core/errorDictionary.ts` | `path.resolve(process.cwd(), 'replay-server/config/manual-error-dictionary.json')` | `path.join(CONFIG_DIR, 'manual-error-dictionary.json')` |
| `core/mapAlias.ts` | `path.resolve(process.cwd(), 'replay-server/config/map-alias.json')` | `path.join(CONFIG_DIR, 'map-alias.json')` |
| `core/llmConfigStore.ts` | `path.resolve(process.cwd(), 'replay-server/config/llm.local.json')` | `path.join(CONFIG_DIR, 'llm.local.json')` |
| `core/knowledgeBase.ts` | `path.resolve(process.cwd(), 'replay-server/config/knowledge-base.json')` | `path.join(CONFIG_DIR, 'knowledge-base.json')` |
| `core/knowledgeBase.ts` | `path.resolve(process.cwd(), 'replay-server/.cache/knowledge-hits.json')` | `path.join(CACHE_DIR, 'knowledge-hits.json')` |

## 兼容性说明

- 新的绝对路径与当前实际路径（`/home/xbl/Desktop/learn/forkweb/replay-server/.cache` 和 `.../config`）一致，现有缓存文件不会搬家。
- 数据库已经为空，不存在数据迁移问题；但本次改动后，即使从任意 cwd 启动，数据库也会落在正确位置。
- `paths.ts` 使用 `import.meta.url`，项目已设置 `"type": "module"`，兼容 ESM。

## 验证步骤

1. `npm run replay:build` 通过。
2. `npm run typecheck` 通过。
3. 停止并重新启动服务。
4. 登录后创建一个新工单。
5. 停止服务，再次启动（模拟 cwd 变化）。
6. 登录确认工单列表仍在。

## 实现清单

1. [ ] 新增 `replay-server/src/paths.ts`。
2. [ ] 修改 `replay-server/src/db/index.ts`，使用 `CACHE_DIR`。
3. [ ] 修改 `replay-server/src/upload/handler.ts`，使用 `CACHE_DIR`。
4. [ ] 修改 `replay-server/src/core/cache.ts`，使用 `CACHE_DIR` 并重命名内部常量。
5. [ ] 修改 `replay-server/src/core/logIndex.ts`，使用 `CACHE_DIR`。
6. [ ] 修改 `replay-server/src/core/diagnosticPackage.ts`，使用 `CACHE_DIR`。
7. [ ] 修改 `replay-server/src/core/rootCauseFeedback.ts`，使用 `CACHE_DIR`。
8. [ ] 修改 `replay-server/src/core/caseMeta.ts`，使用 `CACHE_DIR`。
9. [ ] 修改 `replay-server/src/core/vectorStore.ts`，使用 `CACHE_DIR`。
10. [ ] 修改 `replay-server/src/core/bookmarks.ts`，使用 `CACHE_DIR`。
11. [ ] 修改 `replay-server/src/tickets/routes.ts`，使用 `CACHE_DIR`。
12. [ ] 修改 `replay-server/src/core/errorDictionary.ts`，使用 `CONFIG_DIR`。
13. [ ] 修改 `replay-server/src/core/mapAlias.ts`，使用 `CONFIG_DIR`。
14. [ ] 修改 `replay-server/src/core/llmConfigStore.ts`，使用 `CONFIG_DIR`。
15. [ ] 修改 `replay-server/src/core/knowledgeBase.ts`，使用 `CACHE_DIR` 和 `CONFIG_DIR`。
16. [ ] 运行 `npm run replay:build` 和 `npm run typecheck`。
17. [ ] 停止并重新启动服务。
18. [ ] 创建测试工单，确认数据持久化。
19. [ ] 再次重启服务，确认工单不丢失。
