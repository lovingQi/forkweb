// 运行时后端地址配置。
// - 同源部署(nginx 反代)时保持 '/api' 与 '/ws' 即可。
// - 直连车端时可改为完整地址，例如：
//     apiBase: 'http://192.168.1.10:8080/api'
//     wsBase:  'ws://192.168.1.10:8080/ws'
// 容器部署时该文件可由 docker-entrypoint.sh 按环境变量重写。
window.__APP_CONFIG__ = {
  apiBase: '/api',
  wsBase: '/ws',
  replayApiBase: 'http://127.0.0.1:18080/api',
  replayWsBase: 'ws://127.0.0.1:18080/ws'
}
