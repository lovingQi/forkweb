import type { ParsedLogLine, TimelineEvent } from '../types'

export function buildRuleEvents(lines: ParsedLogLine[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let seq = 0
  for (const line of lines) {
    if (line.level === 'E') {
      events.push(toEvent(line, `log-error-${seq++}`, 'log_error', 'error', `[E] ${line.module}`, line.message))
      continue
    }
    if (line.level === 'W' && isImportantWarning(line.message)) {
      events.push(toEvent(line, `log-warning-${seq++}`, 'log_warning', 'warning', `[W] ${line.module}`, line.message))
    }
    if (line.message.includes('JARVIS-G START')) {
      events.push(toEvent(line, `system-start-${seq++}`, 'system', 'info', '系统启动', line.message))
    }
    if (line.message.includes('connect succeed')) {
      events.push(toEvent(line, `connect-${seq++}`, 'connect', 'info', '设备连接成功', line.message))
    }
  }
  return events
}

function isImportantWarning(message: string): boolean {
  return (
    message.includes('does not exist') ||
    message.includes('failed') ||
    message.includes('outtime') ||
    message.includes('lost') ||
    message.includes('nullptr') ||
    message.includes('configure error')
  )
}

function toEvent(
  line: ParsedLogLine,
  id: string,
  type: string,
  level: 'info' | 'warning' | 'error',
  title: string,
  detail: string
): TimelineEvent {
  return {
    id,
    timestamp: line.timestamp,
    timeMs: line.timeMs,
    type,
    level,
    title,
    detail,
    module: line.module,
    line
  }
}
