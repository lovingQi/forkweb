import type {
  ErrorOccurrence,
  ParsedLogLine,
  ReplayFrame,
  TimelineEvent
} from '../types'
import { buildRuleEvents } from './rules'

export interface TimelineQuery {
  startMs?: number
  endMs?: number
  level?: string
  category?: string
  mode?: 'all' | 'real_fault' | 'config_notice' | 'noise'
  sort?: 'time' | 'severity'
  dedupe?: boolean
}

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
    if (occurrence.kind === 'definition') continue
    const isConfigNotice = occurrence.kind === 'config_notice'
    const isRealFault = occurrence.kind === 'real_fault'
    events.push({
      id: `error-code-${seq++}`,
      timestamp: occurrence.timestamp,
      timeMs: occurrence.timeMs,
      type: 'error_code',
      category: isConfigNotice ? 'config' : 'error_code',
      level: isRealFault ? 'error' : 'warning',
      title: isConfigNotice ? `错误码配置提醒 ${occurrence.code}` : `错误码 ${occurrence.code}`,
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

export function filterTimelineEvents(events: TimelineEvent[], query: TimelineQuery): TimelineEvent[] {
  let result = [...events]
    .filter((event) => !query.startMs || event.timeMs >= query.startMs)
    .filter((event) => !query.endMs || event.timeMs <= query.endMs)
    .filter((event) => !query.level || event.level === query.level)
    .filter((event) => !query.category || (event.category || event.type) === query.category)
    .filter((event) => eventMatchesMode(event, query.mode || 'all'))
  if (query.dedupe) result = dedupeTimelineEvents(result)
  if (query.sort === 'severity') {
    result.sort((a, b) => severityRank(b.level) - severityRank(a.level) || a.timeMs - b.timeMs)
  } else {
    result.sort((a, b) => a.timeMs - b.timeMs)
  }
  return result
}

export function dedupeTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = []
  for (const event of events) {
    const last = result[result.length - 1]
    if (last && timelineDedupeKey(last) === timelineDedupeKey(event) && Math.abs(event.timeMs - last.timeMs) <= 3000) {
      continue
    }
    result.push(event)
  }
  return result
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

function eventMatchesMode(event: TimelineEvent, mode: TimelineQuery['mode']): boolean {
  if (!mode || mode === 'all') return true
  if (mode === 'real_fault') return event.level === 'error' || event.category === 'error_code'
  if (mode === 'config_notice') return event.category === 'config'
  if (mode === 'noise') return event.category === 'log' && event.level !== 'error'
  return true
}

function severityRank(level: TimelineEvent['level']): number {
  if (level === 'error') return 3
  if (level === 'warning') return 2
  return 1
}

function timelineDedupeKey(event: TimelineEvent): string {
  return [event.type, event.category || '', event.level, event.title, event.code || '', event.module || ''].join('|')
}
