import type { LogLevel, ParsedLogLine } from '../types'

const LINE_RE =
  /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(.+?):\s*(\d+)\s+\[([DIWE])\]\s+:\s?(.*)$/

export function parseLogLine(raw: string, file: string, line: number): ParsedLogLine | null {
  const m = raw.match(LINE_RE)
  if (!m) return null
  const timestamp = m[1]
  const module = m[2].trim()
  const sourceLine = Number.parseInt(m[3], 10)
  const level = (m[4] || 'UNKNOWN') as LogLevel
  const message = m[5] || ''
  return {
    file,
    line,
    timestamp,
    timeMs: new Date(timestamp.replace(' ', 'T')).getTime(),
    module,
    sourceLine: Number.isFinite(sourceLine) ? sourceLine : null,
    level,
    message,
    raw
  }
}

export function sortLogLines(a: ParsedLogLine, b: ParsedLogLine): number {
  if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs
  if (a.file !== b.file) return a.file.localeCompare(b.file)
  return a.line - b.line
}
