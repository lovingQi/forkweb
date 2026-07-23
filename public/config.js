// 运行时后端地址配置。
// Docker 部署时前后端同端口，使用相对路径即可。
// 本地开发时可通过 VITE_REPLAY_API_BASE 环境变量覆盖。
window.__APP_CONFIG__ = {
  apiBase: '/api',
  wsBase: '/ws',
  replayApiBase: '/api',
  replayWsBase: '/ws'
}
