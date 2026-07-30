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
  await enrichTasks(tasks, rawStore, events)
  return tasks
}

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

async function enrichTasks(tasks: TaskSegment[], rawStore: RawLineReader, events: TimelineEvent[]) {
  for (const task of tasks) {
    task.relatedEvents = events.filter((event) => {
      if (event.taskId && event.taskId === task.id) return true
      return event.timeMs >= task.startMs && event.timeMs <= task.endMs && ['error_code', 'task'].includes(event.category || '')
    })
    for (const event of task.relatedEvents) {
      if (event.code && !task.errors.includes(event.code)) task.errors.push(event.code)
    }
    const relatedLines = await rawStore.readRange(task.startMs, task.endMs)
    task.failureReasonCandidates = []
    if (relatedLines.some((line) => /last_finished_task_is_success["':=\s]+false/i.test(line.message))) {
      task.lastFinishedTaskSuccess = false
      task.failureReasonCandidates.push('last_finished_task_is_success=false')
    }
    if (relatedLines.some((line) => /current_task_error_code.*ERROR\d{4}/i.test(line.message))) {
      task.failureReasonCandidates.push('current_task_error_code')
    }
    if (relatedLines.some((line) => /unfinished_path|new_unfinished_path/i.test(line.message))) {
      task.failureReasonCandidates.push('unfinished_path')
    }
    const routeLine = relatedLines.find((line) => /current_routes/i.test(line.message))
    if (routeLine) {
      task.routeSummary = summarizeRoute(routeLine.message)
    }
    for (const line of relatedLines) {
      for (const code of line.message.matchAll(/ERROR\d{4}/g)) {
        if (!task.errors.includes(code[0])) task.errors.push(code[0])
      }
    }
    const failureLine = relatedLines.find((line) => /ERROR\d{4}|false|unfinished_path/i.test(line.message))
    if (failureLine) {
      const context = await rawStore.readAroundTime(failureLine.timeMs, 41)
      const idx = context.findIndex((l) => l.file === failureLine.file && l.line === failureLine.line)
      task.failureLine = toRef(failureLine)
      task.beforeFailureLines = context.slice(Math.max(0, idx - 20), idx).map(toRef)
      task.afterFailureLines = context.slice(idx + 1, idx + 21).map(toRef)
      task.failureContextCount = (task.beforeFailureLines?.length || 0) + 1 + (task.afterFailureLines?.length || 0)
    }
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
