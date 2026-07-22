import { createHash, randomUUID } from 'crypto'
import path from 'path'
import { readJsonStore, writeJsonStore } from '../db/jsonStore'
import type {
  KnowledgeEvidencePattern,
  KnowledgeLibrary,
  KnowledgeMatch,
  KnowledgeMatchContext,
  KnowledgePatternSuggestion,
  KnowledgeRule,
  LogLevel,
  ParsedLogLine,
  PublicationStatus,
  RootCauseCandidate,
  TroubleshootingGuideStep,
  VehicleStateName
} from '../types'

const KNOWLEDGE_KEY = 'knowledgeBase'
const HITS_KEY = 'knowledgeHits'
const MAX_EVIDENCE_LINES = 50
const STOP_WORDS = new Set([
  'the',
  'and',
  'from',
  'with',
  'this',
  'that',
  'null',
  'true',
  'false',
  'start',
  'end',
  'current',
  'task',
  'error',
  'code'
])

interface KnowledgeHitsData {
  updatedAt: string
  hits: Record<string, { hitCount: number; recentHits: any[]; updatedAt: string }>
}

async function readKnowledgeHits(): Promise<KnowledgeHitsData> {
  return readJsonStore<KnowledgeHitsData>(HITS_KEY, { updatedAt: '', hits: {} })
}

async function writeKnowledgeHits(data: KnowledgeHitsData): Promise<void> {
  await writeJsonStore(HITS_KEY, data)
}

function stripRuntimeFields(rule: KnowledgeRule): KnowledgeRule {
  const { hitCount, recentHits, ...rest } = rule
  return { ...rest, hitCount: 0, recentHits: [] }
}

function mergeHitsIntoRules(rules: KnowledgeRule[], hitsData: KnowledgeHitsData): KnowledgeRule[] {
  return rules.map((rule) => {
    const hit = hitsData.hits[rule.id]
    if (!hit) return rule
    return { ...rule, hitCount: hit.hitCount || 0, recentHits: hit.recentHits || [] }
  })
}

export async function readKnowledgeLibrary(): Promise<KnowledgeLibrary> {
  return normalizeLibrary(await readJsonStore<KnowledgeLibrary>(KNOWLEDGE_KEY, { version: 1, updatedAt: '', rules: [] }))
}

export async function readKnowledgeLibraryWithHits(): Promise<KnowledgeLibrary> {
  const library = await readKnowledgeLibrary()
  const hitsData = await readKnowledgeHits()
  return { ...library, updatedAt: hitsData.updatedAt || library.updatedAt, rules: mergeHitsIntoRules(library.rules, hitsData) }
}

export async function getKnowledgeLibraryFingerprint(): Promise<string> {
  const library = await readKnowledgeLibrary()
  return createHash('sha1').update(JSON.stringify(library)).digest('hex')
}

export async function writeKnowledgeLibrary(library: KnowledgeLibrary): Promise<KnowledgeLibrary> {
  const normalized = normalizeLibrary({ ...library, updatedAt: new Date().toISOString() })
  const cleaned = { ...normalized, rules: normalized.rules.map(stripRuntimeFields) }
  await writeJsonStore(KNOWLEDGE_KEY, cleaned)
  return normalized
}

