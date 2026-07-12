import cors from 'cors'
import express from 'express'
import fs from 'fs/promises'
import http from 'http'
import os from 'os'
import path from 'path'
import { WebSocketServer } from 'ws'
import { clearReplayCache, getCacheSummary } from './core/cache'
import { exportDiagnosticPackage, importDiagnosticPackage, type DiagnosticPackageManifest } from './core/diagnosticPackage'
import { isNoiseLine, noiseRuleId } from './core/noise'
import { addBookmark, deleteBookmark, readBookmarks } from './core/bookmarks'
import { readCaseMeta, writeCaseMeta } from './core/caseMeta'
import {
  createKnowledgeRule,
  deleteKnowledgeRule,
  exportKnowledgeLibraryPayload,
  importKnowledgeLibraryPayload,
  listKnowledgeRules,
  matchKnowledgeRule,
  readKnowledgeLibrary,
  suggestKnowledgePattern,
  toggleKnowledgeRule,
  updateKnowledgeRule
} from './core/knowledgeBase'
import { comparePackageManifests } from './core/packageCompare'
import {
  deleteMapAlias,
  exportMapAliasesPayload,
  findMapAliasConflicts,
  importMapAliases,
  readMapAliases,
  upsertMapAlias
} from './core/mapAlias'
import { buildJsonReport, buildMarkdownReportAsync } from './core/report'
import { askReplayAssistant, buildAssistantContext, recommendSimilarCases } from './core/ragAssistant'
import { addRootCauseFeedback } from './core/rootCauseFeedback'
import { ReplaySession } from './core/session'
import { createSessionJob, getSessionJob } from './core/sessionJobs'
import { filterTimelineEvents } from './core/timeline'
import { getAssistantStatus, getPublicLlmConfig } from './core/llmConfig'
import { clearLlmLocalConfig, writeLlmLocalConfig } from './core/llmConfigStore'
import { OpenAiCompatibleClient } from './core/openAiCompatibleClient'
import { rebuildVectorStore } from './core/vectorStore'

const app = express()
const server = http.createServer(app)
const port = Number(process.env.REPLAY_PORT || 18080)
const host = process.env.REPLAY_HOST || '127.0.0.1'
const session = new ReplaySession()

app.use(cors())
app.use(express.json({ limit: '80mb' }))

