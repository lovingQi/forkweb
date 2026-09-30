import type { IndexedLogLine, LogLineRef, RawLineReader, ReplayFrame, TaskSegment, TimelineEvent } from '../types'

export async function buildTaskSegments(
  frames: ReplayFrame[],
  rawStore: RawLineReader,
  events: TimelineEvent[] = []
): Promise<TaskSegment[]> {
  const tasks: TaskSegment[] = []
  let current: TaskSegment | null = null
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index]
    const taskId = normalizeTaskId(frame.currentTaskId)
    if (!taskId) {
      if (current) {
        current.endMs = frame.timeMs
        current.endTime = frame.timestamp
        current = null
      }
      continue
    }
    if (!current || current.id !== taskId) {
      current = {
        id: taskId,
        startMs: frame.timeMs,
        endMs: frame.timeMs,
        startTime: frame.timestamp,
        endTime: frame.timestamp,
        status: frame.status,
        errors: [],
        startEvidence: frame.rawLine,
        trajectoryFrameRange: [index, index],
        frames: 0
      }
      tasks.push(current)
    }
    current.endMs = frame.timeMs
    current.endTime = frame.timestamp
    current.endEvidence = frame.rawLine
    current.trajectoryFrameRange = [current.trajectoryFrameRange?.[0] ?? index, index]
    current.status = frame.status || current.status
    current.lastFinishedTaskId = frame.lastFinishedTaskId || current.lastFinishedTaskId
    current.lastFinishedTaskSuccess = frame.lastFinishedTaskSuccess ?? current.lastFinishedTaskSuccess
    current.unfinishedPath = frame.unfinishedPath ?? current.unfinishedPath
    current.newUnfinishedPath = frame.newUnfinishedPath ?? current.newUnfinishedPath
    current.frames += 1
    if (frame.errors) {
      for (const code of frame.errors.matchAll(/ERROR\d{4}/g)) {
        if (!current.errors.includes(code[0])) current.errors.push(code[0])
      }
    }
  }
  await enrichTasks(tasks, frames, rawStore, events)
  return tasks
}

const TASK_LINE_PATTERN = /current_routes|current_task_error_code|unfinished_path|new_unfinished_path|last_finished_task|FltTask/i

function normalizeTaskId(taskId?: string): string {
  if (!taskId || taskId === 'Null' || taskId === 'null') return ''
  return taskId
}

function toRef(line: IndexedLogLine): LogLineRef {
  return {
    globalIndex: line.globalIndex,
    timeMs: line.timeMs,
    timestamp: line.timestamp,
    file: line.file,
    line: line.line,
    module: line.module
  }
}