export async function listKnowledgeRules(query: Record<string, unknown> = {}) {
  const library = await readKnowledgeLibraryWithHits()
  const keyword = String(query.keyword || '').trim().toLowerCase()
  const severity = String(query.severity || '')
  const enabled = String(query.enabled || '')
  const verificationStatus = String(query.verificationStatus || '')
  const publicationStatus = String(query.publicationStatus || '')
  const tag = String(query.tag || '').trim().toLowerCase()
  const moduleName = String(query.module || '').trim().toLowerCase()
  const errorCode = String(query.errorCode || '').trim().toUpperCase()
  const rules = library.rules
    .filter((rule) => !keyword || `${rule.title} ${rule.description} ${rule.rootCause} ${rule.solution}`.toLowerCase().includes(keyword))
    .filter((rule) => !severity || rule.severity === severity)
    .filter((rule) => !enabled || String(rule.enabled) === enabled)
    .filter((rule) => !verificationStatus || rule.verificationStatus === verificationStatus)
    .filter((rule) => !publicationStatus || rule.publicationStatus === publicationStatus)
    .filter((rule) => !tag || rule.tags.some((item) => item.toLowerCase().includes(tag)))
    .filter((rule) => !moduleName || rule.pattern.modules.some((item) => item.toLowerCase().includes(moduleName)))
    .filter((rule) => !errorCode || rule.pattern.errorCodes.some((item) => item.toUpperCase().includes(errorCode)))
  return {
    library: {
      version: library.version,
      updatedAt: library.updatedAt,
      total: library.rules.length,
      enabled: library.rules.filter((rule) => rule.enabled).length
    },
    rules
  }
}

export async function createKnowledgeRule(input: Partial<KnowledgeRule>): Promise<KnowledgeRule> {
  const library = await readKnowledgeLibrary()
  const rule = normalizeRule({
    ...input,
    id: input.id || `knowledge-${randomUUID().slice(0, 8)}`,
    createdAt: input.createdAt || new Date().toISOString()
  })
  validateKnowledgePattern(rule.pattern)
  library.rules.push(rule)
  await writeKnowledgeLibrary(library)
  return rule
}

export async function updateKnowledgeRule(id: string, input: Partial<KnowledgeRule>): Promise<KnowledgeRule | null> {
  const library = await readKnowledgeLibrary()
  const index = library.rules.findIndex((rule) => rule.id === id)
  if (index < 0) return null
  const next = normalizeRule({
    ...library.rules[index],
    ...input,
    id,
    createdAt: library.rules[index].createdAt,
    updatedAt: new Date().toISOString()
  })
  validateKnowledgePattern(next.pattern)
  library.rules[index] = next
  await writeKnowledgeLibrary(library)
  return next
}

export async function deleteKnowledgeRule(id: string): Promise<boolean> {
  const library = await readKnowledgeLibrary()
  const next = library.rules.filter((rule) => rule.id !== id)
  if (next.length === library.rules.length) return false
  await writeKnowledgeLibrary({ ...library, rules: next })
  return true
}

export async function toggleKnowledgeRule(id: string, enabled?: boolean): Promise<KnowledgeRule | null> {
  const library = await readKnowledgeLibrary()
  const rule = library.rules.find((item) => item.id === id)
  if (!rule) return null
  rule.enabled = typeof enabled === 'boolean' ? enabled : !rule.enabled
  rule.updatedAt = new Date().toISOString()
  await writeKnowledgeLibrary(library)
  return normalizeRule(rule)
}

export function exportKnowledgeLibraryPayload(library: KnowledgeLibrary) {
  return normalizeLibrary(library)
}

