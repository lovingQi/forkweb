import cors from 'cors'
import express from 'express'
import http from 'http'
import { WebSocketServer } from 'ws'
import { buildJsonReport, buildMarkdownReport } from './core/report'
import { ReplaySession } from './core/session'

const app = express()
const server = http.createServer(app)
const port = Number(process.env.REPLAY_PORT || 18080)
const host = process.env.REPLAY_HOST || '127.0.0.1'
const session = new ReplaySession()

app.use(cors())
app.use(express.json({ limit: '8mb' }))

app.post('/api/replay/session', async (req, res) => {
  try {
    const data = await session.load({
      logDir: String(req.body.logDir || ''),
      mapDir: req.body.mapDir ? String(req.body.mapDir) : undefined,
      mapFile: req.body.mapFile ? String(req.body.mapFile) : undefined
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

app.get('/api/replay/events', (_req, res) => {
  res.json({ events: session.data.events })
})

app.get('/api/replay/error-codes', (_req, res) => {
  res.json({
    definitions: session.data.errorDefinitions,
    occurrences: session.data.errorOccurrences
  })
})

app.get('/api/replay/tasks', (_req, res) => {
  res.json({ tasks: session.data.tasks })
})

app.get('/api/replay/logs', (req, res) => {
  const level = req.query.level ? String(req.query.level) : ''
  const moduleName = req.query.module ? String(req.query.module) : ''
  const keyword = req.query.keyword ? String(req.query.keyword) : ''
  const limit = Math.min(Number(req.query.limit || 500), 5000)
  const lines = session.data.rawLines
    .filter((line) => !level || line.level === level)
    .filter((line) => !moduleName || line.module.includes(moduleName))
    .filter((line) => !keyword || line.raw.includes(keyword))
    .slice(0, limit)
  res.json({ lines, folded: session.data.foldedLogs })
})

app.get('/api/replay/report.md', (_req, res) => {
  res.type('text/markdown; charset=utf-8').send(buildMarkdownReport(session.data))
})

app.get('/api/replay/report.json', (_req, res) => {
  res.json(buildJsonReport(session.data))
})

app.post('/api/replay/control', (req, res) => {
  if (typeof req.body.playing === 'boolean') session.control.playing = req.body.playing
  if (Number.isFinite(Number(req.body.speed))) session.control.speed = Number(req.body.speed)
  res.json({ succeed: true, control: session.control })
})

app.post('/api/replay/seek', (req, res) => {
  const target = Number(req.body.timeMs)
  if (Number.isFinite(target)) session.control.currentMs = target
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
  session.control.currentMs += 200 * session.control.speed
  const last = session.data.frames[session.data.frames.length - 1]
  if (session.control.currentMs > last.timeMs) {
    session.control.currentMs = last.timeMs
    session.control.playing = false
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
