import type { ReplayFrame, TaskSegment } from '../types'

export function buildTaskSegments(frames: ReplayFrame[]): TaskSegment[] {
  const tasks: TaskSegment[] = []
  let current: TaskSegment | null = null
  for (const frame of frames) {
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
        frames: 0
      }
      tasks.push(current)
    }
    current.endMs = frame.timeMs
    current.endTime = frame.timestamp
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
  return tasks
}

function normalizeTaskId(taskId?: string): string {
  if (!taskId || taskId === 'Null' || taskId === 'null') return ''
  return taskId
}
