import fs from 'fs/promises'
import path from 'path'
import type {
  ErrorCodeDefinition,
  ErrorOccurrence,
  ErrorCodeSummary,
  MapMatchInfo,
  OverviewSummary,
  ParsedLogLine,
  ReplayControlState,
  ReplayFrame,
  ReplaySessionData
} from '../types'
import { buildCacheKey, cleanupReplayCache, readSessionCache, writeSessionCache } from './cache'
import { loadSourceErrorDictionary } from './errorDictionary'
import { parseErrorDefinition, parseErrorOccurrences } from '../parser/errorCode'
import { parseFltStatus } from '../parser/fltStatus'
import { parseInfoStatus } from '../parser/infoStatus'
import { parseLogLine, sortLogLines } from '../parser/logLine'
import { buildTaskSegments } from '../parser/task'
import { foldNoise } from './noise'
import { matchMapAlias, readMapAliases } from './mapAlias'
import { buildRootCauses } from './rootCause'
import { buildTimelineEvents, mergeFrames } from './timeline'
import { readLogIndex, writeLogIndex, fileFingerprint } from './logIndex'
import { shouldReplaceDefinition } from './errorDictionarySources'
import { readBookmarks } from './bookmarks'
import { readCaseMeta } from './caseMeta'

const EMPTY_OVERVIEW: OverviewSummary = {
  loaded: false,
  logDir: '',
  logFiles: [],
  mapPath: '',
  files: 0,
  lines: 0,
  startTime: '',
  endTime: '',
  startMs: 0,
  endMs: 0,
  durationMs: 0,
  hasMap: false,
  hasFrames: false,
  hasTasks: false,
  hasErrorDefinitions: false,
  errorLogCount: 0,
  warningLogCount: 0,
  robotName: '',
  version: '',
  branch: '',
  mapName: '',
  frameCount: 0,
  taskCount: 0,
  errorCodeCount: 0,
  errorCount: 0,
  warningCount: 0,
  topIssues: [],
  mapMatch: {
    matchStrategy: 'missing',
    confidence: 0,
    warnings: []
  },
  rootCauses: [],
  dataWarnings: [],
  healthScore: 0,
  logQualityScore: 0,
  recommendedFocusTimes: [],
  parseStats: {
    loadMs: 0,
    parseMs: 0,
    mapLoadMs: 0,
    totalMs: 0,
    cacheHit: false,
    source: ''
  }
}

export class ReplaySession {
  data: ReplaySessionData = {
    overview: EMPTY_OVERVIEW,
    map: { name: '', data: null },
    frames: [],
    events: [],
    errorDefinitions: [],
    errorOccurrences: [],
    errorSummaries: [],
    tasks: [],
    foldedLogs: [],
    rawLines: [],
    bookmarks: [],
    caseMeta: {}
  }

  control: ReplayControlState = {
    playing: false,
    speed: 1,
    currentMs: 0,
    currentFrameIndex: 0,
    mode: 'realtime'
  }

