# 日志诊断与回放工具进度

## 研究结论

- 现有 forkweb 通过 `/ws/high` 接收 `pose`、`vel`、`laser_data`、`path_points`、`clearances`、`robot_size`。
- 现有 forkweb 通过 `/ws/low` 接收 `status`、`battery`、`score`、`alarm`、`current_routes`、`fork_info`、IO 等状态。
- 日志中 `FltStatus: RmstoSendArg` 可提供离线回放主数据源，包括位置、朝向、电量、定位分、任务 ID、错误、货叉高度等。
- 日志中 `InfoStatus: ROBOT STATUS` 可补充状态、速度、电机、充电、定位分等。
- 日志中 `error_name,error_str=ERRORxxxx,{...}` 可建立错误码字典，正文中的 `ERRORxxxx` 可建立错误发生点。

## 已选方案

- 直接集成到 forkweb。
- 新增 `/replay` 页面，不改动现有实时监控首页。
- 使用 Node.js + TypeScript 本地辅助服务处理日志目录、地图文件、解析、回放和报告。
- 第一版本地优先，后续预留车端部署。
- 地图选择支持地图目录自动加载，失败时可手动填写地图文件。
- 报告导出支持 Markdown 和 JSON。

## 第一版范围

- 一键概览页。
- 问题时间线。
- 地图回放与事件跳转。
- 错误码中心。
- 噪声折叠与智能过滤。
- 任务视角。
- 原始日志/过滤 Tab。
- Top 问题默认展示 5 条，可由后续交互扩展。

## 已完成

- 新增 replay-server 本地诊断服务骨架。
- 新增日志解析模块。
- 新增 FltStatus 和 InfoStatus 回放帧解析。
- 新增 ERRORxxxx 错误码定义与发生解析。
- 新增任务段解析。
- 新增 timeline、噪声折叠、报告生成。
- 新增兼容 `/api/state`、`/api/map`、`/ws/high`、`/ws/low`。
- 新增前端 replay API、store、路由和页面。
- 新增日志诊断菜单入口。

## 验证记录

- `npm run replay:build` 通过。
- `npm run typecheck` 通过。
- 使用 `/home/xbl/Desktop/log-20260710-173240.log` 验证：
  - 识别日志文件 1 个。
  - 解析日志行 165902 条。
  - 生成回放帧 601 个。
  - 解析错误码定义 41 个。
  - 生成错误事件 50 个。
  - 生成关键告警 405 个。
  - 当前样例日志 `current_task_id` 始终为 `Null`，因此任务段为 0。
- `/api/state`、`/api/map`、`/api/replay/report.md`、`/api/replay/report.json` 均可返回数据。

## 当前环境注意

- 当前本机 Node 为 v16.20.2。
- Vite 5 和部分新包声明需要 Node 18+，因此 `npm run dev` 在当前 Node 下无法启动，错误为 `crypto.getRandomValues is not a function`。
- 已选用兼容 Node 16 的 `express@4` 和 `tsx@3.14.0`，诊断服务构建可通过。

## 后续优化点

- 根因候选分析，要求输出依据和置信度。
- 状态曲线：定位分、电量、速度、货叉高度。
- 会话保存，避免重复解析大日志。
- 诊断包 zip 导入/导出。
- 正常日志和异常日志对比。
- 车端部署模式。
- 多日志目录、多车日志分析。
- 轨迹平滑回放开关。
