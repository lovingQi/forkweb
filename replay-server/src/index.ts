import cors from 'cors'
import express from 'express'
import fs from 'fs/promises'
import http from 'http'
import os from 'os'
import path from 'path'
import { WebSocketServer } from 'ws'
import { clearReplayCache, getCacheSummary } from './core/cache'
import { exportDiagnosticPackage, importDiagnosticPackage } from './core/diagnosticPackage'
import { isNoiseLine, noiseRuleId } from './core/noise'
import {
  deleteMapAlias,
  exportMapAliasesPayload,
  findMapAliasConflicts,
  importMapAliases,
  readMapAliases,
  upsertMapAlias
} from './core/mapAlias'
import { buildJsonReport, buildMarkdownReport } from './core/report'
import { addRootCauseFeedback } from './core/rootCauseFeedback'
import { ReplaySession } from './core/session'
import { filterTimelineEvents } from './core/timeline'

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
  const events = filterTimelineEvents(session.data.events, {
    startMs,
    endMs,
    level: req.query.level ? String(req.query.level) : '',
    category: req.query.category ? String(req.query.category) : '',
    mode,
    sort,
    dedupe: req.query.dedupe === 'true'
  })
  res.json({ events })
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
  const occurrences = session.data.errorOccurrences
    .filter((it) => !kind || it.kind === kind)
    .filter((it) => !Number.isFinite(level) || it.definition?.level === level)
    .filter((it) => !moduleName || it.line.module.includes(moduleName))
    .filter((it) => !code || it.code.includes(code))
    .filter((it) => !taskId || it.taskId === taskId)
  const occurrenceCodes = new Set(occurrences.map((it) => it.code))
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
      occurrences: summary.occurrences.filter((it) => occurrences.includes(it))
    }))
  res.json({
    definitions,
    occurrences,
    summaries
  })
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
  const page = lines.slice(offset, offset + limit)
  res.json({
    total: lines.length,
    offset,
    limit,
    lines: page,
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

app.get('/api/replay/report.md', (_req, res) => {
  res.type('text/markdown; charset=utf-8').send(buildMarkdownReport(session.data))
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
        rootCauseFeedback: imported.rootCauseFeedback
      },
      overview: data.overview
    })
  } catch (e) {
    res.status(400).json({ succeed: false, error: e instanceof Error ? e.message : String(e) })
  } finally {
    await fs.rm(tempFile, { force: true }).catch(() => undefined)
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
  const last = session.data.frames[session.data.frames.length - 1]
  if (session.control.currentMs > last.timeMs) {
    session.control.currentMs = last.timeMs
    session.control.currentFrameIndex = session.data.frames.length - 1
    session.control.playing = false
  } else {
    session.seekByTime(session.control.currentMs)
  }
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