  async load(input: { logDir: string; mapDir?: string; mapFile?: string; forceReload?: boolean }): Promise<ReplaySessionData> {
    const loadStart = Date.now()
    await cleanupReplayCache()
    const files = await findLogFiles(input.logDir)
    const cacheKey = await buildCacheKey({ files, mapDir: input.mapDir, mapFile: input.mapFile })
    if (!input.forceReload) {
      const cached = await readSessionCache(cacheKey)
      if (cached) {
        this.data = cached
        this.control.currentMs = cached.frames[0]?.timeMs || cached.rawLines[0]?.timeMs || 0
        this.control.currentFrameIndex = 0
        this.control.playing = false
        this.data.overview.parseStats = {
          loadMs: 0,
          parseMs: 0,
          mapLoadMs: 0,
          totalMs: Date.now() - loadStart,
          cacheHit: true,
          source: 'session_cache'
        }
        return this.data
      }
    }
    const parseStart = Date.now()
    const indexed = await readLogFilesWithIndex(files)
    const rawLines = indexed.rawLines
    const definitions = new Map<string, ErrorCodeDefinition>()
    const frames: ReplayFrame[] = []
    let currentTaskId = ''
    let robotName = ''
    let version = ''
    let branch = ''

    for (const def of indexed.definitions) definitions.set(def.code, def)
    for (const line of rawLines) {
      const def = parseErrorDefinition(line)
      if (def && shouldReplaceDefinition(definitions.get(def.code), def)) definitions.set(def.code, def)
      const flt = parseFltStatus(line)
      const info = parseInfoStatus(line)
      const frame = flt || info
      if (frame) {
        if (frame.currentTaskId) currentTaskId = frame.currentTaskId
        if (frame.name) robotName = frame.name
        frames.push(frame)
      }
      if (line.message.includes('compile data:')) {
        version = line.message
        const branchMatch = line.message.match(/\[branch\]:\s*(.*)$/)
        branch = branchMatch ? branchMatch[1] : ''
      }
    }

    const sourceDefinitions = await loadSourceErrorDictionary()
    for (const [code, def] of sourceDefinitions) {
      if (shouldReplaceDefinition(definitions.get(code), def)) definitions.set(code, def)
    }

    const mergedFrames = mergeFrames(frames)
    const occurrences: ErrorOccurrence[] = [...indexed.occurrences]
    for (const line of rawLines) {
      occurrences.push(...parseErrorOccurrences(line, definitions, currentTaskId))
    }
    for (const frame of mergedFrames) {
      if (frame.errors) {
        occurrences.push(...parseErrorOccurrences(frame.rawLine, definitions, frame.currentTaskId))
      }
    }
    let events = withContext(buildTimelineEvents(rawLines, mergedFrames, occurrences), rawLines)
    let tasks = buildTaskSegments(mergedFrames, rawLines, events)
    assignOccurrenceTaskIds(occurrences, tasks)
    events = withContext(buildTimelineEvents(rawLines, mergedFrames, occurrences), rawLines)
    tasks = buildTaskSegments(mergedFrames, rawLines, events)
    const mapStart = Date.now()
    const map = await loadMap(input.mapDir, input.mapFile, rawLines, mergedFrames, robotName)
    const mapLoadMs = Date.now() - mapStart
    const rootCauses = buildRootCauses({
      events,
      frames: mergedFrames,
      occurrences,
      tasks,
      rawLines,
      mapMatch: map.match
    })
    const errorSummaries = buildErrorSummaries(occurrences)
    const overview = buildOverview({
      input,
      files,
      rawLines,
      frames: mergedFrames,
      definitions,
      occurrences,
      events,
      tasks,
      map,
      robotName,
      version,
      branch,
      rootCauses
    })
    overview.parseStats = {
      loadMs: parseStart - loadStart,
      parseMs: mapStart - parseStart,
      mapLoadMs,
      totalMs: Date.now() - loadStart,
      cacheHit: false,
      source: indexed.cacheHits > 0 ? `log_index:${indexed.cacheHits}/${files.length}` : 'full_parse'
    }
    this.data = {
      overview,
      map,
      frames: mergedFrames,
      events,
      errorDefinitions: Array.from(definitions.values()),
      errorOccurrences: occurrences,
      errorSummaries,
      tasks,
      foldedLogs: foldNoise(rawLines),
      rawLines,
      bookmarks: await readBookmarks(),
      caseMeta: await readCaseMeta()
    }
    this.control.currentMs = mergedFrames[0]?.timeMs || rawLines[0]?.timeMs || 0
    this.control.currentFrameIndex = 0
    this.control.playing = false
    await writeSessionCache(cacheKey, this.data)
    return this.data
  }

