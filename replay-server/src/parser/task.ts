import type { ParsedLogLine, ReplayFrame, TaskSegment, TimelineEvent } from '../types'

export function buildTaskSegments(
  frames: ReplayFrame[],
  rawLines: ParsedLogLine[] = [],
  events: TimelineEvent[] = []
): TaskSegment[] {
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
  enrichTasks(tasks, rawLines, events)
  return tasks
}

function normalizeTaskId(taskId?: string): string {
  if (!taskId || taskId === 'Null' || taskId === 'null') return ''
  return taskId
}

function enrichTasks(tasks: TaskSegment[], rawLines: ParsedLogLine[], events: TimelineEvent[]) {
  for (const task of tasks) {
    task.relatedEvents = events.filter((event) => {
      if (event.taskId && event.taskId === task.id) return true
      return event.timeMs >= task.startMs && event.timeMs <= task.endMs && ['error_code', 'task'].includes(event.category || '')
    })
    for (const event of task.relatedEvents) {
      if (event.code && !task.errors.includes(event.code)) task.errors.push(event.code)
    }
    const relatedLines = rawLines.filter((line) => {
      if (line.timeMs < task.startMs || line.timeMs > task.endMs) return false
      return /current_routes|current_task_error_code|unfinished_path|new_unfinished_path|last_finished_task|FltTask/i.test(line.message)
    })
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
    for (const line of relatedLines) {
      for (const code of line.message.matchAll(/ERROR\d{4}/g)) {
        if (!task.errors.includes(code[0])) task.errors.push(code[0])
      }
    }
    const failureLine = relatedLines.find((line) => /ERROR\d{4}|false|unfinished_path/i.test(line.message))
    if (failureLine) {
      const idx = rawLines.indexOf(failureLine)
      task.beforeFailureLines = rawLines.slice(Math.max(0, idx - 20), idx)
      task.afterFailureLines = rawLines.slice(idx + 1, Math.min(rawLines.length, idx + 21))
    }
  }
}
