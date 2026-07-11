# 叉车日志诊断与回放工具部署文档

本文说明 forkweb 日志诊断与回放工具的本地开发启动、离线诊断部署、配置文件、目录约定、验证命令和常见问题。当前工具直接集成在 forkweb 工程中，不再作为独立工程维护。

## 1. 工程位置

forkweb 工程目录：

```text
/home/xbl/Desktop/learn/forkweb
```

主要相关目录：

```text
forkweb
├── replay-server/              # 本地日志诊断与回放辅助服务
│   ├── src/index.ts            # HTTP、WebSocket、诊断 API 入口
│   ├── src/parser/             # 日志、状态、任务、错误码解析
│   ├── src/core/               # session、timeline、报告、缓存、诊断包、地图别名
│   ├── config/map-alias.json   # 地图别名配置
│   └── .cache/                 # 本地缓存、导入包、导出包、反馈文件
├── scripts/start-replay-dev.mjs # 前后端一键开发启动脚本
├── public/config.js            # 前端运行时配置
├── src/views/Replay.vue        # /replay 页面
├── src/api/replay.ts           # 前端诊断 API 封装
└── src/stores/replay.ts        # 前端诊断状态管理
```

## 2. 环境要求

### 2.1 Node.js

推荐使用 Node.js 20。

原因：

- Vite 5 需要 Node 18+。
- 当前本机系统 Node 可能是 v16.20.2，直接运行 `npm run dev` 可能失败。
- 开发验证时已使用 Node 20 运行通过。

如果本机没有切换全局 Node，可以使用：

```bash
npx -y -p node@20 -c 'npm run replay:dev:all'
```

或在执行单个命令时使用：

```bash
npx -y -p node@20 -c 'npm run build'
```

### 2.2 npm 依赖

首次部署或依赖变更后，在 forkweb 目录执行：

```bash
cd /home/xbl/Desktop/learn/forkweb
npm install
```

如果现场网络不可用，需要提前准备好依赖缓存或离线安装包。

### 2.3 zip 和 unzip

诊断包导入、导出依赖系统可用的 zip/unzip 能力。建议确认：

```bash
zip -v
unzip -v
```

如果命令不存在，在对应系统上安装 zip/unzip 工具。

## 3. 推荐启动方式

开发和现场本机诊断推荐使用一键启动：

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:dev:all'
```

如果本机默认 Node 已经是 18 或 20，也可以直接运行：

```bash
cd /home/xbl/Desktop/learn/forkweb
npm run replay:dev:all
```

一键脚本会做这些事：

- 自动寻找可用的 replay-server 端口。
- 自动寻找可用的 Vite 前端端口。
- 写入 `public/config.js`，让前端连接实际 replay-server 地址。
- 同时启动本地诊断服务和前端页面。
- 在终端输出可访问的 `/replay` 地址。

启动后访问终端打印的地址，例如：

```text
http://127.0.0.1:5174/replay
```

## 4. 手动启动方式

如果需要分别启动后端和前端，可以使用手动方式。

### 4.1 启动 replay-server

默认端口是 `18080`：

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:dev'
```

指定端口：

```bash
cd /home/xbl/Desktop/learn/forkweb
REPLAY_PORT=18082 npx -y -p node@20 -c 'npm run replay:dev'
```

服务默认监听：

```text
http://127.0.0.1:18080
```

如果指定 `REPLAY_PORT=18082`，则地址为：

```text
http://127.0.0.1:18082
```

