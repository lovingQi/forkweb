export interface AppConfig {
  apiBase: string
  wsBase: string
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>
  }
}

function resolveWsBase(raw?: string): string {
  // 若是相对路径(如 '/ws')，依据当前页面协议/主机推导出绝对 ws 地址
  if (!raw) raw = '/ws'
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = raw.startsWith('/') ? raw : '/' + raw
  return `${proto}//${window.location.host}${path}`
}

const injected = window.__APP_CONFIG__ || {}

export const config: AppConfig = {
  apiBase: injected.apiBase || '/api',
  wsBase: resolveWsBase(injected.wsBase)
}
