import type { LogLineRef, ParsedLogLine, ReplaySessionData } from '../types'
import { formatRawLine, RawLogStore } from './rawLogStore'
import { readBookmarks } from './bookmarks'
import { readCaseMeta } from './caseMeta'

export async function buildMarkdownReportAsync(data: ReplaySessionData): Promise<string> {
  return buildMarkdownReport(data, { bookmarks: await readBookmarks(), caseMeta: await readCaseMeta() })
}

export async function buildMarkdownReport(
  data: ReplaySessionData,
  extras: { bookmarks?: any[]; caseMeta?: any; rawStore?: RawLogStore | null } = {}
): Promise<string> {
  const rawStore = extras.rawStore ?? (data.rawLinesPath ? RawLogStore.load(data.rawLinesPath) : null)
  const refMap = rawStore ? await resolveMarkdownRefs(rawStore, data) : new Map<number, ParsedLogLine>()
  const formatRef = (ref?: LogLineRef): string => {
    if (!ref) return ''
    const line = refMap.get(ref.globalIndex)
    return line ? formatRawLine(line) : `[ref:${ref.globalIndex}]`
  }

  const o = data.overview
  const lines = [
    '# 叉车日志诊断报告',
    '',
    '## 概览',
    '',
    `- 日志目录: ${o.logDir || '-'}`,
    `- 地图文件: ${o.mapPath || '-'}`,
    `- 时间范围: ${o.startTime || '-'} ~ ${o.endTime || '-'}`,
    `- 车辆: ${o.robotName || '-'}`,
    `- 版本: ${o.version || '-'}`,
    `- 分支: ${o.branch || '-'}`,
    `- 回放帧: ${o.frameCount}`,
    `- 任务数: ${o.taskCount}`,
    `- 错误码: ${o.errorCodeCount}`,
    `- 错误事件: ${o.errorCount}`,
    `- 关键告警: ${o.warningCount}`,
    `- 地图匹配: ${matchLabel(o.mapMatch.matchStrategy)} ${Math.round(o.mapMatch.confidence * 100)}%`,
    `- 数据完整性评分: ${o.healthScore ?? '-'} / 100`,
    `- 日志质量评分: ${o.logQualityScore ?? '-'} / 100`,
    '',
    '## 人工结论',
    '',
    `- 处理状态: ${extras.caseMeta?.status || '-'}`,
    `- 已确认根因: ${extras.caseMeta?.confirmedRootCause || '-'}`,
    `- 现场人员: ${extras.caseMeta?.operator || '-'}`,
    `- 备注: ${extras.caseMeta?.note || '-'}`,
    '',
    '## 文件索引',
    '',
    `- 日志文件数: ${o.logFiles.length}`,
    ...o.logFiles.map((file) => `- 日志: ${file}`),
    `- 地图: ${o.mapMatch.selectedMapFile || o.mapPath || '-'}`,
    '',
    '## 诊断结论',
    ''
  ]
  if (o.rootCauses.length === 0) {
    lines.push('- 暂无明确根因候选。')
  }
  for (const cause of o.rootCauses) {
    const source = cause.source === 'knowledge_base' ? '知识库' : cause.source === 'llm' ? 'AI' : '内置规则'
    lines.push(`- [${cause.severity}] ${cause.title}，来源 ${source}，置信度 ${Math.round(cause.confidence * 100)}%。${cause.suggestion}`)
    for (const item of cause.triggeredRules || []) lines.push(`  - 触发规则: ${item}`)
    for (const item of cause.positiveEvidence || []) lines.push(`  - 加分证据: ${item}`)
    for (const item of cause.negativeEvidence || []) lines.push(`  - 扣分证据: ${item}`)
    for (const item of cause.confidenceFactors || []) lines.push(`  - 置信度来源: ${item}`)
    for (const event of (cause.evidenceEvents || []).slice(0, 3)) {
      lines.push(`  - 事件证据: ${event.timestamp} ${event.title}: ${event.detail}`)
    }
    for (const ref of (cause.evidenceLines || []).slice(0, 3)) {
      lines.push(`  - 日志证据: ${formatRef(ref)}`)
    }
  }
  lines.push('', '## 知识库命中', '')
  const knowledgeMatches = data.knowledgeMatches || []
  if (knowledgeMatches.length === 0) lines.push('- 暂无知识库命中。')
  for (const match of knowledgeMatches) {
    lines.push(`- ${match.title}: 置信度 ${Math.round(match.confidence * 100)}%，处理办法: ${match.solution || match.suggestion || '-'}`)
    for (const item of match.matchedPatterns.slice(0, 8)) lines.push(`  - 命中: ${item}`)
    for (const ref of match.evidenceLines.slice(0, 5)) lines.push(`  - 证据: ${formatRef(ref)}`)
  }
  lines.push('', '## 地图匹配', '')
  lines.push(`- 策略: ${matchLabel(o.mapMatch.matchStrategy)}`)
  lines.push(`- 检测地图: ${o.mapMatch.detectedMapName || '-'}`)
  lines.push(`- 选择地图: ${o.mapMatch.selectedMapFile || o.mapPath || '-'}`)
  lines.push(`- 置信度: ${Math.round(o.mapMatch.confidence * 100)}%`)
  for (const warning of o.dataWarnings) {
    lines.push(`- 提醒: ${warning}`)
  }
  lines.push('', '## Top 问题', '')
  for (const issue of o.topIssues) {
    lines.push(`- ${issue.timestamp} ${issue.title}: ${issue.detail}`)
  }
  lines.push('', '## 建议优先查看时间点', '')
  for (const focus of o.recommendedFocusTimes || []) {
    lines.push(`- ${focus.timestamp} [${focus.level}] ${focus.title}: ${focus.reason}`)
  }
  lines.push('', '## 人工书签', '')
  if (!(extras.bookmarks || []).length) lines.push('- 暂无人工书签。')
  for (const bookmark of extras.bookmarks || []) {
    lines.push(`- ${bookmark.timestamp} ${bookmark.title}: ${bookmark.note || '-'}`)
  }
  lines.push('', '## 关键时间线摘要', '')
  for (const event of data.events.filter((it) => it.level === 'error' || it.level === 'warning').slice(0, 50)) {
    lines.push(`- ${event.timestamp} [${event.level}] ${event.title}: ${event.detail}`)
  }
  lines.push('', '## 真实故障错误码', '')
  for (const occurrence of data.errorOccurrences.filter((it) => it.kind === 'real_fault').slice(0, 50)) {
    lines.push(`- ${formatErrorOccurrence(occurrence)}`)
  }
  lines.push('', '## 配置提醒错误码', '')
  for (const occurrence of data.errorOccurrences.filter((it) => it.kind === 'config_notice').slice(0, 50)) {
    lines.push(`- ${formatErrorOccurrence(occurrence)}`)
  }
  lines.push('', '## 任务视角', '')
  if (data.tasks.length === 0) {
    lines.push('- 未解析到有效任务段。')
  }
  for (const task of data.tasks) {
    lines.push(
      `- ${task.id}: ${task.startTime} ~ ${task.endTime}, 状态 ${task.status || '-'}, 成功 ${task.lastFinishedTaskSuccess ?? '-'}, 错误 ${task.errors.join(',') || '-'}`
    )
    for (const event of (task.relatedEvents || []).slice(0, 3)) {
      lines.push(`  - ${event.timestamp} ${event.title}: ${event.detail}`)
    }
  }
  return `${lines.join('\n')}\n`
}