  getCurrentFrame(): ReplayFrame | null {
    if (this.control.mode === 'frame_compact') return this.getCurrentFrameByIndex()
    const frames = this.data.frames
    if (frames.length === 0) return null
    let lo = 0
    let hi = frames.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (frames[mid].timeMs <= this.control.currentMs) lo = mid
      else hi = mid - 1
    }
    return frames[lo]
  }

  getCurrentFrameByIndex(): ReplayFrame | null {
    const frames = this.data.frames
    if (frames.length === 0) return null
    const index = Math.max(0, Math.min(frames.length - 1, Math.floor(this.control.currentFrameIndex || 0)))
    const frame = frames[index]
    this.control.currentFrameIndex = index
    this.control.currentMs = frame.timeMs
    return frame
  }

  seekByTime(timeMs: number): ReplayFrame | null {
    this.control.currentMs = timeMs
    const frame = this.getFrameAtTime(timeMs)
    if (frame) this.control.currentFrameIndex = this.data.frames.indexOf(frame)
    return frame
  }

  seekByFrameIndex(frameIndex: number): ReplayFrame | null {
    this.control.currentFrameIndex = Math.max(0, Math.min(this.data.frames.length - 1, Math.floor(frameIndex)))
    return this.getCurrentFrameByIndex()
  }

  private getFrameAtTime(timeMs: number): ReplayFrame | null {
    const mode = this.control.mode
    this.control.mode = 'realtime'
    const frame = this.getCurrentFrame()
    this.control.mode = mode
    return frame
  }
}

async function findLogFiles(logDir: string): Promise<string[]> {
  const entries = await fs.readdir(logDir, { withFileTypes: true })
  return entries
    .filter((it) => it.isFile() && it.name.endsWith('.log'))
    .map((it) => path.join(logDir, it.name))
    .sort()
}

async function readLogFiles(files: string[]): Promise<ParsedLogLine[]> {
  const parsed: ParsedLogLine[] = []
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8')
    const rows = text.split(/\r?\n/)
    for (let i = 0; i < rows.length; i++) {
      const line = parseLogLine(rows[i], file, i + 1)
      if (line) parsed.push(line)
    }
  }
  return parsed.sort(sortLogLines)
}

async function readLogFilesWithIndex(files: string[]): Promise<{
  rawLines: ParsedLogLine[]
  frames: ReplayFrame[]
  definitions: ErrorCodeDefinition[]
  occurrences: ErrorOccurrence[]
  cacheHits: number
}> {
  const rawLines: ParsedLogLine[] = []
  const frames: ReplayFrame[] = []
  const definitions: ErrorCodeDefinition[] = []
  const occurrences: ErrorOccurrence[] = []
  let cacheHits = 0
  for (const file of files) {
    const cached = await readLogIndex(file)
    if (cached) {
      cacheHits += 1
      appendAll(rawLines, cached.rawLines)
      appendAll(frames, cached.frames)
      appendAll(definitions, cached.definitions)
      appendAll(occurrences, cached.occurrences)
      continue
    }
    const fileLines: ParsedLogLine[] = []
    const fileFrames: ReplayFrame[] = []
    const fileDefinitions: ErrorCodeDefinition[] = []
    const text = await fs.readFile(file, 'utf8')
    const rows = text.split(/\r?\n/)
    const definitionMap = new Map<string, ErrorCodeDefinition>()
    for (let i = 0; i < rows.length; i++) {
      const line = parseLogLine(rows[i], file, i + 1)
      if (!line) continue
      fileLines.push(line)
      const def = parseErrorDefinition(line)
      if (def) {
        definitionMap.set(def.code, def)
        fileDefinitions.push(def)
      }
      const frame = parseFltStatus(line) || parseInfoStatus(line)
      if (frame) fileFrames.push(frame)
    }
    appendAll(rawLines, fileLines)
    appendAll(frames, fileFrames)
    appendAll(definitions, fileDefinitions)
    await writeLogIndex({
      fingerprint: await fileFingerprint(file),
      file,
      rawLines: fileLines,
      frames: fileFrames,
      definitions: fileDefinitions,
      occurrences: []
    }).catch(() => undefined)
  }
  return {
    rawLines: rawLines.sort(sortLogLines),
    frames,
    definitions,
    occurrences,
    cacheHits
  }
}

