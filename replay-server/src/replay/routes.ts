import { Router } from 'express'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { authMiddleware, requireRole } from '../auth/middleware'
import { clearReplayCache, getCacheSummary } from '../core/cache'
import { exportDiagnosticPackage, importDiagnosticPackage, type DiagnosticPackageManifest } from '../core/diagnosticPackage'
import { isNoiseLine, noiseRuleId } from '../core/noise'
import { addBookmark, deleteBookmark, readBookmarks } from '../core/bookmarks'
import { readCaseMeta, writeCaseMeta } from '../core/caseMeta'
import {
  createKnowledgeRule,
  deleteKnowledgeRule,
  exportKnowledgeLibraryPayload,
  importKnowledgeLibraryPayload,
  listKnowledgeRules,
  matchKnowledgeRule,
  readKnowledgeLibraryWithHits,
  suggestKnowledgePattern,
  toggleKnowledgeRule,
  updateKnowledgeRule
} from '../core/knowledgeBase'
import { comparePackageManifests } from '../core/packageCompare'
import {
  deleteMapAlias,
  exportMapAliasesPayload,
  findMapAliasConflicts,
  importMapAliases,
  readMapAliases,
  upsertMapAlias
} from '../core/mapAlias'
import { buildJsonReport, buildMarkdownReportAsync } from '../core/report'
import { askReplayAssistant, buildAssistantContext, recommendSimilarCases } from '../core/ragAssistant'
import { RawLogStore, formatRawLine } from '../core/rawLogStore'
import type { IndexedLogLine, LogLineRef, ParsedLogLine, TimelineEvent } from '../types'
import { addRootCauseFeedback } from '../core/rootCauseFeedback'
import type { ReplaySession } from '../core/session'
import { createSessionJob, getSessionJob } from '../core/sessionJobs'
import { filterTimelineEvents } from '../core/timeline'
import { getAssistantStatus, getPublicLlmConfig, readLlmConfig } from '../core/llmConfig'
import { clearLlmLocalConfig, writeLlmLocalConfig } from '../core/llmConfigStore'
import { OpenAiCompatibleClient } from '../core/openAiCompatibleClient'
import { rebuildVectorStore } from '../core/vectorStore'

function getRawLineStore(session: ReplaySession): RawLogStore | null {
  if (session.data.rawLinesPath) {
    return RawLogStore.load(session.data.rawLinesPath)
  }
  return null
}

async function getAllRawLines(session: ReplaySession): Promise<IndexedLogLine[]> {
  if (session.data.rawLines.length > 0) return session.data.rawLines as IndexedLogLine[]
  const store = getRawLineStore(session)
  if (store) return store.readAll()
  return []
}

async function resolveRefMap(session: ReplaySession, refs: LogLineRef[]): Promise<Map<number, ParsedLogLine>> {
  const store = getRawLineStore(session)
  if (!store || refs.length === 0) return new Map()
  const lines = await store.resolveRefs(refs)
  return new Map(lines.map((line, i) => [refs[i].globalIndex, line]))
}

function refToPlain(ref: LogLineRef, map: Map<number, ParsedLogLine>): ParsedLogLine {
  return map.get(ref.globalIndex) || {
    file: ref.file,
    line: ref.line,
    timestamp: ref.timestamp,
    timeMs: ref.timeMs,
    module: 'unknown',
    sourceLine: null,
    level: 'I',
    message: `[ref:${ref.globalIndex}]`
  }
}

async function resolveTimelineEvents(session: ReplaySession, events: TimelineEvent[]): Promise<TimelineEvent[]> {
  const refs: LogLineRef[] = []
  for (const event of events) {
    if (event.line) refs.push(event.line)
    if (event.contextBefore) refs.push(...event.contextBefore)
    if (event.contextAfter) refs.push(...event.contextAfter)
  }
  const map = await resolveRefMap(session, refs)
  for (const event of events) {
    if (event.line) (event as any).line = refToPlain(event.line, map)
    if (event.contextBefore) (event as any).contextBefore = event.contextBefore.map((ref) => refToPlain(ref, map))
    if (event.contextAfter) (event as any).contextAfter = event.contextAfter.map((ref) => refToPlain(ref, map))
  }
  return events
}

