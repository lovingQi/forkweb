import fs from 'fs/promises'
import path from 'path'
import type {
  ErrorCodeDefinition,
  ErrorOccurrence,
  OverviewSummary,
  ParsedLogLine,
  ReplayControlState,
  ReplayFrame,
  ReplaySessionData
} from '../types'
import { parseErrorDefinition, parseErrorOccurrences } from '../parser/errorCode'
import { parseFltStatus } from '../parser/fltStatus'
import { parseInfoStatus } from '../parser/infoStatus'
import { parseLogLine, sortLogLines } from '../parser/logLine'
import { buildTaskSegments } from '../parser/task'
import { foldNoise } from './noise'
import { buildTimelineEvents, mergeFrames } from './timeline'

const EMPTY_OVERVIEW: OverviewSummary = {
  loaded: false,
  logDir: '',
  mapPath: '',
  files: 0,
  lines: 0,
  startTime: '',
  endTime: '',
  robotName: '',
  version: '',
  branch: '',
  mapName: '',
  frameCount: 0,
  taskCount: 0,
  errorCodeCount: 0,
  errorCount: 0,
  warningCount: 0,
  topIssues: []
}

export class ReplaySession {
  data: ReplaySessionData = {
    overview: EMPTY_OVERVIEW,
    map: { name: '', data: null },
    frames: [],
    events: [],
    errorDefinitions: [],
    errorOccurrences: [],
    tasks: [],
    foldedLogs: [],
    rawLines: []
  }

  control: ReplayControlState = {
    playing: false,
    speed: 1,
    currentMs: 0
  }

  async load(input: { logDir: string; mapDir?: string; mapFile?: string }): Promise<ReplaySessionData> {
    const files = await findLogFiles(input.logDir)
    const rawLines = await readLogFiles(files)
    const definitions = new Map<string, ErrorCodeDefinition>()
    const frames: ReplayFrame[] = []
    let currentTaskId = ''
    let robotName = ''
    let version = ''
    let branch = ''

    for (const line of rawLines) {
      const def = parseErrorDefinition(line)
      if (def) definitions.set(def.code, def)
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

    const mergedFrames = mergeFrames(frames)
    const occurrences: ErrorOccurrence[] = []
    for (const line of rawLines) {
      occurrences.push(...parseErrorOccurrences(line, definitions, currentTaskId))
    }
    for (const frame of mergedFrames) {
      if (frame.errors) {
        occurrences.push(...parseErrorOccurrences(frame.rawLine, definitions, frame.currentTaskId))
      }
    }
    const tasks = buildTaskSegments(mergedFrames)
    const events = buildTimelineEvents(rawLines, mergedFrames, occurrences)
    const map = await loadMap(input.mapDir, input.mapFile)
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
      branch
    })
    this.data = {
      overview,
      map,
      frames: mergedFrames,
      events,
      errorDefinitions: Array.from(definitions.values()),
      errorOccurrences: occurrences,
      tasks,
      foldedLogs: foldNoise(rawLines),
      rawLines
    }
    this.control.currentMs = mergedFrames[0]?.timeMs || rawLines[0]?.timeMs || 0
    this.control.playing = false
    return this.data
  }

  getCurrentFrame(): ReplayFrame | null {
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

async function loadMap(mapDir?: string, mapFile?: string): Promise<{ name: string; data: unknown }> {
  const candidates: string[] = []
  if (mapFile) candidates.push(mapFile)
  if (mapDir) {
    const entries = await fs.readdir(mapDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) candidates.push(path.join(mapDir, entry.name))
    }
  }
  for (const file of candidates) {
    try {
      const text = await fs.readFile(file, 'utf8')
      return { name: path.basename(file), data: JSON.parse(text) }
    } catch {
      continue
    }
  }
  return { name: '', data: null }
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
  map: { name: string; data: unknown }
  robotName: string
  version: string
  branch: string
}): OverviewSummary {
  const start = arg.rawLines[0]
  const end = arg.rawLines[arg.rawLines.length - 1]
  const errors = arg.events.filter((it) => it.level === 'error')
  const warnings = arg.events.filter((it) => it.level === 'warning')
  return {
    loaded: true,
    logDir: arg.input.logDir,
    mapPath: arg.map.name,
    files: arg.files.length,
    lines: arg.rawLines.length,
    startTime: start?.timestamp || '',
    endTime: end?.timestamp || '',
    robotName: arg.robotName || arg.frames.find((it) => it.name)?.name || '',
    version: arg.version,
    branch: arg.branch,
    mapName: arg.map.name,
    frameCount: arg.frames.length,
    taskCount: arg.tasks.length,
    errorCodeCount: arg.definitions.size,
    errorCount: errors.length,
    warningCount: warnings.length,
    topIssues: [...errors, ...warnings].slice(0, 20)
  }
}