### 4.2 启动前端

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run dev -- --host 127.0.0.1'
```

默认 Vite 端口通常是：

```text
http://127.0.0.1:5173/replay
```

如果 5173 被占用，Vite 会尝试使用下一个可用端口，例如 5174。

### 4.3 手动启动时的前端配置

前端通过 `public/config.js` 获取 replay-server 地址。如果手动修改了后端端口，需要确保该文件里的 `replayApiBase` 指向正确地址。

示例：

```js
window.__APP_CONFIG__ = {
  replayApiBase: 'http://127.0.0.1:18082/api'
}
```

使用 `npm run replay:dev:all` 时，一键脚本会自动写入实际端口，一般不需要手动改。

## 5. 端口规则

### 5.1 默认端口

默认约定：

- replay-server：`18080`
- Vite 前端：`5173`

### 5.2 一键脚本端口选择

`npm run replay:dev:all` 会自动选择空闲端口。比如：

- 如果 `18080` 被占用，后端可能使用 `18081` 或 `18082`。
- 如果 `5173` 被占用，前端可能使用 `5174`。

最终以终端输出为准。

### 5.3 手动指定后端端口

可以通过环境变量指定：

```bash
REPLAY_PORT=18082 npm run replay:dev
```

或：

```bash
REPLAY_PORT=18082 npx -y -p node@20 -c 'npm run replay:dev'
```

### 5.4 手动指定监听地址

后端默认只监听 `127.0.0.1`。如需指定监听地址，可以使用：

```bash
REPLAY_HOST=0.0.0.0 REPLAY_PORT=18082 npm run replay:dev
```

注意：开放到 `0.0.0.0` 代表局域网其他机器可能访问到服务。现场使用前需要确认网络环境和数据安全要求。

## 6. public/config.js 说明

`public/config.js` 是前端运行时配置。它的作用是让已经启动的前端知道 replay-server 在哪里。

典型内容：

```js
window.__APP_CONFIG__ = {
  replayApiBase: 'http://127.0.0.1:18082/api'
}
```

注意事项：

- `replayApiBase` 必须包含 `/api`。
- 如果后端端口变化，而 `config.js` 没更新，页面会出现诊断接口请求失败。
- 使用一键启动脚本时，脚本会自动写入正确端口。
- 手动启动时，如接口不通，优先检查此文件。

## 7. 目录和文件约定

### 7.1 日志目录

默认日志目录：

```text
/home/xbl/Desktop
```

页面会读取该目录下的 `.log` 文件。现场建议把同一次问题相关日志放在一个目录里，避免混入其他时间段日志。

### 7.2 地图目录

默认地图目录：

```text
/home/xbl/Desktop/jarvis-fork/params/map
```

该目录用于自动匹配日志中的地图名。也可以在页面中手动填写具体地图 JSON 文件。

### 7.3 地图别名配置

地图别名配置文件：

```text
/home/xbl/Desktop/learn/forkweb/replay-server/config/map-alias.json
```

用途：

- 保存日志地图名和本机地图文件的对应关系。
- 解决日志地图名和本机地图文件名不一致的问题。
- 提升后续自动匹配置信度。

### 7.4 缓存目录

缓存目录：

```text
/home/xbl/Desktop/learn/forkweb/replay-server/.cache
```

常见内容：

- 会话解析缓存。
- 导出的诊断包。
- 导入的诊断包。
- 根因反馈文件。
- 其他临时文件。

可以通过页面缓存管理入口清理，不建议现场人员直接手动删除其中的部分文件。

### 7.5 诊断包

诊断包是 zip 文件。导出时会包含：

```text
diagnostic-package.json
logs/
maps/
reports/report.md
reports/report.json
config/map-alias.json
```

导入后会解压到 `.cache/imports` 下，并由工具自动加载包内日志和地图。

导入方式有两种：

- 浏览器选择文件导入：适合较小 zip，页面会读取文件后提交给本地服务。
- 本地路径导入：适合较大 zip，在页面填写 zip 完整路径，由本地 replay-server 直接读取。

## 8. 本地离线诊断流程

适用于没有实车连接，但已经从车上下载日志和地图的情况。

### 8.1 准备文件

从实车或现场环境下载：

- 问题发生时间段的 `.log` 文件。
- 当时使用的地图 JSON 文件或地图目录。
- 如果有现场额外说明，记录问题发生大概时间、任务号、错误码、车辆名。

建议目录示例：

```text
/home/xbl/Desktop/site-issue-001/logs
/home/xbl/Desktop/site-issue-001/maps
```

### 8.2 启动工具

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:dev:all'
```

打开终端输出的 `/replay` 地址。

