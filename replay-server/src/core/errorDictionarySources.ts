import type { ErrorCodeDefinition, ErrorDictionarySourceKind } from '../types'

const SOURCE_LABELS: Record<ErrorDictionarySourceKind, string> = {
  manual: '人工字典',
  log_definition: '日志定义',
  source_config: '源码配置',
  source_scan: '源码扫描',
  text_guess: '文本猜测'
}

const SOURCE_PRIORITY: Record<ErrorDictionarySourceKind, number> = {
  manual: 200,
  log_definition: 100,
  source_config: 80,
  source_scan: 50,
  text_guess: 20
}

export function enrichDictionarySource<T extends ErrorCodeDefinition>(
  definition: T,
  sourceKind: ErrorDictionarySourceKind,
  confidenceReason?: string
): T {
  return {
    ...definition,
    sourceKind,
    sourceLabel: SOURCE_LABELS[sourceKind],
    sourcePriority: SOURCE_PRIORITY[sourceKind],
    confidenceReason
  }
}

export function shouldReplaceDefinition(existing: ErrorCodeDefinition | undefined, next: ErrorCodeDefinition): boolean {
  if (!existing) return true
  return (next.sourcePriority || 0) > (existing.sourcePriority || 0)
}
