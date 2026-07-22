import axios from 'axios'
import { config } from '@/config'

const replayHttp = axios.create({
  baseURL: config.replayApiBase,
  timeout: 30000
})

replayHttp.interceptors.request.use((req) => {
  const token = localStorage.getItem('forkweb_token')
  if (token && req.headers) {
    req.headers.Authorization = `Bearer ${token}`
  }
  return req
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

export async function createReplaySessionJob(input: ReplaySessionInput) {
  const { data } = await replayHttp.post('/replay/session/jobs', input)
  return data
}

export async function getReplaySessionJob(id: string) {
  const { data } = await replayHttp.get(`/replay/session/jobs/${encodeURIComponent(id)}`)
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

export async function getReplayEvents(params?: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/events', { params })
  return data
}

export async function getReplayEventMarkers(params?: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/event-markers', { params })
  return data.markers || []
}

export async function getReplayFrames() {
  const { data } = await replayHttp.get('/replay/frames')
  return data.frames || []
}

export async function getReplayErrorCodes(params?: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/error-codes', { params })
  return data
}

export async function getReplayTasks() {
  const { data } = await replayHttp.get('/replay/tasks')
  return data.tasks || []
}

export async function getReplayMapAliases() {
  const { data } = await replayHttp.get('/replay/map-aliases')
  return data
}

export async function saveReplayMapAlias(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/map-aliases', payload)
  return data
}

export async function deleteReplayMapAlias(id: string) {
  const { data } = await replayHttp.delete(`/replay/map-aliases/${encodeURIComponent(id)}`)
  return data
}

export async function importReplayMapAliases(payload: { aliases: any[]; overwrite?: boolean }) {
  const { data } = await replayHttp.post('/replay/map-aliases/import', payload)
  return data
}

export function replayMapAliasesExportUrl() {
  return `${config.replayApiBase}/replay/map-aliases/export`
}

export async function sendRootCauseFeedback(id: string, payload: { verdict: 'useful' | 'false_positive'; note?: string }) {
  const { data } = await replayHttp.post(`/replay/root-causes/${encodeURIComponent(id)}/feedback`, payload)
  return data
}

export async function importReplayPackage(payload: { fileName: string; content: string }) {
  const { data } = await replayHttp.post('/replay/package/import', payload)
  return data
}

export async function importReplayPackageByPath(payload: { path: string }) {
  const { data } = await replayHttp.post('/replay/package/import-path', payload)
  return data
}

export async function exportReplayPackageOptions(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/package/export', payload)
  return data
}

export async function compareReplayPackages(payload: { left: Record<string, any>; right: Record<string, any> }) {
  const { data } = await replayHttp.post('/replay/package/compare', payload)
  return data
}

export async function getReplayCache() {
  const { data } = await replayHttp.get('/replay/cache')
  return data
}

export async function clearReplayCache(bucket?: string) {
  const { data } = await replayHttp.delete('/replay/cache', { params: bucket ? { bucket } : undefined })
  return data
}

export async function getReplayMap() {
  const { data } = await replayHttp.get('/map')
  return data
}

export async function getReplayLogs(params: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/logs', { params })
  return data
}

export async function getReplayFoldedLogLines(id: string, params?: Record<string, any>) {
  const { data } = await replayHttp.get(`/replay/folded-logs/${encodeURIComponent(id)}/lines`, { params })
  return data
}

export async function getReplayBookmarks() {
  const { data } = await replayHttp.get('/replay/bookmarks')
  return data.bookmarks || []
}

export async function addReplayBookmark(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/bookmarks', payload)
  return data
}

export async function deleteReplayBookmark(id: string) {
  const { data } = await replayHttp.delete(`/replay/bookmarks/${encodeURIComponent(id)}`)
  return data
}

export async function getReplayCaseMeta() {
  const { data } = await replayHttp.get('/replay/case-meta')
  return data.caseMeta || {}
}

export async function saveReplayCaseMeta(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/case-meta', payload)
  return data
}

export async function getReplayKnowledge(params?: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/knowledge', { params })
  return data
}

export async function createReplayKnowledgeRule(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/knowledge', payload)
  return data
}

export async function updateReplayKnowledgeRule(id: string, payload: Record<string, any>) {
  const { data } = await replayHttp.put(`/replay/knowledge/${encodeURIComponent(id)}`, payload)
  return data
}

export async function deleteReplayKnowledgeRule(id: string) {
  const { data } = await replayHttp.delete(`/replay/knowledge/${encodeURIComponent(id)}`)
  return data
}

export async function toggleReplayKnowledgeRule(id: string, enabled?: boolean) {
  const { data } = await replayHttp.post(`/replay/knowledge/${encodeURIComponent(id)}/toggle`, { enabled })
  return data
}

export async function importReplayKnowledge(payload: { library: Record<string, any>; overwrite?: boolean }) {
  const { data } = await replayHttp.post('/replay/knowledge/import', payload)
  return data
}

export async function suggestReplayKnowledgePattern(lines: any[]) {
  const { data } = await replayHttp.post('/replay/knowledge/suggest-pattern', { lines })
  return data.suggestion
}

export async function testReplayKnowledgeRule(rule: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/knowledge/test', { rule })
  return data
}

export function replayKnowledgeExportUrl() {
  return `${config.replayApiBase}/replay/knowledge/export`
}

export async function getReplayAssistantStatus() {
  const { data } = await replayHttp.get('/replay/assistant/status')
  return data.status
}

export async function getReplayAssistantConfig() {
  const { data } = await replayHttp.get('/replay/assistant/config')
  return data.config
}

export async function saveReplayAssistantConfig(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/assistant/config', payload)
  return data
}

export async function clearReplayAssistantConfig() {
  const { data } = await replayHttp.delete('/replay/assistant/config')
  return data
}

export async function testReplayAssistantConfig(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/assistant/config/test', payload)
  return data
}

export async function reindexReplayAssistant() {
  const { data } = await replayHttp.post('/replay/assistant/reindex')
  return data
}

export async function getReplaySimilarCases(params?: Record<string, any>) {
  const { data } = await replayHttp.get('/replay/assistant/similar', { params })
  return data.similarCases || []
}

export async function previewReplayAssistantContext(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/assistant/context-preview', payload)
  return data.context
}

export async function askReplayAssistant(payload: Record<string, any>) {
  const { data } = await replayHttp.post('/replay/assistant/ask', payload)
  return data.answer
}

export type ReplayMode = 'realtime' | 'frame_compact'

export async function setReplayControl(payload: {
  playing?: boolean
  speed?: number
  mode?: ReplayMode
  loopEnabled?: boolean
  loopStartMs?: number
  loopEndMs?: number
  autoPauseOnIssue?: boolean
}) {
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

export function replayPackageUrl() {
  return `${config.replayApiBase}/replay/package`
}