export async function importKnowledgeLibraryPayload(input: unknown, overwrite = false) {
  const current = await readKnowledgeLibrary()
  const incoming = normalizeLibrary(input)
  const existingIds = new Set(current.rules.map((rule) => rule.id))
  const existingTitles = new Set(current.rules.map((rule) => rule.title))
  let imported = 0
  let updated = 0
  let skipped = 0
  const conflicts: Array<{ id: string; title: string; reason: string }> = []
  const rules = [...current.rules]
  for (const rule of incoming.rules) {
    const sameIdIndex = rules.findIndex((item) => item.id === rule.id)
    const titleConflict = existingTitles.has(rule.title) && sameIdIndex < 0
    if ((sameIdIndex >= 0 || titleConflict) && !overwrite) {
      skipped += 1
      conflicts.push({ id: rule.id, title: rule.title, reason: sameIdIndex >= 0 ? 'id' : 'title' })
      continue
    }
    if (sameIdIndex >= 0) {
      const next = normalizeRule({ ...rule, updatedAt: new Date().toISOString() })
      validateKnowledgePattern(next.pattern)
      rules[sameIdIndex] = next
      updated += 1
      continue
    }
    const next = normalizeRule({
      ...rule,
      id: existingIds.has(rule.id) ? `knowledge-${randomUUID().slice(0, 8)}` : rule.id,
      createdAt: rule.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    validateKnowledgePattern(next.pattern)
    rules.push(next)
    imported += 1
  }
  const library = await writeKnowledgeLibrary({ version: 1, updatedAt: new Date().toISOString(), rules })
  return { imported, updated, skipped, conflicts, library }
}

export function suggestKnowledgePattern(lines: ParsedLogLine[]): KnowledgePatternSuggestion {
  const sorted = [...lines].sort((a, b) => a.timeMs - b.timeMs)
  const modules = topValues(sorted.map((line) => line.module).filter(Boolean), 6)
  const levels = topValues(sorted.map((line) => line.level).filter((level) => level !== 'UNKNOWN'), 4) as LogLevel[]
  const errorCodes = topValues(sorted.flatMap((line) => line.raw.match(/ERROR\d{3,6}/g) || []), 8)
  const keywords = extractKeywords(sorted)
  const spanMs = sorted.length >= 2 ? Math.max(0, sorted[sorted.length - 1].timeMs - sorted[0].timeMs) : 0
  return {
    modules,
    levels,
    errorCodes,
    requiredLineRegexes: [],
    requiredVehicleStates: [],
    requiredKeywords: keywords.slice(0, 2),
    anyKeywords: keywords.slice(0, 8),
    excludedKeywords: [],
    windowSeconds: Math.max(5, Math.ceil(spanMs / 1000) || 10),
    minOccurrences: Math.max(1, Math.min(3, sorted.length)),
    confidenceBase: 0.62,
    confidenceWeights: [
      ...errorCodes.slice(0, 3).map((code) => ({ type: 'errorCode' as const, value: code, weight: 0.16 })),
      ...modules.slice(0, 3).map((moduleName) => ({ type: 'module' as const, value: moduleName, weight: 0.08 })),
      ...keywords.slice(0, 3).map((keyword) => ({ type: 'keyword' as const, value: keyword, weight: 0.06 }))
    ]
  }
}

export async function matchKnowledgeRules(context: KnowledgeMatchContext, logDir = ''): Promise<KnowledgeMatch[]> {
  const library = await readKnowledgeLibrary()
  const enabledRules = library.rules.filter((rule) => rule.enabled)
  if (enabledRules.length === 0 || context.rawLines.length === 0) return []

  const candidateRules = preFilterRules(enabledRules, context)
  const matches = candidateRules
    .map((rule) => matchKnowledgeRule(rule, context))
    .filter(Boolean) as KnowledgeMatch[]
  if (matches.length > 0) await recordKnowledgeHits(matches, logDir)
  return matches.sort((a, b) => severityScore(b.severity) - severityScore(a.severity) || b.confidence - a.confidence)
}

function preFilterRules(rules: KnowledgeRule[], context: KnowledgeMatchContext): KnowledgeRule[] {
  return rules.filter((rule) => {
    const p = normalizeRule(rule).pattern
    const regexes = compileRequiredLineRegexes(p.requiredLineRegexes)
    if (regexes.length > 0 && !context.rawLines.some((line) => matchesAnyRegex(line.raw, regexes))) return false
    if (p.errorCodes.length > 0 && !context.errorOccurrences.some((item) => item.kind === 'real_fault' && p.errorCodes.includes(item.code))) return false
    if (p.requiredVehicleStates.length > 0 && !context.vehicleStateOccurrences.some((item) => p.requiredVehicleStates.includes(item.state))) return false
    if (!hasStructuredCore(p) && p.requiredKeywords.some((keyword) => !context.rawLines.some((line) => matchesKeyword(line.raw, keyword)))) return false
    return hasStructuredCore(p) || hasTextCore(p)
  })
}

export function matchKnowledgeRule(rule: KnowledgeRule, input: KnowledgeMatchContext | ParsedLogLine[]): KnowledgeMatch | null {
  const normalized = normalizeRule(rule)
  const context = normalizeMatchContext(input)
  const rawLines = context.rawLines
  const candidateLines = rawLines.filter((line) => !hasExcludedKeyword(line, normalized.pattern.excludedKeywords))
  const requiredRegexes = compileRequiredLineRegexes(normalized.pattern.requiredLineRegexes)
  const structuredEvidence = collectStructuredEvidence(normalized.pattern, context, requiredRegexes)
  const anchorLines = hasStructuredCore(normalized.pattern)
    ? structuredEvidence
    : candidateLines.filter((line) => lineMatchesTextCore(line, normalized.pattern))
  if (anchorLines.length === 0) return null
  const windows = buildCandidateWindows(candidateLines, anchorLines, normalized.pattern.windowSeconds || 0)
  let best: { lines: ParsedLogLine[]; matchedPatterns: string[]; confidence: number } | null = null
  for (const windowLines of windows) {
    const evidence = hasStructuredCore(normalized.pattern)
      ? structuredEvidence.filter((line) => windowLines.some((windowLine) => sameLine(windowLine, line)))
      : windowLines.filter((line) => lineMatchesTextCore(line, normalized.pattern))
    if (evidence.length < Math.max(1, normalized.pattern.minOccurrences || 1)) continue
    if (!hasStructuredCore(normalized.pattern)) {
      if (!requiredKeywordsMatched(windowLines, normalized.pattern.requiredKeywords)) continue
      if (!anyKeywordsMatched(windowLines, normalized.pattern.anyKeywords)) continue
    }
    const matchedPatterns = collectMatchedPatterns(normalized.pattern, windowLines, evidence, requiredRegexes, context)
    const confidence = calculateConfidence(normalized.pattern, windowLines, matchedPatterns)
    if (!best || confidence > best.confidence || evidence.length > best.lines.length) {
      best = { lines: evidence.slice(0, MAX_EVIDENCE_LINES), matchedPatterns, confidence }
    }
  }
  if (!best) return null
  return {
    ruleId: normalized.id,
    title: normalized.title,
    confidence: best.confidence,
    severity: normalized.severity,
    matchedPatterns: Array.from(new Set(best.matchedPatterns)),
    evidenceLines: best.lines,
    suggestion: normalized.solution,
    description: normalized.description,
    rootCause: normalized.rootCause,
    solution: normalized.solution,
    tags: normalized.tags,
    scope: normalized.scope,
    ruleSnapshot: normalized
  }
}

export function knowledgeMatchToRootCauseCandidate(match: KnowledgeMatch): RootCauseCandidate {
  return {
    id: `knowledge-${match.ruleId}`,
    title: match.title,
    confidence: match.confidence,
    severity: match.severity,
    evidenceEvents: [],
    evidenceLines: match.evidenceLines,
    suggestion: match.solution || match.suggestion,
    triggeredRules: match.matchedPatterns,
    positiveEvidence: [
      `知识库规则: ${match.title}`,
      `命中证据 ${match.evidenceLines.length} 行`,
      match.tags.length ? `标签: ${match.tags.join(', ')}` : ''
    ].filter(Boolean),
    negativeEvidence: [],
    confidenceFactors: [`知识库基础规则`, `置信度 ${Math.round(match.confidence * 100)}%`],
    source: 'knowledge_base',
    knowledgeRuleId: match.ruleId,
    knowledgeRuleTitle: match.title
  }
}

async function recordKnowledgeHits(matches: KnowledgeMatch[], logDir: string) {
  const hitsData = await readKnowledgeHits()
  const now = new Date().toISOString()
  for (const match of matches) {
    const existing = hitsData.hits[match.ruleId] || { hitCount: 0, recentHits: [], updatedAt: '' }
    existing.hitCount += 1
    existing.recentHits = [
      { timestamp: now, logDir, evidenceCount: match.evidenceLines.length },
      ...existing.recentHits
    ].slice(0, 10)
    existing.updatedAt = now
    hitsData.hits[match.ruleId] = existing
  }
  hitsData.updatedAt = now
  await writeKnowledgeHits(hitsData)
}

function requiredKeywordsMatched(lines: ParsedLogLine[], keywords: string[]) {
  return keywords.every((keyword) => lines.some((line) => matchesKeyword(line.raw, keyword)))
}

function anyKeywordsMatched(lines: ParsedLogLine[], keywords: string[]) {
  return keywords.length === 0 || keywords.some((keyword) => lines.some((line) => matchesKeyword(line.raw, keyword)))
}

function errorCodesMatched(lines: ParsedLogLine[], errorCodes: string[]) {
  return errorCodes.length === 0 || errorCodes.some((code) => lines.some((line) => matchesKeyword(line.raw, code)))
}

function hasExcludedKeyword(line: ParsedLogLine, keywords: string[]) {
  return keywords.some((keyword) => matchesKeyword(line.raw, keyword))
}

function collectMatchedPatterns(
  pattern: KnowledgeEvidencePattern,
  lines: ParsedLogLine[],
  evidence: ParsedLogLine[],
  requiredRegexes: RegExp[],
  context: KnowledgeMatchContext
): string[] {
  const matched = new Set<string>()
  for (let i = 0; i < requiredRegexes.length; i++) {
    if (evidence.some((line) => requiredRegexes[i].test(line.raw))) {
      matched.add(`核心正则 ${pattern.requiredLineRegexes[i]}`)
    }
  }
  for (const code of pattern.errorCodes) {
    if (context.errorOccurrences.some((item) => item.kind === 'real_fault' && item.code === code)) matched.add(`真实错误码 ${code}`)
  }
  for (const state of pattern.requiredVehicleStates) {
    if (context.vehicleStateOccurrences.some((item) => item.state === state)) matched.add(`车辆状态 ${state}`)
  }
  for (const moduleName of pattern.modules) {
    if (lines.some((line) => matchesModule(line.module, moduleName))) matched.add(`模块 ${moduleName}`)
  }
  for (const level of pattern.levels) {
    if (lines.some((line) => line.level === level)) matched.add(`等级 ${level}`)
  }
  for (const keyword of [...pattern.requiredKeywords, ...pattern.anyKeywords]) {
    if (lines.some((line) => matchesKeyword(line.raw, keyword))) matched.add(`关键词 ${keyword}`)
  }
  return Array.from(matched)
}

function matchesKeyword(text: string, keyword: string): boolean {
  const value = String(keyword || '').trim()
  if (!value) return false
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    const boundary = `(^|[^A-Za-z0-9_])${escapeRegExp(value)}(?=$|[^A-Za-z0-9_])`
    return new RegExp(boundary, 'i').test(text)
  }
  if (/^[\x00-\x7F]+$/.test(value)) return text.toLowerCase().includes(value.toLowerCase())
  return text.includes(value)
}

function matchesModule(moduleName: string, expected: string): boolean {
  return moduleName.trim().toLowerCase() === expected.trim().toLowerCase()
}

function compileRequiredLineRegexes(sources: string[]): RegExp[] {
  return sources.map((source) => {
    try {
      return new RegExp(source, 'i')
    } catch (error) {
      throw new Error(`核心行正则无效: ${source} (${error instanceof Error ? error.message : String(error)})`)
    }
  })
}

function matchesAnyRegex(text: string, regexes: RegExp[]): boolean {
  return regexes.some((regex) => regex.test(text))
}

function validateKnowledgePattern(pattern: KnowledgeEvidencePattern): void {
  compileRequiredLineRegexes(pattern.requiredLineRegexes)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function calculateConfidence(pattern: KnowledgeEvidencePattern, lines: ParsedLogLine[], matchedPatterns: string[]) {
  let confidence = pattern.confidenceBase ?? 0.6
  const appliedWeights = new Set<string>()
  for (const weight of pattern.confidenceWeights || []) {
    const value = weight.value || ''
    if (!value) continue
    const weightKey = `${weight.type}:${value.toLowerCase()}`
    if (appliedWeights.has(weightKey)) continue
    const matched = lines.some((line) => {
      if (weight.type === 'keyword') return matchesKeyword(line.raw, value)
      if (weight.type === 'module') return matchesModule(line.module, value)
      if (weight.type === 'level') return line.level === value
      if (weight.type === 'errorCode') return matchesKeyword(line.raw, value)
      return false
    })
    if (matched) {
      confidence += Number(weight.weight || 0)
      appliedWeights.add(weightKey)
    }
  }
  confidence += Math.min(0.12, new Set(matchedPatterns).size * 0.01)
  return Math.max(0.05, Math.min(0.98, confidence))
}

function* iterateWindows(lines: ParsedLogLine[], windowSeconds: number): Generator<ParsedLogLine[]> {
  if (!windowSeconds || windowSeconds <= 0 || lines.length <= 1) {
    yield lines
    return
  }
  const windowMs = windowSeconds * 1000
  let left = 0
  for (let right = 0; right < lines.length; right++) {
    while (lines[right].timeMs - lines[left].timeMs > windowMs) left += 1
    yield lines.slice(left, right + 1)
  }
}

function patternIsLoose(pattern: KnowledgeEvidencePattern) {
  return pattern.requiredLineRegexes.length === 0 &&
    pattern.requiredVehicleStates.length === 0 &&
    pattern.requiredKeywords.length === 0 &&
    pattern.anyKeywords.length === 0 &&
    pattern.modules.length === 0 &&
    pattern.levels.length === 0 &&
    pattern.errorCodes.length === 0
}

function hasTextCore(pattern: KnowledgeEvidencePattern): boolean {
  return pattern.requiredKeywords.length > 0 || pattern.anyKeywords.length > 0 || pattern.errorCodes.length > 0
}

function hasStructuredCore(pattern: KnowledgeEvidencePattern): boolean {
  return pattern.requiredLineRegexes.length > 0 || pattern.errorCodes.length > 0 || pattern.requiredVehicleStates.length > 0
}

function collectStructuredEvidence(
  pattern: KnowledgeEvidencePattern,
  context: KnowledgeMatchContext,
  regexes: RegExp[]
): ParsedLogLine[] {
  const groups: ParsedLogLine[][] = []
  if (regexes.length > 0) groups.push(context.rawLines.filter((line) => matchesAnyRegex(line.raw, regexes)))
  if (pattern.errorCodes.length > 0) {
    groups.push(context.errorOccurrences
      .filter((item) => item.kind === 'real_fault' && pattern.errorCodes.includes(item.code))
      .map((item) => item.line))
  }
  if (pattern.requiredVehicleStates.length > 0) {
    groups.push(context.vehicleStateOccurrences
      .filter((item) => pattern.requiredVehicleStates.includes(item.state))
      .map((item) => item.line))
  }
  if (groups.some((group) => group.length === 0)) return []
  return uniqueLines(groups.flat()).sort((a, b) => a.timeMs - b.timeMs || a.line - b.line)
}

function normalizeMatchContext(input: KnowledgeMatchContext | ParsedLogLine[]): KnowledgeMatchContext {
  return Array.isArray(input)
    ? { rawLines: input, errorOccurrences: [], vehicleStateOccurrences: [] }
    : input
}

function uniqueLines(lines: ParsedLogLine[]): ParsedLogLine[] {
  const seen = new Set<string>()
  return lines.filter((line) => {
    const key = `${line.file}:${line.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sameLine(a: ParsedLogLine, b: ParsedLogLine): boolean {
  return a.file === b.file && a.line === b.line
}

function lineMatchesTextCore(line: ParsedLogLine, pattern: KnowledgeEvidencePattern): boolean {
  return [...pattern.requiredKeywords, ...pattern.anyKeywords, ...pattern.errorCodes]
    .some((value) => matchesKeyword(line.raw, value))
}

function buildCandidateWindows(lines: ParsedLogLine[], anchors: ParsedLogLine[], windowSeconds: number): ParsedLogLine[][] {
  if (lines.length === 0) return []
  if (anchors.length === 0) return patternIsLooseFallback(lines, windowSeconds)
  if (!windowSeconds || windowSeconds <= 0) return [anchors]
  const windowMs = windowSeconds * 1000
  const maxAnchors = Math.min(anchors.length, 500)
  const ranges: Array<[number, number]> = []
  let left = 0
  let right = 0
  for (let i = 0; i < maxAnchors; i++) {
    const anchor = anchors[i]
    while (left < lines.length && lines[left].timeMs < anchor.timeMs - windowMs) left += 1
    while (right < lines.length && lines[right].timeMs <= anchor.timeMs + windowMs) right += 1
    if (ranges.length > 0 && left <= ranges[ranges.length - 1][1]) {
      ranges[ranges.length - 1][1] = Math.max(ranges[ranges.length - 1][1], right)
    } else {
      ranges.push([left, right])
    }
  }
  return ranges.map(([l, r]) => lines.slice(l, r))
}

function patternIsLooseFallback(lines: ParsedLogLine[], windowSeconds: number): ParsedLogLine[][] {
  if (!windowSeconds || windowSeconds <= 0) return [lines]
  return [lines.slice(0, MAX_EVIDENCE_LINES)]
}

function normalizeLibrary(input: unknown): KnowledgeLibrary {
  const data = input && typeof input === 'object' ? input as Partial<KnowledgeLibrary> : {}
  const rules = Array.isArray(data.rules) ? data.rules.map(normalizeRule) : []
  return {
    version: 1,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    rules
  }
}

function normalizeRule(input: Partial<KnowledgeRule>): KnowledgeRule {
  const now = new Date().toISOString()
  return {
    id: String(input.id || `knowledge-${randomUUID().slice(0, 8)}`),
    title: String(input.title || '未命名知识'),
    description: String(input.description || ''),
    rootCause: String(input.rootCause || ''),
    solution: String(input.solution || ''),
    severity: normalizeSeverity(input.severity),
    tags: normalizeStringArray(input.tags),
    enabled: input.enabled !== false,
    verificationStatus: normalizeVerificationStatus(input.verificationStatus),
    publicationStatus: normalizePublicationStatus(input.publicationStatus),
    guideSteps: normalizeGuideSteps(input.guideSteps),
    reviewReason: input.reviewReason ? String(input.reviewReason) : undefined,
    feedbackStats: normalizeFeedbackStats(input.feedbackStats),
    scope: input.scope || {},
    pattern: normalizePattern(input.pattern),
    examples: Array.isArray(input.examples) ? input.examples.map((example) => ({
      id: example.id || `example-${randomUUID().slice(0, 8)}`,
      title: example.title,
      note: example.note,
      lines: Array.isArray(example.lines) ? example.lines : [],
      createdAt: example.createdAt || now
    })) : [],
    hitCount: Number(input.hitCount || 0),
    recentHits: Array.isArray(input.recentHits) ? input.recentHits.slice(0, 10) : [],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    createdBy: input.createdBy
  }
}

function normalizePattern(pattern?: Partial<KnowledgeEvidencePattern>): KnowledgeEvidencePattern {
  return {
    requiredLineRegexes: normalizeStringArray(pattern?.requiredLineRegexes),
    requiredVehicleStates: normalizeVehicleStates(pattern?.requiredVehicleStates),
    requiredKeywords: normalizeStringArray(pattern?.requiredKeywords),
    anyKeywords: normalizeStringArray(pattern?.anyKeywords),
    excludedKeywords: normalizeStringArray(pattern?.excludedKeywords),
    modules: normalizeStringArray(pattern?.modules),
    levels: normalizeStringArray(pattern?.levels).filter((level): level is LogLevel => ['D', 'I', 'W', 'E', 'UNKNOWN'].includes(level)),
    errorCodes: normalizeStringArray(pattern?.errorCodes).map((code) => code.toUpperCase()),
    windowSeconds: Number(pattern?.windowSeconds || 0) || undefined,
    minOccurrences: Number(pattern?.minOccurrences || 0) || undefined,
    confidenceBase: Number.isFinite(Number(pattern?.confidenceBase)) ? Number(pattern?.confidenceBase) : 0.6,
    confidenceWeights: Array.isArray(pattern?.confidenceWeights)
      ? pattern.confidenceWeights.map((weight) => ({
        type: weight.type,
        value: String(weight.value || ''),
        weight: Number(weight.weight || 0)
      })).filter((weight) => ['keyword', 'module', 'level', 'errorCode'].includes(weight.type) && weight.value)
      : []
  }
}

function normalizeSeverity(value: unknown): KnowledgeRule['severity'] {
  return value === 'error' || value === 'warning' || value === 'info' ? value : 'warning'
}

function normalizeVerificationStatus(value: unknown): KnowledgeRule['verificationStatus'] {
  return value === 'sample_verified' || value === 'structure_guarded' || value === 'pending' ? value : 'pending'
}

function normalizePublicationStatus(value: unknown): PublicationStatus {
  return value === 'draft' || value === 'verified' || value === 'needs_review' || value === 'deprecated' ? value : 'draft'
}

function normalizeGuideSteps(value: unknown): TroubleshootingGuideStep[] {
  if (!Array.isArray(value)) return []
  return value.map((step, idx) => ({
    stepNo: Number(step.stepNo) || idx + 1,
    title: String(step.title || `步骤 ${idx + 1}`),
    instruction: step.instruction ? String(step.instruction) : undefined,
    criteria: step.criteria ? String(step.criteria) : undefined,
    stepType: ['readonly_check', 'field_operation', 'rd_required'].includes(step.stepType) ? step.stepType : 'readonly_check',
    estimatedTime: ['3_5_min', '10_min', 'long'].includes(step.estimatedTime) ? step.estimatedTime : undefined,
    evidenceConfig: step.evidenceConfig && typeof step.evidenceConfig === 'object' ? step.evidenceConfig : undefined,
    isCritical: step.isCritical === true,
    failureAction: step.failureAction ? String(step.failureAction) : undefined
  }))
}

function normalizeFeedbackStats(value: unknown): { useful: number; partial: number; useless: number } {
  if (value && typeof value === 'object') {
    const stats = value as Partial<{ useful: number; partial: number; useless: number }>
    return {
      useful: Number(stats.useful || 0),
      partial: Number(stats.partial || 0),
      useless: Number(stats.useless || 0)
    }
  }
  return { useful: 0, partial: 0, useless: 0 }
}

function normalizeVehicleStates(value: unknown): VehicleStateName[] {
  const allowed = new Set<VehicleStateName>([
    'FrontTruck', 'BackTruck', 'SideTruck', 'LeftTruck', 'RightTruck', 'LowPower',
    'ForkTipActive', 'EStopEnable', 'CollisionStrip', 'SaftyActive', 'EStop'
  ])
  return normalizeStringArray(value).filter((item): item is VehicleStateName => allowed.has(item as VehicleStateName))
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
}

function extractKeywords(lines: ParsedLogLine[]): string[] {
  const words = new Map<string, number>()
  for (const line of lines) {
    for (const word of line.message.match(/[A-Za-z_][A-Za-z0-9_]{3,}|[\u4e00-\u9fa5]{2,}/g) || []) {
      const normalized = word.toLowerCase()
      if (STOP_WORDS.has(normalized) || /^ERROR\d+$/i.test(word)) continue
      words.set(word, (words.get(word) || 0) + 1)
    }
  }
  return Array.from(words.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([word]) => word)
    .slice(0, 12)
}

function topValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([value]) => value).slice(0, limit)
}

function severityScore(severity: KnowledgeRule['severity']): number {
  if (severity === 'error') return 3
  if (severity === 'warning') return 2
  return 1
}
