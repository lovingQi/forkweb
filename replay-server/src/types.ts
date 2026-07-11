export type LogLevel = 'D' | 'I' | 'W' | 'E' | 'UNKNOWN'

export interface ParsedLogLine {
  file: string
  line: number
  timestamp: string
  timeMs: number
  module: string
  sourceLine: number | null
  level: LogLevel
  message: string
  raw: string
}

export interface ReplayFrame {
  timestamp: string
  timeMs: number
  source: 'FltStatus' | 'InfoStatus' | 'merged'
  name?: string
  x: number
  y: number
  theta: number
  status?: string
  battery?: number
  score?: number
  currentTaskId?: string
  errors?: string
  forkHeight?: number
  loaded?: boolean
  estop?: boolean
  motor?: boolean
  charging?: boolean
  vx?: number
  vy?: number
  w?: number
  rawLine: ParsedLogLine
}

export interface ErrorCodeDefinition {
  code: string
  description?: string
  screenText?: string
  level?: number
  toRms?: boolean
  toScreen?: boolean
  toWarn?: boolean
  raw?: Record<string, unknown>
  firstLine?: ParsedLogLine
}

export interface ErrorOccurrence {
  code: string
  timestamp: string
  timeMs: number
  source: string
  taskId?: string
  line: ParsedLogLine
  definition?: ErrorCodeDefinition
}

export interface TimelineEvent {
  id: string
  timestamp: string
  timeMs: number
  type: string
  level: 'info' | 'warning' | 'error'
  title: string
  detail: string
  module?: string
  code?: string
  taskId?: string
  line?: ParsedLogLine
}

export interface TaskSegment {
  id: string
  startMs: number
  endMs: number
  startTime: string
  endTime: string
  status?: string
  errors: string[]
  frames: number
}

export interface FoldedLogGroup {
  id: string
  label: string
  count: number
  firstTime: string
  lastTime: string
  firstLine: ParsedLogLine
  lastLine: ParsedLogLine
}

export interface OverviewSummary {
  loaded: boolean
  logDir: string
  mapPath: string
  files: number
  lines: number
  startTime: string
  endTime: string
  robotName: string
  version: string
  branch: string
  mapName: string
  frameCount: number
  taskCount: number
  errorCodeCount: number
  errorCount: number
  warningCount: number
  topIssues: TimelineEvent[]
}

export interface ReplaySessionData {
  overview: OverviewSummary
  map: { name: string; data: unknown }
  frames: ReplayFrame[]
  events: TimelineEvent[]
  errorDefinitions: ErrorCodeDefinition[]
  errorOccurrences: ErrorOccurrence[]
  tasks: TaskSegment[]
  foldedLogs: FoldedLogGroup[]
  rawLines: ParsedLogLine[]
}

export interface ReplayControlState {
  playing: boolean
  speed: number
  currentMs: number
}