async function enrichTasks(tasks: TaskSegment[], frames: ReplayFrame[], rawStore: RawLineReader, events: TimelineEvent[]) {
  const buckets: IndexedLogLine[][] = tasks.map(() => [])
  const ordered = tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => a.task.startMs - b.task.startMs || a.index - b.index)
  let pointer = 0
  for await (const line of rawStore.streamMatchingLines((row) => TASK_LINE_PATTERN.test(row))) {
    if (!TASK_LINE_PATTERN.test(line.message)) continue
    while (pointer < ordered.length && ordered[pointer].task.endMs < line.timeMs) pointer++
    for (let i = pointer; i < ordered.length; i++) {
      const task = ordered[i].task
      if (task.startMs > line.timeMs) break
      if (line.timeMs <= task.endMs) buckets[ordered[i].index].push(line)
    }
  }

  const segmentsById = new Map<string, TaskSegment[]>()
  for (const task of tasks) {
    const segments = segmentsById.get(task.id) || []
    segments.push(task)
    segmentsById.set(task.id, segments)
  }
  const failureSignalByTask = new Map<TaskSegment, LogLineRef>()
  for (const frame of frames) {
    if (frame.lastFinishedTaskSuccess !== false || !frame.rawLine) continue
    const finishedTaskId = normalizeTaskId(frame.lastFinishedTaskId)
    if (!finishedTaskId) continue
    const segments = segmentsById.get(finishedTaskId)
    if (!segments) continue
    let chosen: TaskSegment | null = null
    for (const segment of segments) {
      if (segment.endMs <= frame.timeMs && (!chosen || segment.endMs >= chosen.endMs)) chosen = segment
    }
    if (chosen && !failureSignalByTask.has(chosen)) failureSignalByTask.set(chosen, frame.rawLine)
  }

  for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
    const task = tasks[taskIndex]
    const relatedLines = buckets[taskIndex]
    task.relatedEvents = events.filter((event) => {
      if (event.taskId && event.taskId === task.id) return true
      return event.timeMs >= task.startMs && event.timeMs <= task.endMs && ['error_code', 'task'].includes(event.category || '')
    })
    for (const event of task.relatedEvents) {
      if (event.code && !task.errors.includes(event.code)) task.errors.push(event.code)
    }
    const routeLine = relatedLines.find((line) => /current_routes/i.test(line.message))
    if (routeLine) task.routeSummary = summarizeRoute(routeLine.message)
    for (const line of relatedLines) {
      for (const code of line.message.matchAll(/ERROR\d{4}/g)) {
        if (!task.errors.includes(code[0])) task.errors.push(code[0])
      }
    }

    task.failureReasonCandidates = []
    const failureSignal = failureSignalByTask.get(task)
    if (failureSignal) {
      task.lastFinishedTaskSuccess = false
      task.failureReasonCandidates.push('last_finished_task_is_success=false')
    }
    if (relatedLines.some((line) => /current_task_error_code.*ERROR\d{4}/i.test(line.message))) {
      task.failureReasonCandidates.push('current_task_error_code')
    }

    const candidates: Array<{ timeMs: number; globalIndex: number; ref: LogLineRef }> = []
    for (const event of task.relatedEvents) {
      if (event.type === 'error_code' && event.level === 'error' && event.line) {
        candidates.push({ timeMs: event.timeMs, globalIndex: event.line.globalIndex, ref: event.line })
      }
    }
    for (const line of relatedLines) {
      if (/ERROR\d{4}/.test(line.message)) candidates.push({ timeMs: line.timeMs, globalIndex: line.globalIndex, ref: toRef(line) })
    }
    if (failureSignal) candidates.push({ timeMs: failureSignal.timeMs, globalIndex: failureSignal.globalIndex, ref: failureSignal })
    if (candidates.length === 0) continue
    candidates.sort((a, b) => a.timeMs - b.timeMs || a.globalIndex - b.globalIndex)
    const failureLine = candidates[0].ref
    task.failureLine = failureLine
    if (failureLine.globalIndex < 0) {
      task.beforeFailureLines = []
      task.afterFailureLines = []
      task.failureContextCount = 1
      continue
    }
    const before = await rawStore.readSlice(failureLine.globalIndex - 20, failureLine.globalIndex)
    const after = await rawStore.readSlice(failureLine.globalIndex + 1, failureLine.globalIndex + 21)
    task.beforeFailureLines = before.map(toRef)
    task.afterFailureLines = after.map(toRef)
    task.failureContextCount = before.length + 1 + after.length
  }
}

function summarizeRoute(message: string): string {
  const currentRoutesIndex = message.search(/current_routes/i)
  const text = currentRoutesIndex >= 0 ? message.slice(currentRoutesIndex) : message
  const routeIds = Array.from(text.matchAll(/(?:route|path|id|task_id)["':=\s]+([A-Za-z0-9_.-]+)/gi))
    .map((match) => match[1])
    .filter(Boolean)
  const uniqueRouteIds = Array.from(new Set(routeIds)).slice(0, 8)
  if (uniqueRouteIds.length) return `routes: ${uniqueRouteIds.join(', ')}`
  return text.length > 180 ? `${text.slice(0, 180)}...` : text
}