app.post('/api/replay/session', async (req, res) => {
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

app.post('/api/replay/session/jobs', (req, res) => {
  const job = createSessionJob(session, {
    logDir: String(req.body.logDir || ''),
    mapDir: req.body.mapDir ? String(req.body.mapDir) : undefined,
    mapFile: req.body.mapFile ? String(req.body.mapFile) : undefined,
    forceReload: !!req.body.forceReload
  })
  res.json({ succeed: true, job })
})

app.get('/api/replay/session/jobs/:id', (req, res) => {
  const job = getSessionJob(req.params.id)
  if (!job) {
    res.status(404).json({ succeed: false, error: 'job not found' })
    return
  }
  res.json({ succeed: true, job })
})

app.get('/api/replay/session', (_req, res) => {
  res.json({ overview: session.data.overview, control: session.control })
})

app.get('/api/replay/overview', (_req, res) => {
  res.json(session.data.overview)
})

app.get('/api/replay/events', (req, res) => {
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
  res.json({ events: page, total: events.length, offset, limit: limit || events.length })
})

app.get('/api/replay/event-markers', (req, res) => {
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

app.get('/api/replay/frames', (_req, res) => {
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

app.get('/api/replay/error-codes', (req, res) => {
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
    occurrences,
    occurrenceTotal: occurrencesAll.length,
    occurrenceOffset,
    occurrenceLimit: occurrenceLimit || occurrencesAll.length,
    summaries
  })
})

app.get('/api/replay/bookmarks', async (_req, res) => {
  res.json({ bookmarks: await readBookmarks() })
})

app.post('/api/replay/bookmarks', async (req, res) => {
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

app.delete('/api/replay/bookmarks/:id', async (req, res) => {
  res.json({ succeed: await deleteBookmark(req.params.id), bookmarks: await readBookmarks() })
})

app.get('/api/replay/case-meta', async (_req, res) => {
  res.json({ caseMeta: await readCaseMeta() })
})

app.post('/api/replay/case-meta', async (req, res) => {
  res.json({ succeed: true, caseMeta: await writeCaseMeta(req.body || {}) })
})

app.get('/api/replay/knowledge', async (req, res) => {
  res.json(await listKnowledgeRules(req.query))
})

app.post('/api/replay/knowledge', async (req, res) => {
  try {
    res.json({ succeed: true, rule: await createKnowledgeRule(req.body || {}), knowledge: await listKnowledgeRules() })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.put('/api/replay/knowledge/:id', async (req, res) => {
  const rule = await updateKnowledgeRule(req.params.id, req.body || {})
  if (!rule) {
    res.status(404).json({ succeed: false, error: 'knowledge rule not found' })
    return
  }
  res.json({ succeed: true, rule, knowledge: await listKnowledgeRules() })
})

app.delete('/api/replay/knowledge/:id', async (req, res) => {
  res.json({ succeed: await deleteKnowledgeRule(req.params.id), knowledge: await listKnowledgeRules() })
})

app.post('/api/replay/knowledge/:id/toggle', async (req, res) => {
  const rule = await toggleKnowledgeRule(req.params.id, typeof req.body.enabled === 'boolean' ? req.body.enabled : undefined)
  if (!rule) {
    res.status(404).json({ succeed: false, error: 'knowledge rule not found' })
    return
  }
  res.json({ succeed: true, rule, knowledge: await listKnowledgeRules() })
})

app.get('/api/replay/knowledge/export', async (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="knowledge-base.json"')
  res.json(exportKnowledgeLibraryPayload(await readKnowledgeLibrary()))
})

app.post('/api/replay/knowledge/import', async (req, res) => {
  try {
    res.json({ succeed: true, ...(await importKnowledgeLibraryPayload(req.body.library || req.body, !!req.body.overwrite)) })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/replay/knowledge/suggest-pattern', (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : []
  res.json({ suggestion: suggestKnowledgePattern(lines) })
})

app.post('/api/replay/knowledge/test', async (req, res) => {
  const rule = req.body.rule || req.body
  const match = matchKnowledgeRule(rule, session.data.rawLines)
  res.json({ match, matched: !!match })
})

app.get('/api/replay/assistant/status', async (_req, res) => {
  res.json({ succeed: true, status: await getAssistantStatus() })
})

app.get('/api/replay/assistant/config', async (_req, res) => {
  res.json({ succeed: true, config: await getPublicLlmConfig() })
})

app.post('/api/replay/assistant/config', async (req, res) => {
  try {
    await writeLlmLocalConfig(req.body || {})
    res.json({ succeed: true, config: await getPublicLlmConfig(), status: await getAssistantStatus() })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.delete('/api/replay/assistant/config', async (_req, res) => {
  await clearLlmLocalConfig()
  res.json({ succeed: true, config: await getPublicLlmConfig(), status: await getAssistantStatus() })
})

app.post('/api/replay/assistant/config/test', async (req, res) => {
  try {
    const body = req.body || {}
    const client = new OpenAiCompatibleClient({
      provider: body.provider === 'openai_compatible' ? 'openai_compatible' : 'deepseek',
      apiKey: String(body.apiKey || ''),
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
    ], { maxTokens: 80, timeoutMs: Number(body.timeoutMs || 30000) })
    res.json({ succeed: true, result })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/replay/assistant/reindex', async (_req, res) => {
  const store = await rebuildVectorStore()
  res.json({ succeed: true, vectorStore: { chunks: store.chunks.length, updatedAt: store.updatedAt } })
})

app.get('/api/replay/assistant/similar', async (req, res) => {
  const question = req.query.question ? String(req.query.question) : ''
  res.json({ succeed: true, similarCases: await recommendSimilarCases(session.data, question) })
})

app.post('/api/replay/assistant/context-preview', async (req, res) => {
  try {
    const context = await buildAssistantContext(session.data, {
      question: String(req.body.question || ''),
      includeLogs: req.body.includeLogs !== false,
      maxLogLines: Number(req.body.maxLogLines || 80),
      maxKnowledge: Number(req.body.maxKnowledge || 8)
    })
    res.json({ succeed: true, context })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/replay/assistant/ask', async (req, res) => {
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

app.get('/api/replay/tasks', (req, res) => {
  const taskId = req.query.taskId ? String(req.query.taskId) : ''
  const includeContext = req.query.includeContext === 'true'
  const tasks = session.data.tasks
    .filter((task) => !taskId || task.id === taskId)
    .map((task) => includeContext ? task : {
      ...task,
      beforeFailureLines: undefined,
      afterFailureLines: undefined
    })
  res.json({ tasks })
})

app.get('/api/replay/map-aliases', async (_req, res) => {
  const aliases = await readMapAliases()
  res.json({ aliases, conflicts: findMapAliasConflicts(aliases) })
})

app.post('/api/replay/map-aliases', async (req, res) => {
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

app.delete('/api/replay/map-aliases/:id', async (req, res) => {
  const deleted = await deleteMapAlias(req.params.id)
  res.json({ succeed: deleted })
})

app.get('/api/replay/map-aliases/export', async (_req, res) => {
  const payload = exportMapAliasesPayload(await readMapAliases())
  res.setHeader('Content-Disposition', 'attachment; filename="map-alias.json"')
  res.json(payload)
})

app.post('/api/replay/map-aliases/import', async (req, res) => {
  const aliases = Array.isArray(req.body.aliases) ? req.body.aliases : []
  const overwrite = !!req.body.overwrite
  const result = await importMapAliases({ aliases, overwrite })
  res.json({ succeed: true, ...result })
})

app.post('/api/replay/root-causes/:id/feedback', async (req, res) => {
  const verdict = req.body.verdict === 'false_positive' ? 'false_positive' : 'useful'
  const feedback = await addRootCauseFeedback({
    id: req.params.id,
    verdict,
    note: req.body.note ? String(req.body.note) : undefined
  })
  res.json({ succeed: true, feedback })
})

app.get('/api/replay/logs', (req, res) => {
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
  let lines = session.data.rawLines
    .filter((line) => !level || line.level === level)
    .filter((line) => !moduleName || line.module.includes(moduleName))
    .filter((line) => !keyword || line.raw.includes(keyword))
    .filter((line) => keywords.length === 0 || keywords.every((item) => line.raw.includes(item)))
    .filter((line) => !errorCode || line.raw.includes(errorCode))
    .filter((line) => !taskId || line.raw.includes(taskId))
    .filter((line) => !startMs || line.timeMs >= startMs)
    .filter((line) => !endMs || line.timeMs <= endMs)
    .filter((line) => !noise || (noise === 'true' ? isNoiseLine(line) : !isNoiseLine(line)))
    .filter((line) => !important || eventLineKeys.has(`${line.file}:${line.line}`))
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
    lines: page,
    keywordMatches: keywords,
    copyText: page.map((line) => line.raw).join('\n'),
    folded: session.data.foldedLogs
  })
})

app.get('/api/replay/folded-logs/:id/lines', (req, res) => {
  const offset = Math.max(0, Number(req.query.offset || 0))
  const limit = Math.min(Number(req.query.limit || 200), 1000)
  const lines = session.data.rawLines.filter((line) => noiseRuleId(line) === req.params.id)
  const page = lines.slice(offset, offset + limit)
  res.json({
    id: req.params.id,
    total: lines.length,
    offset,
    limit,
    lines: page,
    copyText: page.map((line) => line.raw).join('\n')
  })
})

app.get('/api/replay/report.md', async (_req, res) => {
  res.type('text/markdown; charset=utf-8').send(await buildMarkdownReportAsync(session.data))
})

app.get('/api/replay/report.json', (_req, res) => {
  res.json(buildJsonReport(session.data))
})

app.get('/api/replay/package', async (_req, res) => {
  try {
    const pkg = await exportDiagnosticPackage(session.data)
    res.download(pkg.file, pkg.name)
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/replay/package/export', async (req, res) => {
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

app.post('/api/replay/package/compare', (req, res) => {
  try {
    const left = req.body.left as DiagnosticPackageManifest
    const right = req.body.right as DiagnosticPackageManifest
    res.json({ succeed: true, comparison: comparePackageManifests(left, right) })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/replay/package/import', async (req, res) => {
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

app.post('/api/replay/package/import-path', async (req, res) => {
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

app.get('/api/replay/cache', async (_req, res) => {
  res.json(await getCacheSummary())
})

app.delete('/api/replay/cache', async (req, res) => {
  await clearReplayCache(req.query.bucket ? String(req.query.bucket) : undefined)
  res.json({ succeed: true, cache: await getCacheSummary() })
})

app.post('/api/replay/control', (req, res) => {
  if (typeof req.body.playing === 'boolean') session.control.playing = req.body.playing
  if (Number.isFinite(Number(req.body.speed))) session.control.speed = Number(req.body.speed)
  if (req.body.mode === 'realtime' || req.body.mode === 'frame_compact') session.control.mode = req.body.mode
  if (typeof req.body.loopEnabled === 'boolean') session.control.loopEnabled = req.body.loopEnabled
  if (Number.isFinite(Number(req.body.loopStartMs))) session.control.loopStartMs = Number(req.body.loopStartMs)
  if (Number.isFinite(Number(req.body.loopEndMs))) session.control.loopEndMs = Number(req.body.loopEndMs)
  if (typeof req.body.autoPauseOnIssue === 'boolean') session.control.autoPauseOnIssue = req.body.autoPauseOnIssue
  res.json({ succeed: true, control: session.control })
})

app.post('/api/replay/seek', (req, res) => {
  const target = Number(req.body.timeMs)
  const frameIndex = Number(req.body.frameIndex)
  if (Number.isFinite(frameIndex)) session.seekByFrameIndex(frameIndex)
  else if (Number.isFinite(target)) session.seekByTime(target)
  res.json({ succeed: true, control: session.control, frame: session.getCurrentFrame() })
})

app.get('/api/state', (_req, res) => {
  res.json(buildStateSnapshot())
})

app.get('/api/map', (_req, res) => {
  res.json(session.data.map)
})

app.get('/api/params', (_req, res) => {
  res.json({ params: {} })
})

const highWss = new WebSocketServer({ noServer: true })
const lowWss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws/high') {
    highWss.handleUpgrade(req, socket, head, (ws) => highWss.emit('connection', ws, req))
  } else if (req.url === '/ws/low') {
    lowWss.handleUpgrade(req, socket, head, (ws) => lowWss.emit('connection', ws, req))
  } else {
    socket.destroy()
  }
})

setInterval(() => {
  tickPlayback()
  const high = JSON.stringify({ type: 'high', ...buildHighState() })
  const low = JSON.stringify({ type: 'low', ...buildLowState() })
  for (const ws of highWss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(high)
  }
  for (const ws of lowWss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(low)
  }
}, 200)

server.listen(port, host, () => {
  console.log(`replay server listening on http://${host}:${port}`)
})

function tickPlayback() {
  if (!session.control.playing || session.data.frames.length === 0) return
  if (session.control.mode === 'frame_compact') {
    session.control.currentFrameIndex += Math.max(1, Math.round(session.control.speed))
    if (session.control.currentFrameIndex >= session.data.frames.length - 1) {
      session.control.currentFrameIndex = session.data.frames.length - 1
      session.control.playing = false
    }
    session.seekByFrameIndex(session.control.currentFrameIndex)
    return
  }
  session.control.currentMs += 200 * session.control.speed
  if (session.control.autoPauseOnIssue && hasIssueNear(session.control.currentMs)) {
    session.control.playing = false
    session.seekByTime(session.control.currentMs)
    return
  }
  if (session.control.loopEnabled && session.control.loopEndMs && session.control.currentMs > session.control.loopEndMs) {
    session.control.currentMs = session.control.loopStartMs || session.data.frames[0].timeMs
  }
  const last = session.data.frames[session.data.frames.length - 1]
  if (session.control.currentMs > last.timeMs) {
    session.control.currentMs = last.timeMs
    session.control.currentFrameIndex = session.data.frames.length - 1
    session.control.playing = false
  } else {
    session.seekByTime(session.control.currentMs)
  }
}

function hasIssueNear(timeMs: number): boolean {
  return session.data.events.some((event) => Math.abs(event.timeMs - timeMs) <= 300 && (event.level === 'error' || ['estop', 'lost', 'loc_score'].includes(event.category || '')))
}

function buildStateSnapshot(): Record<string, unknown> {
  return {
    ...buildHighState(),
    ...buildLowState()
  }
}

function buildHighState(): Record<string, unknown> {
  const frame = session.getCurrentFrame()
  if (!frame) {
    return {
      vel: '0.00,0.00,0.00',
      pose: '0.00,0.00,0.00',
      laser_data: { size: 0, data: [] },
      path_points: { num: 0, points: [] },
      clearances: { num: 0, points: [] },
      robot_size: { width: 900, length: 1800, length_front: 900, length_rear: 900 }
    }
  }
  return {
    vel: `${frame.vx || 0},${frame.w || 0},${frame.vy || 0}`,
    pose: `${frame.x},${frame.y},${frame.theta}`,
    laser_data: { size: 0, data: [] },
    path_points: { num: 0, points: [] },
    clearances: { num: 0, points: [] },
    robot_size: { width: 900, length: 1800, length_front: 900, length_rear: 900 }
  }
}

function buildLowState(): Record<string, unknown> {
  const frame = session.getCurrentFrame()
  const currentErrors = currentErrorsAt(frame?.timeMs || 0)
  return {
    name: frame?.name || session.data.overview.robotName || 'Replay',
    ip: '127.0.0.1',
    robot_type: 'forklift-replay',
    mode: 'replay',
    status: frame?.status || 'Replay',
    map_name: session.data.map.name,
    score: frame?.score || 0,
    battery: frame?.battery || 0,
    charing: !!frame?.charging,
    ctrl_mode: 0,
    safe: true,
    motor: !!frame?.motor,
    alarm: currentErrors.length > 0 || frame?.estop ? 'estop' : 'normal',
    current_routes: {
      id: frame?.currentTaskId || '',
      key: frame?.currentTaskId || '',
      routes: frame?.currentTaskId || '',
      status: frame?.status || ''
    },
    fork_info: {
      fork_height: frame?.forkHeight || 0,
      fork_up: 0,
      fork_down: 0,
      ctrl_flag: true,
      flap: true
    },
    input: [],
    output: [],
    virtual: []
  }
}

function currentErrorsAt(timeMs: number) {
  return session.data.errorOccurrences.filter((it) => Math.abs(it.timeMs - timeMs) <= 1000)
}
