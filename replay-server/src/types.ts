export type LogLevel = 'D' | 'I' | 'W' | 'E' | 'UNKNOWN'
export type ErrorOccurrenceKind = 'real_fault' | 'config_notice' | 'definition' | 'unknown'
export type ReplayMode = 'realtime' | 'frame_compact'
export type ErrorDictionarySourceKind = 'log_definition' | 'source_config' | 'source_scan' | 'text_guess'
export type RootCauseSource = 'built_in' | 'knowledge_base' | 'llm'

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
  sourceKind?: ErrorDictionarySourceKind
  sourceLabel?: string
  sourcePriority?: number
  confidenceReason?: string
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
  routeSummary?: string
  startEvidence?: ParsedLogLine
  endEvidence?: ParsedLogLine
  trajectoryFrameRange?: [number, number]
  failureLine?: ParsedLogLine
  failureContextCount?: number
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
  triggeredRules?: string[]
  positiveEvidence?: string[]
  negativeEvidence?: string[]
  confidenceFactors?: string[]
  source?: RootCauseSource
  knowledgeRuleId?: string
  knowledgeRuleTitle?: string
}

export interface KnowledgeRuleScope {
  project?: string
  robotType?: string
  mapName?: string
  version?: string
  branch?: string
}

export interface KnowledgeConfidenceWeight {
  type: 'keyword' | 'module' | 'level' | 'errorCode'
  value: string
  weight: number
}

export interface KnowledgeEvidencePattern {
  requiredKeywords: string[]
  anyKeywords: string[]
  excludedKeywords: string[]
  modules: string[]
  levels: LogLevel[]
  errorCodes: string[]
  windowSeconds?: number
  minOccurrences?: number
  confidenceBase?: number
  confidenceWeights?: KnowledgeConfidenceWeight[]
}

export interface KnowledgeExample {
  id: string
  title?: string
  note?: string
  lines: ParsedLogLine[]
  createdAt: string
}

export interface KnowledgeRule {
  id: string
  title: string
  description: string
  rootCause: string
  solution: string
  severity: 'info' | 'warning' | 'error'
  tags: string[]
  enabled: boolean
  scope?: KnowledgeRuleScope
  pattern: KnowledgeEvidencePattern
  examples: KnowledgeExample[]
  hitCount: number
  recentHits?: Array<{
    timestamp: string
    logDir?: string
    evidenceCount: number
  }>
  createdAt: string
  updatedAt: string
  createdBy?: string
}

export interface KnowledgeLibrary {
  version: 1
  updatedAt: string
  rules: KnowledgeRule[]
}

export interface KnowledgeMatch {
  ruleId: string
  title: string
  confidence: number
  severity: 'info' | 'warning' | 'error'
  matchedPatterns: string[]
  evidenceLines: ParsedLogLine[]
  suggestion: string
  description: string
  rootCause: string
  solution: string
  tags: string[]
  scope?: KnowledgeRuleScope
  ruleSnapshot: KnowledgeRule
}

export interface KnowledgePatternSuggestion {
  modules: string[]
  levels: LogLevel[]
  errorCodes: string[]
  requiredKeywords: string[]
  anyKeywords: string[]
  excludedKeywords: string[]
  windowSeconds: number
  minOccurrences: number
  confidenceBase: number
  confidenceWeights: KnowledgeConfidenceWeight[]
}

export type VectorDocumentSourceType = 'knowledge_rule' | 'case_meta' | 'knowledge_match' | 'log_excerpt'

export interface VectorDocumentSource {
  type: VectorDocumentSourceType
  id: string
  title: string
  timestamp?: string
  tags?: string[]
  solution?: string
  evidence?: string[]
}

export interface VectorDocumentChunk {
  id: string
  source: VectorDocumentSource
  text: string
  summary: string
  metadata: Record<string, unknown>
  embedding: number[]
  updatedAt: string
}

export interface VectorSearchResult {
  chunk: VectorDocumentChunk
  score: number
  highlights: string[]
}

export interface AssistantContext {
  overview: Partial<OverviewSummary>
  rootCauses: RootCauseCandidate[]
  knowledgeMatches: KnowledgeMatch[]
  similarChunks: VectorSearchResult[]
  logExcerpts: ParsedLogLine[]
  redaction: {
    enabled: boolean
    rules: string[]
  }
}

export interface AssistantAskRequest {
  question: string
  includeLogs?: boolean
  maxLogLines?: number
  maxKnowledge?: number
}

export interface AssistantEvidence {
  title: string
  source: string
  excerpt: string
  timestamp?: string
  score?: number
}

export interface AssistantAnswer {
  answer: string
  rootCauseCandidates: string[]
  suggestions: string[]
  evidence: AssistantEvidence[]
  uncertainties: string[]
  similarCases: VectorSearchResult[]
  provider: 'offline' | LlmProviderType
  model: string
  offline: boolean
  createdAt: string
}

export interface AssistantStatus {
  provider: LlmProviderType
  model: string
  baseUrl?: string
  enabled: boolean
  apiKeyMasked?: string
  source?: 'local_file' | 'env' | 'default'
  reason: string
  vectorStore: {
    chunks: number
    updatedAt: string
  }
}

export type LlmProviderType = 'deepseek' | 'openai_compatible'

export interface LlmRuntimeConfig {
  provider: LlmProviderType
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs: number
  maxTokens: number
  temperature: number
  source: 'local_file' | 'env' | 'default'
  redaction: {
    enabled: boolean
    redactPaths: boolean
    redactIp: boolean
    redactLongIds: boolean
    redactRobotName: boolean
  }
}

export interface LlmPublicConfig {
  provider: LlmProviderType
  model: string
  baseUrl: string
  timeoutMs: number
  maxTokens: number
  temperature: number
  enabled: boolean
  apiKeyMasked: string
  source: 'local_file' | 'env' | 'default'
  updatedAt?: string
}

export interface LlmConfigUpdateRequest {
  provider?: LlmProviderType
  apiKey?: string
  model?: string
  baseUrl?: string
  timeoutMs?: number
  maxTokens?: number
  temperature?: number
}

export interface AssistantSnapshot {
  lastAnswer?: AssistantAnswer
  similarCases?: VectorSearchResult[]
}

export interface RecommendedFocusTime {
  timeMs: number
  timestamp: string
  title: string
  reason: string
  level: 'info' | 'warning' | 'error'
}

export interface ParseStats {
  loadMs: number
  parseMs: number
  mapLoadMs: number
  totalMs: number
  cacheHit: boolean
  source: string
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
  healthScore: number
  logQualityScore: number
  recommendedFocusTimes: RecommendedFocusTime[]
  parseStats: ParseStats
}

export interface ReplayBookmark {
  id: string
  timeMs: number
  timestamp: string
  title: string
  note?: string
  eventId?: string
  level?: 'info' | 'warning' | 'error'
  createdAt: string
}

export interface ReplayCaseMeta {
  site?: string
  robotName?: string
  operator?: string
  testRound?: string
  confirmedRootCause?: string
  status?: 'pending' | 'reproduced' | 'located' | 'fixed' | 'closed'
  note?: string
  updatedAt?: string
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
  bookmarks?: ReplayBookmark[]
  caseMeta?: ReplayCaseMeta
  knowledgeMatches?: KnowledgeMatch[]
  assistant?: AssistantSnapshot
}

export interface ReplayControlState {
  playing: boolean
  speed: number
  currentMs: number
  currentFrameIndex: number
  mode: ReplayMode
  loopEnabled?: boolean
  loopStartMs?: number
  loopEndMs?: number
  autoPauseOnIssue?: boolean
}