export async function buildJsonReport(data: ReplaySessionData): Promise<unknown> {
  const rawStore = data.rawLinesPath ? RawLogStore.load(data.rawLinesPath) : null
  const resolved = rawStore ? await resolveJsonRefs(rawStore, data) : new Map<number, ParsedLogLine>()

  const resolveLine = (ref?: LogLineRef): ParsedLogLine | undefined => {
    if (!ref) return undefined
    return resolved.get(ref.globalIndex)
  }
  const resolveLines = (refs?: LogLineRef[]): ParsedLogLine[] => {
    if (!refs) return []
    return refs.map((ref) => resolved.get(ref.globalIndex)).filter(Boolean) as ParsedLogLine[]
  }
  const resolveEvent = (event: any) => ({
    ...event,
    line: event.line ? resolveLine(event.line) : undefined,
    contextBefore: event.contextBefore ? resolveLines(event.contextBefore) : undefined,
    contextAfter: event.contextAfter ? resolveLines(event.contextAfter) : undefined
  })

  return {
    overview: data.overview,
    diagnosticFiles: {
      logDir: data.overview.logDir,
      logFiles: data.overview.logFiles,
      mapPath: data.overview.mapMatch.selectedMapFile || data.overview.mapPath
    },
    topIssues: data.overview.topIssues,
    mapMatch: data.overview.mapMatch,
    rootCauses: data.overview.rootCauses.map((cause) => ({
      ...cause,
      evidenceEvents: cause.evidenceEvents.map(resolveEvent),
      evidenceLines: resolveLines(cause.evidenceLines)
    })),
    knowledgeMatches: (data.knowledgeMatches || []).map((match) => ({
      ...match,
      evidenceLines: resolveLines(match.evidenceLines)
    })),
    assistant: data.assistant || {},
    similarCases: data.assistant?.similarCases || [],
    parseStats: data.overview.parseStats,
    recommendedFocusTimes: data.overview.recommendedFocusTimes,
    evidenceSnippets: data.overview.rootCauses.map((cause) => ({
      id: cause.id,
      title: cause.title,
      events: cause.evidenceEvents.slice(0, 5).map(resolveEvent),
      lines: resolveLines(cause.evidenceLines.slice(0, 5))
    })),
    dataWarnings: data.overview.dataWarnings,
    errorCodes: data.errorDefinitions,
    errorOccurrences: data.errorOccurrences.map((occ) => ({
      ...occ,
      line: resolveLine(occ.line)
    })),
    realErrorOccurrences: data.errorOccurrences
      .filter((it) => it.kind === 'real_fault')
      .map((occ) => ({ ...occ, line: resolveLine(occ.line) })),
    configNotices: data.errorOccurrences
      .filter((it) => it.kind === 'config_notice')
      .map((occ) => ({ ...occ, line: resolveLine(occ.line) })),
    tasks: data.tasks.map((task) => ({
      ...task,
      startEvidence: resolveLine(task.startEvidence),
      endEvidence: resolveLine(task.endEvidence),
      failureLine: resolveLine(task.failureLine),
      beforeFailureLines: resolveLines(task.beforeFailureLines),
      afterFailureLines: resolveLines(task.afterFailureLines),
      relatedEvents: (task.relatedEvents || []).map(resolveEvent)
    })),
    taskSummary: data.tasks.map((task) => ({
      id: task.id,
      startTime: task.startTime,
      endTime: task.endTime,
      status: task.status,
      success: task.lastFinishedTaskSuccess,
      errors: task.errors,
      failureReasonCandidates: task.failureReasonCandidates
    })),
    keyTimeline: data.events
      .filter((it) => it.level === 'error' || it.level === 'warning')
      .slice(0, 100)
      .map(resolveEvent),
    foldedLogs: data.foldedLogs
  }
}

