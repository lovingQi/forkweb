import type { ErrorCodeDefinition, ErrorOccurrence, ErrorOccurrenceKind, ParsedLogLine } from '../types'

const DEF_RE = /error_name,error_str=(ERROR\d{4}),(\{.*\})/
const CODE_RE = /(ERROR\d{4})/g

export function parseErrorDefinition(line: ParsedLogLine): ErrorCodeDefinition | null {
  const m = line.message.match(DEF_RE)
  if (!m) return null
  try {
    const raw = JSON.parse(m[2])
    return {
      code: m[1],
      description: stringOrUndefined(raw.error_description),
      screenText: stringOrUndefined(raw.error_to_screen),
      level: numberOrUndefined(raw.error_level),
      toRms: boolOrUndefined(raw.to_rms),
      toScreen: boolOrUndefined(raw.to_screen),
      toWarn: boolOrUndefined(raw.to_warn),
      raw,
      firstLine: line
    }
  } catch {
    return { code: m[1], firstLine: line }
  }
}

export function parseErrorOccurrences(
  line: ParsedLogLine,
  definitions: Map<string, ErrorCodeDefinition>,
  taskId?: string
): ErrorOccurrence[] {
  const occurrences: ErrorOccurrence[] = []
  const seen = new Set<string>()
  for (const match of line.message.matchAll(CODE_RE)) {
    const code = match[1]
    if (line.message.includes(`error_name,error_str=${code}`)) continue
    if (seen.has(code)) continue
    seen.add(code)
    occurrences.push({
      code,
      timestamp: line.timestamp,
      timeMs: line.timeMs,
      source: classifySource(line.message),
      kind: classifyKind(line.message),
      taskId,
      line,
      definition: definitions.get(code)
    })
  }
  return occurrences
}

function classifySource(message: string): string {
  if (isConfigNotice(message)) return 'config_notice'
  if (message.includes('current_task_error_code')) return 'current_task_error_code'
  if (message.includes('current_code')) return 'current_code'
  if (message.includes('"errors"')) return 'status_errors'
  return 'log_text'
}

function classifyKind(message: string): ErrorOccurrenceKind {
  if (/error_name,error_str=ERROR\d{4}/.test(message)) return 'definition'
  if (isConfigNotice(message)) return 'config_notice'
  if (
    message.includes('current_task_error_code') ||
    message.includes('current_code') ||
    message.includes('"errors"') ||
    message.includes('RmstoSendArg')
  ) {
    return 'real_fault'
  }
  return 'unknown'
}

function isConfigNotice(message: string): boolean {
  return /GrmFault: configure error for device error_code code ERROR\d{4}/.test(message)
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function numberOrUndefined(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function boolOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}