async function resolveErrorOccurrences<T extends { line: LogLineRef }>(session: ReplaySession, items: T[]): Promise<T[]> {
  const map = await resolveRefMap(session, items.map((it) => it.line))
  for (const item of items) {
    (item as any).line = refToPlain(item.line, map)
  }
  return items
}

async function resolveErrorSummaries(session: ReplaySession, summaries: any[]): Promise<any[]> {
  for (const summary of summaries) {
    summary.occurrences = await resolveErrorOccurrences(session, summary.occurrences || [])
  }
  return summaries
}

async function resolveTasks(session: ReplaySession, tasks: any[]): Promise<any[]> {
  const refs: LogLineRef[] = []
  for (const task of tasks) {
    if (task.startEvidence) refs.push(task.startEvidence)
    if (task.endEvidence) refs.push(task.endEvidence)
    if (task.failureLine) refs.push(task.failureLine)
    if (task.beforeFailureLines) refs.push(...task.beforeFailureLines)
    if (task.afterFailureLines) refs.push(...task.afterFailureLines)
    for (const event of task.relatedEvents || []) {
      if (event.line) refs.push(event.line)
      if (event.contextBefore) refs.push(...event.contextBefore)
      if (event.contextAfter) refs.push(...event.contextAfter)
    }
  }
  const map = await resolveRefMap(session, refs)
  for (const task of tasks) {
    if (task.startEvidence) task.startEvidence = refToPlain(task.startEvidence, map)
    if (task.endEvidence) task.endEvidence = refToPlain(task.endEvidence, map)
    if (task.failureLine) task.failureLine = refToPlain(task.failureLine, map)
    if (task.beforeFailureLines) task.beforeFailureLines = task.beforeFailureLines.map((ref: LogLineRef) => refToPlain(ref, map))
    if (task.afterFailureLines) task.afterFailureLines = task.afterFailureLines.map((ref: LogLineRef) => refToPlain(ref, map))
    for (const event of task.relatedEvents || []) {
      if (event.line) event.line = refToPlain(event.line, map)
      if (event.contextBefore) event.contextBefore = event.contextBefore.map((ref: LogLineRef) => refToPlain(ref, map))
      if (event.contextAfter) event.contextAfter = event.contextAfter.map((ref: LogLineRef) => refToPlain(ref, map))
    }
  }
  return tasks
}

async function resolveAssistantContext(session: ReplaySession, context: any): Promise<any> {
  const refs: LogLineRef[] = []
  for (const cause of context.rootCauses || []) {
    refs.push(...(cause.evidenceLines || []))
  }
  for (const match of context.knowledgeMatches || []) {
    refs.push(...(match.evidenceLines || []))
  }
  const map = await resolveRefMap(session, refs)
  for (const cause of context.rootCauses || []) {
    if (cause.evidenceLines) cause.evidenceLines = cause.evidenceLines.map((ref: LogLineRef) => refToPlain(ref, map))
  }
  for (const match of context.knowledgeMatches || []) {
    if (match.evidenceLines) match.evidenceLines = match.evidenceLines.map((ref: LogLineRef) => refToPlain(ref, map))
  }
  return context
}

function withRawField(line: ParsedLogLine): ParsedLogLine & { raw: string } {
  return { ...line, raw: formatRawLine(line) }
}

