import type {
  ErrorOccurrence,
  ParsedLogLine,
  ReplayFrame,
  TimelineEvent
} from '../types'
import { buildRuleEvents } from './rules'

export function mergeFrames(frames: ReplayFrame[]): ReplayFrame[] {
  const sorted = [...frames].sort((a, b) => a.timeMs - b.timeMs)
  const merged: ReplayFrame[] = []
  for (const frame of sorted) {
    const last = merged[merged.length - 1]
    if (last && Math.abs(last.timeMs - frame.timeMs) <= 120) {
      Object.assign(last, cleanFrame({ ...last, ...frame, source: 'merged' }))
    } else {
      merged.push({ ...frame })
    }
  }
  return merged
}

export function buildTimelineEvents(
  lines: ParsedLogLine[],
  frames: ReplayFrame[],
  occurrences: ErrorOccurrence[]
): TimelineEvent[] {
  const events = buildRuleEvents(lines)
  let seq = 0
  for (const occurrence of occurrences) {
    events.push({
      id: `error-code-${seq++}`,
      timestamp: occurrence.timestamp,
      timeMs: occurrence.timeMs,
      type: 'error_code',
      category: 'error_code',
      level: 'error',
      title: `错误码 ${occurrence.code}`,
      detail:
        occurrence.definition?.description ||
        occurrence.definition?.screenText ||
        occurrence.line.message,
      module: occurrence.line.module,
      code: occurrence.code,
      taskId: occurrence.taskId,
      line: occurrence.line
    })
  }
  events.push(...buildStateChangeEvents(frames))
  events.push(...buildLowScoreEvents(frames))
  return events.sort((a, b) => a.timeMs - b.timeMs)
}

function buildStateChangeEvents(frames: ReplayFrame[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let lastStatus = ''
  let lastTask = ''
  let seq = 0
  for (const frame of frames) {
    const status = frame.status || ''
    if (status && status !== lastStatus) {
      events.push({
        id: `status-${seq++}`,
        timestamp: frame.timestamp,
        timeMs: frame.timeMs,
        type: 'status',
        category: statusCategory(status),
        level: status.toLowerCase().includes('lost') || status.toLowerCase().includes('estop') ? 'warning' : 'info',
        title: '状态变化',
        detail: status,
        taskId: frame.currentTaskId,
        line: frame.rawLine
      })
      lastStatus = status
    }
    const task = frame.currentTaskId || ''
    if (task && task !== 'Null' && task !== lastTask) {
      events.push({
        id: `task-${seq++}`,
        timestamp: frame.timestamp,
        timeMs: frame.timeMs,
        type: 'task',
        category: 'task',
        level: 'info',
        title: '任务变化',
        detail: task,
        taskId: task,
        line: frame.rawLine
      })
      lastTask = task
    }
  }
  return events
}

function buildLowScoreEvents(frames: ReplayFrame[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let active = false
  let seq = 0
  for (const frame of frames) {
    const score = frame.score
    if (score === undefined) continue
    if (score < 60 && !active) {
      active = true
      events.push({
        id: `loc-score-${seq++}`,
        timestamp: frame.timestamp,
        timeMs: frame.timeMs,
        type: 'loc_score',
        category: 'loc_score',
        level: 'warning',
        title: '定位分过低',
        detail: `score=${score}`,
        taskId: frame.currentTaskId,
        line: frame.rawLine
      })
    }
    if (score >= 60) active = false
  }
  return events
}

function statusCategory(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('lost')) return 'lost'
  if (s.includes('estop')) return 'estop'
  return 'status'
}

function cleanFrame(frame: ReplayFrame): ReplayFrame {
  for (const key of Object.keys(frame) as Array<keyof ReplayFrame>) {
    if (frame[key] === undefined) delete frame[key]
  }
  return frame
}