function appendAll<T>(target: T[], items: T[]) {
  for (const item of items) target.push(item)
}

async function loadMap(
  mapDir: string | undefined,
  mapFile: string | undefined,
  rawLines: ParsedLogLine[],
  frames: ReplayFrame[],
  robotName: string
): Promise<{ name: string; data: unknown; match: MapMatchInfo }> {
  const detectedMapName = detectMapName(rawLines, frames)
  const candidates = await findMapCandidates(mapDir)
  const aliases = await readMapAliases()
  const selected = selectMap({ mapFile, detectedMapName, candidates, aliases, robotName })
  if (!selected.file) {
    return {
      name: '',
      data: null,
      match: selected.match
    }
  }
  try {
    const text = await fs.readFile(selected.file, 'utf8')
    return {
      name: path.basename(selected.file),
      data: JSON.parse(text),
      match: {
        ...selected.match,
        selectedMapFile: selected.file
      }
    }
  } catch {
    return {
      name: '',
      data: null,
      match: {
        ...selected.match,
        selectedMapFile: selected.file,
        matchStrategy: 'missing',
        confidence: 0,
        warnings: [...selected.match.warnings, `地图文件读取失败: ${selected.file}`]
      }
    }
  }
}

function detectMapName(rawLines: ParsedLogLine[], frames: ReplayFrame[]): string {
  const patterns = [
    /MapUmcl:\s*load map\s+\S+\/([A-Za-z0-9_.-]+\.json)/i,
    /UpdateParamsConfig:\s*map\b.*"name"\s*:\s*"([A-Za-z0-9_.-]+\.json)"/i,
    /map[_ -]?name["':=\s]+([A-Za-z0-9_.-]+\.json)/i,
    /load(?:ed)? map[^A-Za-z0-9_.-]+([A-Za-z0-9_.-]+\.json)/i
  ]
  for (const line of rawLines) {
    if (!/map|地图/i.test(line.message)) continue
    for (const pattern of patterns) {
      const match = line.message.match(pattern)
      if (match?.[1]) return path.basename(match[1])
    }
  }
  const namedFrame = frames.find((frame) => frame.name && frame.name.endsWith('.json'))
  return namedFrame?.name || ''
}

async function findMapCandidates(mapDir?: string): Promise<string[]> {
  if (!mapDir) return []
  const entries = await fs.readdir(mapDir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(mapDir, entry.name))
    .sort()
}

function selectMap(arg: {
  mapFile?: string
  detectedMapName: string
  candidates: string[]
  aliases: Awaited<ReturnType<typeof readMapAliases>>
  robotName: string
}): { file: string; match: MapMatchInfo } | { file: ''; match: MapMatchInfo } {
  const warnings: string[] = []
  if (arg.mapFile) {
    return {
      file: arg.mapFile,
      match: {
        requestedMapFile: arg.mapFile,
        detectedMapName: arg.detectedMapName || undefined,
        selectedMapFile: arg.mapFile,
        matchStrategy: 'manual',
        confidence: 1,
        warnings
      }
    }
  }
  const detected = normalizeMapName(arg.detectedMapName)
  if (detected) {
    const alias = matchMapAlias({
      aliases: arg.aliases,
      detectedMapName: arg.detectedMapName,
      robotName: arg.robotName,
      candidates: arg.candidates
    })
    if (alias) {
      return {
        file: alias.selectedMapFile,
        match: {
          detectedMapName: arg.detectedMapName,
          selectedMapFile: alias.selectedMapFile,
          matchStrategy: 'alias',
          confidence: 0.98,
          warnings,
          aliasMatched: true,
          aliasSource: alias.id
        }
      }
    }
    const exact = arg.candidates.find((file) => normalizeMapName(path.basename(file)) === detected)
    if (exact) {
      return {
        file: exact,
        match: {
          detectedMapName: arg.detectedMapName,
          selectedMapFile: exact,
          matchStrategy: 'detected_exact',
          confidence: 0.95,
          warnings
        }
      }
    }
    const contains = arg.candidates.find((file) => {
      const name = normalizeMapName(path.basename(file))
      return name.includes(detected) || detected.includes(name)
    })
    if (contains) {
      return {
        file: contains,
        match: {
          detectedMapName: arg.detectedMapName,
          selectedMapFile: contains,
          matchStrategy: 'detected_contains',
          confidence: 0.75,
          warnings: [`未找到完全同名地图，使用近似匹配: ${path.basename(contains)}`]
        }
      }
    }
    warnings.push(`日志中疑似地图 ${arg.detectedMapName}，但地图目录未找到匹配文件`)
  }
  if (arg.candidates[0]) {
    return {
      file: arg.candidates[0],
      match: {
        detectedMapName: arg.detectedMapName || undefined,
        selectedMapFile: arg.candidates[0],
        matchStrategy: 'fallback_first_json',
        confidence: 0.45,
        warnings: [...warnings, `未能精确匹配地图，回退使用第一个 JSON: ${path.basename(arg.candidates[0])}`]
      }
    }
  }
  return {
    file: '',
    match: {
      detectedMapName: arg.detectedMapName || undefined,
      matchStrategy: 'missing',
      confidence: 0,
      warnings: [...warnings, '未找到可用地图文件']
    }
  }
}

function normalizeMapName(name: string): string {
  return path.basename(name || '').replace(/\.json$/i, '').toLowerCase()
}

function buildOverview(arg: {
  input: { logDir: string }
  files: string[]
  rawLines: ParsedLogLine[]
  frames: ReplayFrame[]
  definitions: Map<string, ErrorCodeDefinition>
  occurrences: ErrorOccurrence[]
  events: ReturnType<typeof buildTimelineEvents>
  tasks: ReturnType<typeof buildTaskSegments>
  map: { name: string; data: unknown; match: MapMatchInfo }
  robotName: string
  version: string
  branch: string
  rootCauses: ReturnType<typeof buildRootCauses>
}): OverviewSummary {
  const start = arg.rawLines[0]
  const end = arg.rawLines[arg.rawLines.length - 1]
  const errors = arg.events.filter((it) => it.level === 'error')
  const warnings = arg.events.filter((it) => it.level === 'warning')
  const dataWarnings = [...arg.map.match.warnings]
  if (arg.frames.length > 0 && arg.tasks.length === 0) {
    dataWarnings.push('日志中未发现有效 current_task_id，任务视角需要使用包含真实任务 ID 的日志继续验证')
  }
  const recommendedFocusTimes = [...errors, ...warnings].slice(0, 8).map((event) => ({
    timeMs: event.timeMs,
    timestamp: event.timestamp,
    title: event.title,
    reason: event.detail,
    level: event.level
  }))
  const healthScore = scoreBooleans([
    !!arg.map.data,
    arg.frames.length > 0,
    arg.definitions.size > 0,
    arg.map.match.confidence >= 0.8,
    arg.rawLines.length > 0
  ])
  const logQualityScore = scoreBooleans([
    arg.rawLines.length > 0,
    arg.rawLines.some((it) => it.level === 'E' || it.level === 'W'),
    arg.frames.length > 0,
    arg.tasks.length > 0,
    arg.occurrences.length > 0
  ])
  return {
    loaded: true,
    logDir: arg.input.logDir,
    logFiles: arg.files,
    mapPath: arg.map.name,
    files: arg.files.length,
    lines: arg.rawLines.length,
    startTime: start?.timestamp || '',
    endTime: end?.timestamp || '',
    startMs: start?.timeMs || 0,
    endMs: end?.timeMs || 0,
    durationMs: start && end ? Math.max(0, end.timeMs - start.timeMs) : 0,
    hasMap: !!arg.map.data,
    hasFrames: arg.frames.length > 0,
    hasTasks: arg.tasks.length > 0,
    hasErrorDefinitions: arg.definitions.size > 0,
    errorLogCount: arg.rawLines.filter((it) => it.level === 'E').length,
    warningLogCount: arg.rawLines.filter((it) => it.level === 'W').length,
    robotName: arg.robotName || arg.frames.find((it) => it.name)?.name || '',
    version: arg.version,
    branch: arg.branch,
    mapName: arg.map.name,
    frameCount: arg.frames.length,
    taskCount: arg.tasks.length,
    errorCodeCount: arg.definitions.size,
    errorCount: errors.length,
    warningCount: warnings.length,
    topIssues: [...errors, ...warnings].slice(0, 20),
    mapMatch: arg.map.match,
    rootCauses: arg.rootCauses,
    dataWarnings,
    healthScore,
    logQualityScore,
    recommendedFocusTimes,
    parseStats: {
      loadMs: 0,
      parseMs: 0,
      mapLoadMs: 0,
      totalMs: 0,
      cacheHit: false,
      source: 'pending'
    }
  }
}

function scoreBooleans(items: boolean[]): number {
  if (items.length === 0) return 0
  return Math.round((items.filter(Boolean).length / items.length) * 100)
}

function withContext<T extends { line?: ParsedLogLine; contextBefore?: ParsedLogLine[]; contextAfter?: ParsedLogLine[] }>(
  events: T[],
  lines: ParsedLogLine[]
): T[] {
  const byKey = new Map<string, number>()
  lines.forEach((line, index) => byKey.set(`${line.file}:${line.line}`, index))
  for (const event of events) {
    if (!event.line) continue
    const idx = byKey.get(`${event.line.file}:${event.line.line}`)
    if (idx === undefined) continue
    event.contextBefore = lines.slice(Math.max(0, idx - 20), idx)
    event.contextAfter = lines.slice(idx + 1, Math.min(lines.length, idx + 21))
  }
  return events
}

function buildErrorSummaries(occurrences: ErrorOccurrence[]): ErrorCodeSummary[] {
  const groups = new Map<string, ErrorCodeSummary>()
  for (const occurrence of occurrences) {
    const def = occurrence.definition
    let summary = groups.get(occurrence.code)
    if (!summary) {
      summary = {
        code: occurrence.code,
        description: def?.description,
        screenText: def?.screenText,
        level: def?.level,
        count: 0,
        realCount: 0,
        configNoticeCount: 0,
        firstTime: occurrence.timestamp,
        lastTime: occurrence.timestamp,
        firstMs: occurrence.timeMs,
        lastMs: occurrence.timeMs,
        modules: [],
        taskIds: [],
        occurrences: []
      }
      groups.set(occurrence.code, summary)
    }
    summary.count += 1
    if (occurrence.kind === 'real_fault') summary.realCount += 1
    if (occurrence.kind === 'config_notice') summary.configNoticeCount += 1
    summary.occurrences.push(occurrence)
    if (occurrence.timeMs < summary.firstMs) {
      summary.firstMs = occurrence.timeMs
      summary.firstTime = occurrence.timestamp
    }
    if (occurrence.timeMs > summary.lastMs) {
      summary.lastMs = occurrence.timeMs
      summary.lastTime = occurrence.timestamp
    }
    if (occurrence.line.module && !summary.modules.includes(occurrence.line.module)) {
      summary.modules.push(occurrence.line.module)
    }
    if (occurrence.taskId && !summary.taskIds.includes(occurrence.taskId)) {
      summary.taskIds.push(occurrence.taskId)
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (b.realCount !== a.realCount) return b.realCount - a.realCount
    return b.count - a.count
  })
}

function assignOccurrenceTaskIds(occurrences: ErrorOccurrence[], tasks: ReturnType<typeof buildTaskSegments>) {
  if (tasks.length === 0) return
  for (const occurrence of occurrences) {
    if (occurrence.taskId && occurrence.taskId !== 'Null' && occurrence.taskId !== 'null') continue
    const task = tasks.find((it) => occurrence.timeMs >= it.startMs && occurrence.timeMs <= it.endMs)
    if (task) occurrence.taskId = task.id
  }
}
