import http from 'http'
import { WebSocketServer } from 'ws'
import type { ReplaySession } from '../core/session'

export function setupReplayWebSocket(server: http.Server, session: ReplaySession): void {
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
    tickPlayback(session)
    const high = JSON.stringify({ type: 'high', ...buildHighState(session) })
    const low = JSON.stringify({ type: 'low', ...buildLowState(session) })
    for (const ws of highWss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(high)
    }
    for (const ws of lowWss.clients) {
      if (ws.readyState === ws.OPEN) ws.send(low)
    }
  }, 200)
}

function tickPlayback(session: ReplaySession) {
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
  if (session.control.autoPauseOnIssue && hasIssueNear(session, session.control.currentMs)) {
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

function hasIssueNear(session: ReplaySession, timeMs: number): boolean {
  return session.data.events.some((event) => Math.abs(event.timeMs - timeMs) <= 300 && (event.level === 'error' || ['estop', 'lost', 'loc_score'].includes(event.category || '')))
}

function buildHighState(session: ReplaySession): Record<string, unknown> {
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

function buildLowState(session: ReplaySession): Record<string, unknown> {
  const frame = session.getCurrentFrame()
  const currentErrors = session.data.errorOccurrences.filter((it) => Math.abs(it.timeMs - (frame?.timeMs || 0)) <= 1000)
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

export function buildStateSnapshot(session: ReplaySession): Record<string, unknown> {
  return {
    ...buildHighState(session),
    ...buildLowState(session)
  }
}
