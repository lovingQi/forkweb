import axios from 'axios'
import { config } from '@/config'

const replayHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 30000
})

export interface ReplaySessionInput {
  logDir: string
  mapDir?: string
  mapFile?: string
}

export async function createReplaySession(input: ReplaySessionInput) {
  const { data } = await replayHttp.post('/replay/session', input)
  return data
}

export async function getReplayOverview() {
  const { data } = await replayHttp.get('/replay/overview')
  return data
}

export async function getReplayEvents() {
  const { data } = await replayHttp.get('/replay/events')
  return data.events || []
}

export async function getReplayErrorCodes() {
  const { data } = await replayHttp.get('/replay/error-codes')
  return data
}

export async function getReplayTasks() {
  const { data } = await replayHttp.get('/replay/tasks')
  return data.tasks || []
}

export async function getReplayLogs(params: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/logs', { params })
  return data
}

export async function setReplayControl(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/control', payload)
  return data
}

export async function seekReplay(timeMs: number) {
  const { data } = await replayHttp.post('/replay/seek', { timeMs })
  return data
}

export function replayReportUrl(kind: 'md' | 'json') {
  return `${config.replayApiBase}/replay/report.${kind}`
}
