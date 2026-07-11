export type LogLevel = 'D' | 'I' | 'W' | 'E' | 'UNKNOWN'
export type ErrorOccurrenceKind = 'real_fault' | 'config_notice' | 'definition' | 'unknown'
export type ReplayMode = 'realtime' | 'frame_compact'

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
  lastFinishedTaskId?: string
  lastFinishedTaskSuccess?: boolean
  unfinishedPath?: unknown
  newUnfinishedPath?: unknown
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
  source?: 'log' | 'source' | 'unknown'
  sourceFile?: string
  sourceLine?: number
  dictionaryConfidence?: number
  raw?: Record<string, unknown>
  firstLine?: ParsedLogLine
}

export interface ErrorOccurrence {
  code: string
  timestamp: string
  timeMs: number
  source: string
  kind: ErrorOccurrenceKind
  taskId?: string
  line: ParsedLogLine
  definition?: ErrorCodeDefinition
}

export interface TimelineEvent {
  id: string
  timestamp: string
  timeMs: number
  type: string
  category?: string
  level: 'info' | 'warning' | 'error'
  title: string
  detail: string
  module?: string
  code?: string
  taskId?: string
  line?: ParsedLogLine
  contextBefore?: ParsedLogLine[]
  contextAfter?: ParsedLogLine[]
}

export interface TaskSegment {
  id: string
  startMs: number
  endMs: number
  startTime: string
  endTime: string
  status?: string
  lastFinishedTaskId?: string
  lastFinishedTaskSuccess?: boolean
  unfinishedPath?: unknown
  newUnfinishedPath?: unknown
  errors: string[]
  relatedEvents?: TimelineEvent[]
  failureReasonCandidates?: string[]
  startEvidence?: ParsedLogLine
  endEvidence?: ParsedLogLine
  trajectoryFrameRange?: [number, number]
  beforeFailureLines?: ParsedLogLine[]
  afterFailureLines?: ParsedLogLine[]
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

export interface MapMatchInfo {
  requestedMapFile?: string
  detectedMapName?: string
  selectedMapFile?: string
  matchStrategy: 'manual' | 'alias' | 'detected_exact' | 'detected_contains' | 'fallback_first_json' | 'missing'
  confidence: number
  warnings: string[]
  aliasMatched?: boolean
  aliasSource?: string
}

export interface RootCauseCandidate {
  id: string
  title: string
  confidence: number
  severity: 'info' | 'warning' | 'error'
  evidenceEvents: TimelineEvent[]
  evidenceLines: ParsedLogLine[]
  suggestion: string
}

export interface OverviewSummary {
  loaded: boolean
  logDir: string
  logFiles: string[]
  mapPath: string
  files: number
  lines: number
  startTime: string
  endTime: string
  startMs: number
  endMs: number
  durationMs: number
  hasMap: boolean
  hasFrames: boolean
  hasTasks: boolean
  hasErrorDefinitions: boolean
  errorLogCount: number
  warningLogCount: number
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
  mapMatch: MapMatchInfo
  rootCauses: RootCauseCandidate[]
  dataWarnings: string[]
}

export interface ErrorCodeSummary {
  code: string
  description?: string
  screenText?: string
  level?: number
  count: number
  realCount: number
  configNoticeCount: number
  firstTime: string
  lastTime: string
  firstMs: number
  lastMs: number
  modules: string[]
  taskIds: string[]
  occurrences: ErrorOccurrence[]
}

export interface ReplaySessionData {
  overview: OverviewSummary
  map: { name: string; data: unknown }
  frames: ReplayFrame[]
  events: TimelineEvent[]
  errorDefinitions: ErrorCodeDefinition[]
  errorOccurrences: ErrorOccurrence[]
  errorSummaries: ErrorCodeSummary[]
  tasks: TaskSegment[]
  foldedLogs: FoldedLogGroup[]
  rawLines: ParsedLogLine[]
}

export interface ReplayControlState {
  playing: boolean
  speed: number
  currentMs: number
  currentFrameIndex: number
  mode: ReplayMode
}
