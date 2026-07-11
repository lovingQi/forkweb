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
  forceReload?: boolean
}

export async function createReplaySession(input: ReplaySessionInput) {
  const { data } = await replayHttp.post('/replay/session', input)
  return data
}

export async function getReplayOverview() {
  const { data } = await replayHttp.get('/replay/overview')
  return data
}

export async function getReplaySession() {
  const { data } = await replayHttp.get('/replay/session')
  return data
}

export async function getReplayEvents() {
  const { data } = await replayHttp.get('/replay/events')
  return data.events || []
}

export async function getReplayFrames() {
  const { data } = await replayHttp.get('/replay/frames')
  return data.frames || []
}

export async function getReplayErrorCodes() {
  const { data } = await replayHttp.get('/replay/error-codes')
  return data
}

export async function getReplayTasks() {
  const { data } = await replayHttp.get('/replay/tasks')
  return data.tasks || []
}

export async function getReplayMap() {
  const { data } = await replayHttp.get('/map')
  return data
}

export async function getReplayLogs(params: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/logs', { params })
  return data
}

export type ReplayMode = 'realtime' | 'frame_compact'

export async function setReplayControl(payload: { playing?: boolean; speed?: number; mode?: ReplayMode }) {
  const { data } = await replayHttp.post('/replay/control', payload)
  return data
}

export async function seekReplay(payload: number | { timeMs?: number; frameIndex?: number }) {
  const body = typeof payload === 'number' ? { timeMs: payload } : payload
  const { data } = await replayHttp.post('/replay/seek', body)
  return data
}

export function replayReportUrl(kind: 'md' | 'json') {
  return `${config.replayApiBase}/replay/report.${kind}`
}
