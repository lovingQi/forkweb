import type { ParsedLogLine, ReplayFrame } from '../types'

export function parseFltStatus(line: ParsedLogLine): ReplayFrame | null {
  const idx = line.message.indexOf('RmstoSendArg:')
  if (idx < 0) return null
  const jsonText = line.message.slice(idx + 'RmstoSendArg:'.length).trim()
  try {
    const data = JSON.parse(jsonText)
    const x = Number(data.x)
    const y = Number(data.y)
    const theta = Number(data.theta)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(theta)) return null
    return {
      timestamp: line.timestamp,
      timeMs: line.timeMs,
      source: 'FltStatus',
      name: data.name,
      x,
      y,
      theta,
      status: data.status,
      battery: numberOrUndefined(data.battery),
      score: numberOrUndefined(data.loc),
      currentTaskId: data.current_task_id,
      lastFinishedTaskId: data.last_finished_task_id,
      lastFinishedTaskSuccess: boolOrUndefined(data.last_finished_task_is_success),
      unfinishedPath: data.unfinished_path,
      newUnfinishedPath: data.new_unfinished_path,
      errors: data.errors,
      forkHeight: numberOrUndefined(data.fork_height),
      loaded: boolOrUndefined(data.loaded),
      estop: boolOrUndefined(data.estop),
      rawLine: line
    }
  } catch {
    return null
  }
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function boolOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}