### 8.3 加载数据

在页面顶部填写：

```text
日志目录: /home/xbl/Desktop/site-issue-001/logs
地图目录: /home/xbl/Desktop/site-issue-001/maps
地图文件: 可为空，或填写具体地图 JSON
```

点击加载或重新解析。

### 8.4 排查顺序

推荐顺序：

1. 看概览中的数据完整性，确认有地图、有回放帧。
2. 看地图匹配置信度，低可信时先确认地图。
3. 看 Top 问题，点击最可疑的问题跳转。
4. 看地图回放中的位置、轨迹、任务、错误。
5. 看问题时间线，确认异常前后事件顺序。
6. 看错误码中心，确认 `ERRORxxxx` 的描述、等级、发生点。
7. 看任务视角，确认失败任务和相关轨迹。
8. 看原始日志上下文，复制异常前后证据。
9. 导出 Markdown/JSON 报告或诊断包。

## 9. 车端部署预留和当前边界

当前版本设计上预留了车端部署能力，但第一阶段推荐本地优先。

### 9.1 当前已具备的基础

- replay-server 是独立 Node 服务，可通过端口提供 HTTP API 和 WebSocket。
- 前端通过 `public/config.js` 配置 replay-server 地址。
- 诊断逻辑集中在 `replay-server/src`，与前端实时监控页面解耦。
- 支持导入诊断包，说明诊断数据可以脱离实车环境复现。

### 9.2 车端部署后可做的事

后续如果部署到车端，可以考虑：

- 直接读取车端日志目录。
- 直接读取车端地图目录。
- 在网页端远程触发诊断。
- 一键打包车端诊断包下载到本机。

### 9.3 当前不建议直接依赖车端部署的原因

- 车端 Node 环境、权限、磁盘空间、网络访问策略需要单独确认。
- 日志目录和地图目录在不同车辆上可能不一致。
- 直接开放诊断服务需要考虑安全边界。
- 大日志解析会占用 CPU 和 IO，是否影响现场运行需要验证。

因此当前推荐流程仍是：本地启动工具，下载日志和地图后离线诊断。

## 10. 构建和生产启动

### 10.1 构建前端

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run build'
```

构建产物通常位于：

```text
dist/
```

### 10.2 构建 replay-server

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:build'
```

构建产物位于：

```text
replay-server/dist
```

### 10.3 启动构建后的 replay-server

```bash
cd /home/xbl/Desktop/learn/forkweb
REPLAY_PORT=18080 npm run replay:start
```

如果用生产方式部署，需要另外配置前端静态资源服务，并确保 `public/config.js` 或最终发布的配置文件指向正确 replay-server 地址。

## 11. 验证命令

代码或部署调整后，建议执行以下验证。

### 11.1 类型检查

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run typecheck'
```

### 11.2 前端构建

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run build'
```

### 11.3 replay-server 构建

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:build'
```

### 11.4 样例验证脚本

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c './node_modules/.bin/tsx replay-server/scripts/verify-sample.ts'
```

该脚本用于验证：

- 根因候选字段存在。
- Markdown 报告包含关键章节。
- JSON 报告包含结构化字段。
- 诊断包可导出和导入。
- 导入后可重新解析回放帧。
- 缓存摘要可用。

### 11.5 页面验证

