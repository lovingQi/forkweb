import axios from 'axios'
import { config } from '@/config'

const http = axios.create({
  baseURL: config.apiBase,
  timeout: 8000
})

export interface ApiResult {
  succeed: boolean
  error?: string
  [key: string]: any
}

// ---- GET ----
export async function getState(): Promise<any> {
  const { data } = await http.get('/state')
  return data
}

export async function getMap(): Promise<{ name: string; data: any }> {
  const { data } = await http.get('/map')
  return data
}

export async function getParamsInfo(): Promise<any> {
  const { data } = await http.get('/params')
  return data && data.params ? data.params : {}
}

export async function getRoutesRules(): Promise<any> {
  const { data } = await http.get('/routes/rules')
  return data && data.rules ? data.rules : {}
}

// ---- POST 配置/激光 ----
export async function postConfig(sections: Record<string, Record<string, any>>): Promise<ApiResult> {
  const { data } = await http.post('/config', { data: sections })
  return data as ApiResult
}

export async function setLaserEnable(laser: string, enable: boolean): Promise<ApiResult> {
  const { data } = await http.post('/laser/enable', { laser, enable })
  return data as ApiResult
}

// ---- POST 控制 ----
export async function control(action: string, payload: Record<string, any> = {}): Promise<ApiResult> {
  const { data } = await http.post(`/control/${action}`, payload)
  return data as ApiResult
}

export default http
