import type { ParsedLogLine, TimelineEvent } from '../types'

export function buildRuleEvents(lines: ParsedLogLine[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  let seq = 0
  for (const line of lines) {
    if (line.level === 'E') {
      events.push(toEvent(line, `log-error-${seq++}`, 'log_error', classifyCategory(line.message), 'error', `[E] ${line.module}`, line.message))
      continue
    }
    if (line.level === 'W' && isImportantWarning(line.message)) {
      events.push(toEvent(line, `log-warning-${seq++}`, 'log_warning', classifyCategory(line.message), 'warning', `[W] ${line.module}`, line.message))
    }
    if (line.message.includes('JARVIS-G START')) {
      events.push(toEvent(line, `system-start-${seq++}`, 'system', 'system', 'info', '系统启动', line.message))
    }
    if (line.message.includes('connect succeed')) {
      events.push(toEvent(line, `connect-${seq++}`, 'connect', 'connect', 'info', '设备连接成功', line.message))
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
  category: string,
  level: 'info' | 'warning' | 'error',
  title: string,
  detail: string
): TimelineEvent {
  return {
    id,
    timestamp: line.timestamp,
    timeMs: line.timeMs,
    type,
    category,
    level,
    title,
    detail,
    module: line.module,
    line
  }
}

function classifyCategory(message: string): string {
  if (
    message.includes('does not exist') ||
    message.includes('GetSection') ||
    message.includes('ReadFileToJson') ||
    message.includes('get param')
  ) {
    return 'config'
  }
  if (message.toLowerCase().includes('map')) return 'map'
  if (message.toLowerCase().includes('task')) return 'task'
  return 'log'
}