启动：

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:dev:all'
```

浏览器打开 `/replay` 后验证：

- 页面能正常加载。
- 能读取日志目录。
- 能显示概览。
- 能显示地图和轨迹。
- 播放、暂停、倍速、进度条拖动可用。
- 点击 Top 问题、时间线事件、错误码发生点可以跳转。
- 报告和诊断包可以导出。
- 诊断包可以导入。

## 12. 常见问题排查

### 12.1 Node 版本过低

现象：

- `npm run dev` 启动失败。
- Vite 报 Node 版本不满足要求。

处理：

```bash
cd /home/xbl/Desktop/learn/forkweb
npx -y -p node@20 -c 'npm run replay:dev:all'
```

长期处理方式是安装 Node 20 或使用 nvm 切换到 Node 20。

### 12.2 端口被占用

现象：

- replay-server 启动失败，提示端口占用。
- 前端地址不是预期的 5173。

处理：

- 优先使用 `npm run replay:dev:all`，让脚本自动选择空闲端口。
- 手动启动后端时指定端口：

```bash
REPLAY_PORT=18082 npm run replay:dev
```

- 前端实际端口以 Vite 终端输出为准。

### 12.3 页面请求诊断接口失败

现象：

- 页面能打开，但加载日志失败。
- 浏览器控制台请求 `replay` 接口失败。

处理：

1. 确认 replay-server 已启动。
2. 确认 `public/config.js` 中 `replayApiBase` 端口正确。
3. 如果使用一键脚本，重新启动一键脚本让它重写配置。
4. 检查浏览器访问的前端是否就是当前 forkweb 工程启动的前端。

### 12.4 地图不匹配

现象：

- 轨迹明显不在地图上。
- 地图匹配置信度低。
- 概览提示地图缺失或匹配策略不可靠。

处理：

1. 确认地图目录是否正确。
2. 手动填写具体地图 JSON 文件。
3. 重新解析。
4. 如果确认地图正确，保存地图别名。
5. 如导入诊断包后有别名冲突，到地图别名管理中人工处理。

### 12.5 没有回放帧

现象：

- 概览显示无可回放帧。
- 地图上没有车辆轨迹。

处理：

1. 确认日志目录是否选对。
2. 确认目录下有 `.log` 文件。
3. 检查日志中是否包含 `FltStatus: RmstoSendArg` 或 `InfoStatus: ROBOT STATUS`。
4. 如果日志确实缺少状态信息，只能使用错误码、时间线和原始日志排查，无法完整回放轨迹。

### 12.6 任务列表为空

现象：

- 任务视角没有任务。
- 概览任务数量为 0。

处理：

1. 检查日志中是否存在 `current_task_id`。
2. 检查是否有 `FltTask` 相关日志。
3. 如果现场日志没有任务字段，任务视角无法完整展示，但仍可通过时间线、错误码、原始日志排查。

### 12.7 错误码没有描述

现象：

- 错误码中心能看到 `ERRORxxxx`，但描述为空或不完整。

处理：

1. 确认日志中是否包含 `error_name,error_str=ERRORxxxx,{...}` 定义。
2. 确认 jarvis-fork 源码目录是否可访问，以便补充扫描错误码。
3. 结合原始日志上下文人工判断。

### 12.8 诊断包过大

现象：

- 导出 zip 很大。
- 导入或上传诊断包耗时较长。

处理：

1. 尽量只保留问题时间段相关日志。
2. 避免把无关历史日志放在同一日志目录。
3. 清理 `.cache/packages` 中旧的导出包。
4. 如果需要发给研发，优先确认是否可以只保留最小复现日志。
5. 大包在本机诊断时优先使用“本地 zip 路径导入”，避免浏览器 base64 传输带来的内存和耗时问题。

### 12.9 缓存导致显示旧数据

现象：

- 替换日志或地图后，页面看起来仍是旧结果。

处理：

1. 点击重新解析。
2. 打开缓存详情，清理会话缓存。
3. 再次加载日志和地图。

### 12.10 导入诊断包后地图别名冲突

现象：

- 导入后提示包内别名与本地别名冲突。

处理：

1. 打开地图别名管理。
2. 查看同一日志地图名对应的多个本地地图文件。
3. 根据本次诊断包来源和本机地图路径决定保留哪个。
4. 需要覆盖时再使用导入别名的覆盖选项。

## 13. 现场部署建议

- 优先使用一键启动脚本，减少端口和配置错误。
- 每次现场问题单独建目录存放日志和地图。
- 排查前先看数据完整性，不要在缺地图或缺回放帧时直接判断运动异常。
- 转交问题时优先导出诊断包，必要时同时附上 Markdown 报告。
- 定期清理缓存中的旧诊断包，避免磁盘占用越来越大。
- 车端部署前先在本机离线流程稳定使用，再评估车端权限、性能和安全边界。