async function resolveMarkdownRefs(rawStore: RawLogStore, data: ReplaySessionData): Promise<Map<number, ParsedLogLine>> {
  const refs: LogLineRef[] = []
  const add = (ref?: LogLineRef) => { if (ref) refs.push(ref) }
  const addAll = (refsArray?: LogLineRef[]) => { if (refsArray) refs.push(...refsArray) }
  for (const cause of data.overview.rootCauses) addAll(cause.evidenceLines)
  for (const match of data.knowledgeMatches || []) addAll(match.evidenceLines)
  return resolveRefMap(rawStore, refs)
}

async function resolveJsonRefs(rawStore: RawLogStore, data: ReplaySessionData): Promise<Map<number, ParsedLogLine>> {
  const refs: LogLineRef[] = []
  const add = (ref?: LogLineRef) => { if (ref) refs.push(ref) }
  const addAll = (refsArray?: LogLineRef[]) => { if (refsArray) refs.push(...refsArray) }
  for (const event of data.events) {
    add(event.line)
    addAll(event.contextBefore)
    addAll(event.contextAfter)
  }
  for (const cause of data.overview.rootCauses) {
    for (const event of cause.evidenceEvents) {
      add(event.line)
      addAll(event.contextBefore)
      addAll(event.contextAfter)
    }
    addAll(cause.evidenceLines)
  }
  for (const match of data.knowledgeMatches || []) addAll(match.evidenceLines)
  for (const occ of data.errorOccurrences) add(occ.line)
  for (const task of data.tasks) {
    add(task.startEvidence)
    add(task.endEvidence)
    add(task.failureLine)
    addAll(task.beforeFailureLines)
    addAll(task.afterFailureLines)
    for (const event of task.relatedEvents || []) {
      add(event.line)
      addAll(event.contextBefore)
      addAll(event.contextAfter)
    }
  }
  for (const group of data.foldedLogs) {
    add(group.firstLine)
    add(group.lastLine)
  }
  return resolveRefMap(rawStore, refs)
}

async function resolveRefMap(rawStore: RawLogStore, refs: LogLineRef[]): Promise<Map<number, ParsedLogLine>> {
  if (refs.length === 0) return new Map()
  const lines = await rawStore.resolveRefs(refs)
  return new Map(lines.map((line, i) => [refs[i].globalIndex, line]))
}

function formatErrorOccurrence(occurrence: ReplaySessionData['errorOccurrences'][number]): string {
  const definition = occurrence.definition
  const parts = [
    occurrence.timestamp,
    occurrence.code,
    definition?.content || definition?.description || occurrence.source
  ]
  if (definition?.screenText) parts.push(`屏幕显示: ${definition.screenText}`)
  if (definition?.troubleshooting) parts.push(`排查: ${definition.troubleshooting}`)
  if (definition?.sourceLabel) parts.push(`来源: ${definition.sourceLabel}`)
  return parts.join(' | ')
}

function matchLabel(strategy: string): string {
  const labels: Record<string, string> = {
    manual: '手动指定',
    detected_exact: '日志同名匹配',
    detected_contains: '日志近似匹配',
    fallback_first_json: '回退第一个 JSON',
    missing: '未找到地图'
  }
  return labels[strategy] || strategy || '-'
}