export function createReplayRoutes(session: ReplaySession): Router {
  const router = Router()

  router.post('/session', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    try {
      const data = await session.load({
        logDir: String(req.body.logDir || ''),
        mapDir: req.body.mapDir ? String(req.body.mapDir) : undefined,
        mapFile: req.body.mapFile ? String(req.body.mapFile) : undefined,
        forceReload: !!req.body.forceReload
      })
      res.json({ succeed: true, overview: data.overview })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/session/jobs', authMiddleware, requireRole('rd', 'admin'), (req, res) => {
    const job = createSessionJob(session, {
      logDir: String(req.body.logDir || ''),
      mapDir: req.body.mapDir ? String(req.body.mapDir) : undefined,
      mapFile: req.body.mapFile ? String(req.body.mapFile) : undefined,
      forceReload: !!req.body.forceReload
    })
    res.json({ succeed: true, job })
  })

  router.get('/session/jobs/:id', authMiddleware, (req, res) => {
    const job = getSessionJob(String(req.params.id))
    if (!job) {
      res.status(404).json({ succeed: false, error: 'job not found' })
      return
    }
    res.json({ succeed: true, job })
  })

  router.get('/session', authMiddleware, (_req, res) => {
    res.json({ overview: session.data.overview, control: session.control })
  })

  router.get('/overview', authMiddleware, (_req, res) => {
    res.json(session.data.overview)
  })

  router.get('/events', authMiddleware, async (req, res) => {
    const startMs = Number(req.query.startMs || 0)
    const endMs = Number(req.query.endMs || 0)
    const mode = ['real_fault', 'config_notice', 'noise'].includes(String(req.query.mode))
      ? String(req.query.mode) as 'real_fault' | 'config_notice' | 'noise'
      : 'all'
    const sort = req.query.sort === 'severity' ? 'severity' : 'time'
    const offset = Math.max(0, Number(req.query.offset || 0))
    const limit = Math.min(Math.max(0, Number(req.query.limit || 0)), 5000)
    const events = filterTimelineEvents(session.data.events, {
      startMs,
      endMs,
      level: req.query.level ? String(req.query.level) : '',
      category: req.query.category ? String(req.query.category) : '',
      mode,
      sort,
      dedupe: req.query.dedupe === 'true'
    })
    const page = limit ? events.slice(offset, offset + limit) : events
    res.json({ events: await resolveTimelineEvents(session, page), total: events.length, offset, limit: limit || events.length })
  })

  router.get('/event-markers', authMiddleware, (req, res) => {
    const startMs = Number(req.query.startMs || session.data.overview.startMs || 0)
    const endMs = Number(req.query.endMs || session.data.overview.endMs || 0)
    const bucketMs = Math.max(1000, Number(req.query.bucketMs || 60_000))
    const buckets = new Map<number, { startMs: number; endMs: number; error: number; warning: number; task: number; level: string; title: string }>()
    for (const event of session.data.events) {
      if (event.timeMs < startMs || event.timeMs > endMs) continue
      const bucket = Math.floor((event.timeMs - startMs) / bucketMs)
      const item = buckets.get(bucket) || { startMs: startMs + bucket * bucketMs, endMs: startMs + (bucket + 1) * bucketMs, error: 0, warning: 0, task: 0, level: 'info', title: '' }
      if (event.level === 'error') item.error += 1
      if (event.level === 'warning') item.warning += 1
      if (event.category === 'task' || event.type === 'task') item.task += 1
      if (event.level === 'error') item.level = 'error'
      else if (event.level === 'warning' && item.level !== 'error') item.level = 'warning'
      if (!item.title) item.title = event.title
      buckets.set(bucket, item)
    }
    res.json({ markers: Array.from(buckets.values()).sort((a, b) => a.startMs - b.startMs) })
  })

  router.get('/frames', authMiddleware, (_req, res) => {
    res.json({
      frames: session.data.frames.map((frame) => ({
        timeMs: frame.timeMs,
        timestamp: frame.timestamp,
        x: frame.x,
        y: frame.y,
        theta: frame.theta,
        status: frame.status,
        taskId: frame.currentTaskId,
        errors: frame.errors,
        battery: frame.battery,
        score: frame.score,
        forkHeight: frame.forkHeight
      }))
    })
  })

  router.get('/error-codes', authMiddleware, async (req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : ''
    const level = req.query.level ? Number(req.query.level) : NaN
    const moduleName = req.query.module ? String(req.query.module) : ''
    const code = req.query.code ? String(req.query.code).toUpperCase() : ''
    const taskId = req.query.taskId ? String(req.query.taskId) : ''
    const occurrenceOffset = Math.max(0, Number(req.query.occurrenceOffset || 0))
    const occurrenceLimit = Math.min(Math.max(0, Number(req.query.occurrenceLimit || 0)), 5000)
    const occurrencesAll = session.data.errorOccurrences
      .filter((it) => !kind || it.kind === kind)
      .filter((it) => !Number.isFinite(level) || it.definition?.level === level)
      .filter((it) => !moduleName || it.line.module.includes(moduleName))
      .filter((it) => !code || it.code.includes(code))
      .filter((it) => !taskId || it.taskId === taskId)
    const occurrences = occurrenceLimit ? occurrencesAll.slice(occurrenceOffset, occurrenceOffset + occurrenceLimit) : occurrencesAll
    const occurrenceCodes = new Set(occurrencesAll.map((it) => it.code))
    const definitions = session.data.errorDefinitions
      .filter((it) => !code || it.code.includes(code))
      .filter((it) => !Number.isFinite(level) || it.level === level)
      .filter((it) => occurrenceCodes.size === 0 ? true : occurrenceCodes.has(it.code))
    const summaries = session.data.errorSummaries
      .filter((it) => !code || it.code.includes(code))
      .filter((it) => !Number.isFinite(level) || it.level === level)
      .filter((it) => occurrenceCodes.size === 0 ? true : occurrenceCodes.has(it.code))
      .map((summary) => ({
        ...summary,
        occurrences: summary.occurrences.filter((it) => occurrencesAll.includes(it))
      }))
    res.json({
      definitions,
      occurrences: await resolveErrorOccurrences(session, occurrences),
      occurrenceTotal: occurrencesAll.length,
      occurrenceOffset,
      occurrenceLimit: occurrenceLimit || occurrencesAll.length,
      summaries: await resolveErrorSummaries(session, summaries)
    })
  })

  router.get('/bookmarks', authMiddleware, async (_req, res) => {
    res.json({ bookmarks: await readBookmarks() })
  })

  router.post('/bookmarks', authMiddleware, async (req, res) => {
    const bookmark = await addBookmark({
      timeMs: Number(req.body.timeMs || 0),
      timestamp: String(req.body.timestamp || ''),
      title: String(req.body.title || '人工书签'),
      note: req.body.note ? String(req.body.note) : undefined,
      eventId: req.body.eventId ? String(req.body.eventId) : undefined,
      level: req.body.level === 'error' || req.body.level === 'warning' ? req.body.level : 'info'
    })
    res.json({ succeed: true, bookmark, bookmarks: await readBookmarks() })
  })

  router.delete('/bookmarks/:id', authMiddleware, async (req, res) => {
    res.json({ succeed: await deleteBookmark(String(req.params.id)), bookmarks: await readBookmarks() })
  })

  router.get('/case-meta', authMiddleware, async (_req, res) => {
    res.json({ caseMeta: await readCaseMeta() })
  })

  router.post('/case-meta', authMiddleware, async (req, res) => {
    res.json({ succeed: true, caseMeta: await writeCaseMeta(req.body || {}) })
  })

  router.get('/knowledge', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    res.json(await listKnowledgeRules(req.query))
  })

  router.post('/knowledge', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    try {
      res.json({ succeed: true, rule: await createKnowledgeRule(req.body || {}), knowledge: await listKnowledgeRules() })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.put('/knowledge/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const rule = await updateKnowledgeRule(String(req.params.id), req.body || {})
    if (!rule) {
      res.status(404).json({ succeed: false, error: 'knowledge rule not found' })
      return
    }
    res.json({ succeed: true, rule, knowledge: await listKnowledgeRules() })
  })

  router.delete('/knowledge/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    res.json({ succeed: await deleteKnowledgeRule(String(req.params.id)), knowledge: await listKnowledgeRules() })
  })

  router.post('/knowledge/:id/toggle', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const rule = await toggleKnowledgeRule(String(req.params.id), typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined)
    if (!rule) {
      res.status(404).json({ succeed: false, error: 'knowledge rule not found' })
      return
    }
    res.json({ succeed: true, rule, knowledge: await listKnowledgeRules() })
  })

  router.get('/knowledge/export', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const categoryIdsRaw = req.query.categoryIds ? String(req.query.categoryIds) : ''
    const categoryIds = categoryIdsRaw ? categoryIdsRaw.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0) : undefined
    const includeUniversal = req.query.includeUniversal === 'false' ? false : true
    const options = categoryIds?.length ? { categoryIds, includeUniversal } : undefined
    res.setHeader('Content-Disposition', 'attachment; filename="knowledge-base.json"')
    res.json(exportKnowledgeLibraryPayload(await readKnowledgeLibraryWithHits(), options))
  })

  router.post('/knowledge/import', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    try {
      res.json({ succeed: true, ...(await importKnowledgeLibraryPayload(req.body.library || req.body, !!req.body.overwrite)) })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/knowledge/suggest-pattern', authMiddleware, requireRole('rd', 'admin'), (req, res) => {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : []
    res.json({ suggestion: suggestKnowledgePattern(lines) })
  })

  router.post('/knowledge/test', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const rule = req.body.rule || req.body
    const match = matchKnowledgeRule(rule, {
      rawLines: await getAllRawLines(session),
      errorOccurrences: session.data.errorOccurrences,
      vehicleStateOccurrences: session.data.vehicleStateOccurrences
    })
    res.json({ match, matched: !!match })
  })

  router.get('/assistant/status', authMiddleware, async (_req, res) => {
    res.json({ succeed: true, status: await getAssistantStatus() })
  })

  router.get('/assistant/config', authMiddleware, requireRole('rd', 'admin'), async (_req, res) => {
    res.json({ succeed: true, config: await getPublicLlmConfig() })
  })

  router.post('/assistant/config', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    try {
      await writeLlmLocalConfig(req.body || {})
      res.json({ succeed: true, config: await getPublicLlmConfig(), status: await getAssistantStatus() })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.delete('/assistant/config', authMiddleware, requireRole('rd', 'admin'), async (_req, res) => {
    await clearLlmLocalConfig()
    res.json({ succeed: true, config: await getPublicLlmConfig(), status: await getAssistantStatus() })
  })

  router.post('/assistant/config/test', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    try {
      const body = req.body || {}
      const saved = await readLlmConfig()
      const client = new OpenAiCompatibleClient({
        provider: body.provider === 'openai_compatible' ? 'openai_compatible' : 'deepseek',
        apiKey: String(body.apiKey || '').trim() || saved.apiKey || '',
        model: String(body.model || (body.provider === 'openai_compatible' ? 'gpt-4o-mini' : 'deepseek-chat')),
        baseUrl: String(body.baseUrl || (body.provider === 'openai_compatible' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com')).replace(/\/+$/, ''),
        timeoutMs: Number(body.timeoutMs || 30000),
        maxTokens: Number(body.maxTokens || 300),
        temperature: Number(body.temperature ?? 0.2),
        source: 'default',
        redaction: {
          enabled: true,
          redactPaths: true,
          redactIp: true,
          redactLongIds: true,
          redactRobotName: false
        }
      })
      const result = await client.chatJson([
        { role: 'system', content: '只返回 JSON。' },
        { role: 'user', content: '返回 {"ok":true,"message":"pong"}' }
      ], {
        maxTokens: Math.max(256, Number(body.maxTokens || 300)),
        timeoutMs: Number(body.timeoutMs || 30000)
      })
      res.json({ succeed: true, result })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/assistant/reindex', authMiddleware, requireRole('rd', 'admin'), async (_req, res) => {
    const store = await rebuildVectorStore()
    res.json({ succeed: true, vectorStore: { chunks: store.chunks.length, updatedAt: store.updatedAt } })
  })

  router.get('/assistant/similar', authMiddleware, async (req, res) => {
    const question = req.query.question ? String(req.query.question) : ''
    res.json({ succeed: true, similarCases: await recommendSimilarCases(session.data, question) })
  })

  router.post('/assistant/context-preview', authMiddleware, async (req, res) => {
    try {
      const context = await buildAssistantContext(session.data, {
        question: String(req.body.question || ''),
        includeLogs: req.body.includeLogs !== false,
        maxLogLines: Number(req.body.maxLogLines || 80),
        maxKnowledge: Number(req.body.maxKnowledge || 8)
      })
      res.json({ succeed: true, context: await resolveAssistantContext(session, context) })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/assistant/ask', authMiddleware, async (req, res) => {
    try {
      const answer = await askReplayAssistant(session.data, {
        question: String(req.body.question || ''),
        includeLogs: req.body.includeLogs !== false,
        maxLogLines: Number(req.body.maxLogLines || 80),
        maxKnowledge: Number(req.body.maxKnowledge || 8)
      })
      res.json({ succeed: true, answer })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.get('/tasks', authMiddleware, async (req, res) => {
    const taskId = req.query.taskId ? String(req.query.taskId) : ''
    const includeContext = req.query.includeContext === 'true'
    const tasks = session.data.tasks
      .filter((task) => !taskId || task.id === taskId)
      .map((task) => includeContext ? task : {
        ...task,
        beforeFailureLines: undefined,
        afterFailureLines: undefined
      })
    res.json({ tasks: await resolveTasks(session, tasks) })
  })

  router.get('/map-aliases', authMiddleware, async (_req, res) => {
    const aliases = await readMapAliases()
    res.json({ aliases, conflicts: findMapAliasConflicts(aliases) })
  })

  router.post('/map-aliases', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const match = session.data.overview.mapMatch
    const detectedMapName = String(req.body.detectedMapName || match.detectedMapName || '')
    const selectedMapFile = String(req.body.selectedMapFile || match.selectedMapFile || '')
    if (!detectedMapName || !selectedMapFile) {
      res.status(400).json({ succeed: false, error: 'detectedMapName and selectedMapFile are required' })
      return
    }
    const alias = await upsertMapAlias({
      detectedMapName,
      selectedMapFile,
      robotName: req.body.robotName ? String(req.body.robotName) : session.data.overview.robotName || undefined,
      note: req.body.note ? String(req.body.note) : undefined
    })
    res.json({ succeed: true, alias })
  })

  router.delete('/map-aliases/:id', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const deleted = await deleteMapAlias(String(req.params.id))
    res.json({ succeed: deleted })
  })

  router.get('/map-aliases/export', authMiddleware, requireRole('rd', 'admin'), async (_req, res) => {
    const payload = exportMapAliasesPayload(await readMapAliases())
    res.setHeader('Content-Disposition', 'attachment; filename="map-alias.json"')
    res.json(payload)
  })

  router.post('/map-aliases/import', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const aliases = Array.isArray(req.body.aliases) ? req.body.aliases : []
    const overwrite = !!req.body.overwrite
    const result = await importMapAliases({ aliases, overwrite })
    res.json({ succeed: true, ...result })
  })

  router.post('/root-causes/:id/feedback', authMiddleware, async (req, res) => {
    const verdict = req.body.verdict === 'false_positive' ? 'false_positive' : 'useful'
    const feedback = await addRootCauseFeedback({
      id: String(req.params.id),
      verdict,
      note: req.body.note ? String(req.body.note) : undefined
    })
    res.json({ succeed: true, feedback })
  })

  router.get('/logs', authMiddleware, async (req, res) => {
    const level = req.query.level ? String(req.query.level) : ''
    const moduleName = req.query.module ? String(req.query.module) : ''
    const keyword = req.query.keyword ? String(req.query.keyword) : ''
    const errorCode = req.query.errorCode ? String(req.query.errorCode) : ''
    const taskId = req.query.taskId ? String(req.query.taskId) : ''
    const noise = req.query.noise ? String(req.query.noise) : ''
    const important = req.query.important ? String(req.query.important) : ''
    const startMs = Number(req.query.startMs || 0)
    const endMs = Number(req.query.endMs || 0)
    const aroundTimeMs = Number(req.query.aroundTimeMs || 0)
    const aroundLines = Math.min(Math.max(0, Number(req.query.aroundLines || 0)), 500)
    const aroundSeconds = Math.min(Math.max(0, Number(req.query.aroundSeconds || 0)), 3600)
    const keywords = String(req.query.keywords || '')
      .split(',')
      .map((it) => it.trim())
      .filter(Boolean)
    const offset = Math.max(0, Number(req.query.offset || 0))
    const limit = Math.min(Number(req.query.limit || 500), 5000)
    const eventLineKeys = new Set(
      session.data.events
        .filter((event) => !important || event.level === 'error' || event.level === 'warning')
        .map((event) => event.line && `${event.line.file}:${event.line.line}`)
        .filter(Boolean) as string[]
    )
    const predicate = (line: ParsedLogLine) => {
      if (level && line.level !== level) return false
      if (moduleName && !line.module.includes(moduleName)) return false
      if (keyword && !line.message.includes(keyword)) return false
      if (keywords.length > 0 && !keywords.every((item) => line.message.includes(item))) return false
      if (errorCode && !line.message.includes(errorCode)) return false
      if (taskId && !line.message.includes(taskId)) return false
      if (startMs && line.timeMs < startMs) return false
      if (endMs && line.timeMs > endMs) return false
      if (noise) {
        const isNoise = isNoiseLine(line)
        if (noise === 'true' ? !isNoise : isNoise) return false
      }
      if (important && !eventLineKeys.has(`${line.file}:${line.line}`)) return false
      return true
    }

    let lines: ParsedLogLine[]
    if (session.data.rawLines.length > 0) {
      lines = session.data.rawLines.filter(predicate)
    } else {
      const store = getRawLineStore(session)
      lines = store ? await store.readFiltered(predicate) : []
    }

    if (aroundTimeMs && aroundLines) {
      let nearestIndex = 0
      for (let i = 0; i < lines.length; i++) {
        if (Math.abs(lines[i].timeMs - aroundTimeMs) < Math.abs(lines[nearestIndex].timeMs - aroundTimeMs)) nearestIndex = i
      }
      lines = lines.slice(Math.max(0, nearestIndex - aroundLines), Math.min(lines.length, nearestIndex + aroundLines + 1))
    }
    if (aroundTimeMs && aroundSeconds) {
      const delta = aroundSeconds * 1000
      lines = lines.filter((line) => Math.abs(line.timeMs - aroundTimeMs) <= delta)
    }
    const page = lines.slice(offset, offset + limit)
    res.json({
      total: lines.length,
      offset,
      limit,
      lines: page.map(withRawField),
      keywordMatches: keywords,
      copyText: page.map((line) => formatRawLine(line)).join('\n'),
      folded: session.data.foldedLogs
    })
  })

  router.get('/folded-logs/:id/lines', authMiddleware, async (req, res) => {
    const offset = Math.max(0, Number(req.query.offset || 0))
    const limit = Math.min(Number(req.query.limit || 200), 1000)
    const ruleId = String(req.params.id)
    let lines: ParsedLogLine[]
    if (session.data.rawLines.length > 0) {
      lines = session.data.rawLines.filter((line) => noiseRuleId(line) === ruleId)
    } else {
      const store = getRawLineStore(session)
      lines = store ? await store.readFiltered((line) => noiseRuleId(line) === ruleId) : []
    }
    const page = lines.slice(offset, offset + limit)
    res.json({
      id: ruleId,
      total: lines.length,
      offset,
      limit,
      lines: page.map(withRawField),
      copyText: page.map((line) => formatRawLine(line)).join('\n')
    })
  })

  router.get('/report.md', authMiddleware, async (_req, res) => {
    res.type('text/markdown; charset=utf-8').send(await buildMarkdownReportAsync(session.data))
  })

  router.get('/report.json', authMiddleware, (_req, res) => {
    res.json(buildJsonReport(session.data))
  })

  router.get('/package', authMiddleware, async (_req, res) => {
    try {
      const pkg = await exportDiagnosticPackage(session.data)
      res.download(pkg.file, pkg.name)
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/package/export', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    try {
      const pkg = await exportDiagnosticPackage(session.data, {
        startMs: Number(req.body.startMs || 0) || undefined,
        endMs: Number(req.body.endMs || 0) || undefined,
        includeMap: req.body.includeMap !== false,
        includeReports: req.body.includeReports !== false,
        includeAliases: req.body.includeAliases !== false,
        includeFeedback: req.body.includeFeedback !== false
      })
      res.json({ succeed: true, package: pkg })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/package/compare', authMiddleware, (req, res) => {
    try {
      const left = req.body.left as DiagnosticPackageManifest
      const right = req.body.right as DiagnosticPackageManifest
      res.json({ succeed: true, comparison: comparePackageManifests(left, right) })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.post('/package/import', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const content = typeof req.body.content === 'string' ? req.body.content : ''
    const fileName = path.basename(String(req.body.fileName || 'diagnostic-package.zip'))
    if (!content) {
      res.status(400).json({ succeed: false, error: 'content is required' })
      return
    }
    const tempFile = path.join(os.tmpdir(), `${Date.now()}-${fileName}`)
    try {
      await fs.writeFile(tempFile, Buffer.from(content, 'base64'))
      const imported = await importDiagnosticPackage(tempFile)
      const data = await session.load({
        logDir: imported.logDir,
        mapDir: imported.mapDir,
        mapFile: imported.mapFile,
        forceReload: true
      })
      res.json({
        succeed: true,
        package: {
          id: imported.id,
          rootDir: imported.rootDir,
          logDir: imported.logDir,
          mapDir: imported.mapDir,
          mapFile: imported.mapFile,
          manifest: imported.manifest,
          mapAliases: imported.mapAliases,
          aliasConflicts: imported.aliasConflicts,
          rootCauseFeedback: imported.rootCauseFeedback,
          bookmarks: imported.bookmarks
        },
        overview: data.overview
      })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      await fs.rm(tempFile, { force: true }).catch(() => undefined)
    }
  })

  router.post('/package/import-path', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    const zipPath = path.resolve(String(req.body.path || ''))
    if (!zipPath || path.extname(zipPath).toLowerCase() !== '.zip') {
      res.status(400).json({ succeed: false, error: 'path must be a .zip file' })
      return
    }
    try {
      const stat = await fs.stat(zipPath)
      if (!stat.isFile()) {
        res.status(400).json({ succeed: false, error: 'path must be a file' })
        return
      }
      const imported = await importDiagnosticPackage(zipPath)
      const data = await session.load({
        logDir: imported.logDir,
        mapDir: imported.mapDir,
        mapFile: imported.mapFile,
        forceReload: true
      })
      res.json({
        succeed: true,
        package: {
          id: imported.id,
          rootDir: imported.rootDir,
          logDir: imported.logDir,
          mapDir: imported.mapDir,
          mapFile: imported.mapFile,
          manifest: imported.manifest,
          mapAliases: imported.mapAliases,
          aliasConflicts: imported.aliasConflicts,
          rootCauseFeedback: imported.rootCauseFeedback,
          bookmarks: imported.bookmarks
        },
        overview: data.overview
      })
    } catch (e) {
      res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
    }
  })

  router.get('/cache', authMiddleware, requireRole('rd', 'admin'), async (_req, res) => {
    res.json(await getCacheSummary())
  })

  router.delete('/cache', authMiddleware, requireRole('rd', 'admin'), async (req, res) => {
    await clearReplayCache(req.query.bucket ? String(req.query.bucket) : undefined)
    res.json({ succeed: true, cache: await getCacheSummary() })
  })

  router.post('/control', authMiddleware, (req, res) => {
    if (typeof req.body.playing === 'boolean') session.control.playing = req.body.playing
    if (Number.isFinite(Number(req.body.speed))) session.control.speed = Number(req.body.speed)
    if (req.body.mode === 'realtime' || req.body.mode === 'frame_compact') session.control.mode = req.body.mode
    if (typeof req.body.loopEnabled === 'boolean') session.control.loopEnabled = req.body.loopEnabled
    if (Number.isFinite(Number(req.body.loopStartMs))) session.control.loopStartMs = Number(req.body.loopStartMs)
    if (Number.isFinite(Number(req.body.loopEndMs))) session.control.loopEndMs = Number(req.body.loopEndMs)
    if (typeof req.body.autoPauseOnIssue === 'boolean') session.control.autoPauseOnIssue = req.body.autoPauseOnIssue
    res.json({ succeed: true, control: session.control })
  })

  router.post('/seek', authMiddleware, (req, res) => {
    const target = Number(req.body.timeMs)
    const frameIndex = Number(req.body.frameIndex)
    if (Number.isFinite(frameIndex)) session.seekByFrameIndex(frameIndex)
    else if (Number.isFinite(target)) session.seekByTime(target)
    res.json({ succeed: true, control: session.control, frame: session.getCurrentFrame() })
  })

  return router
}
