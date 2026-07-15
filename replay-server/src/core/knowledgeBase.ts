import { randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type {
  KnowledgeEvidencePattern,
  KnowledgeLibrary,
  KnowledgeMatch,
  KnowledgePatternSuggestion,
  KnowledgeRule,
  LogLevel,
  ParsedLogLine,
  RootCauseCandidate
} from '../types'

const KNOWLEDGE_FILE = path.resolve(process.cwd(), 'replay-server/config/knowledge-base.json')
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

export async function readKnowledgeLibrary(): Promise<KnowledgeLibrary> {
  try {
    const text = await fs.readFile(KNOWLEDGE_FILE, 'utf8')
    return normalizeLibrary(JSON.parse(text))
  } catch {
    return { version: 1, updatedAt: '', rules: [] }
  }
}

export async function writeKnowledgeLibrary(library: KnowledgeLibrary): Promise<KnowledgeLibrary> {
  const normalized = normalizeLibrary({ ...library, updatedAt: new Date().toISOString() })
  await fs.mkdir(path.dirname(KNOWLEDGE_FILE), { recursive: true })
  await fs.writeFile(KNOWLEDGE_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

export async function listKnowledgeRules(query: Record<string, unknown> = {}) {
  const library = await readKnowledgeLibrary()
  const keyword = String(query.keyword || '').trim().toLowerCase()
  const severity = String(query.severity || '')
  const enabled = String(query.enabled || '')
  const tag = String(query.tag || '').trim().toLowerCase()
  const moduleName = String(query.module || '').trim().toLowerCase()
  const errorCode = String(query.errorCode || '').trim().toUpperCase()
  const rules = library.rules
    .filter((rule) => !keyword || `${rule.title} ${rule.description} ${rule.rootCause} ${rule.solution}`.toLowerCase().includes(keyword))
    .filter((rule) => !severity || rule.severity === severity)
    .filter((rule) => !enabled || String(rule.enabled) === enabled)
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
      rules[sameIdIndex] = normalizeRule({ ...rule, updatedAt: new Date().toISOString() })
      updated += 1
      continue
    }
    const next = normalizeRule({
      ...rule,
      id: existingIds.has(rule.id) ? `knowledge-${randomUUID().slice(0, 8)}` : rule.id,
      createdAt: rule.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
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

export async function matchKnowledgeRules(rawLines: ParsedLogLine[], logDir = ''): Promise<KnowledgeMatch[]> {
  const library = await readKnowledgeLibrary()
  const enabledRules = library.rules.filter((rule) => rule.enabled)
  if (enabledRules.length === 0 || rawLines.length === 0) return []

  const candidateRules = preFilterRules(enabledRules, rawLines)
  const matches = candidateRules
    .map((rule) => matchKnowledgeRule(rule, rawLines))
    .filter(Boolean) as KnowledgeMatch[]
  if (matches.length > 0) await recordKnowledgeHits(matches, logDir)
  return matches.sort((a, b) => severityScore(b.severity) - severityScore(a.severity) || b.confidence - a.confidence)
}

function preFilterRules(rules: KnowledgeRule[], rawLines: ParsedLogLine[]): KnowledgeRule[] {
  const allTerms = new Set<string>()
  for (const rule of rules) {
    const p = rule.pattern || {}
    for (const kw of (p as any).requiredKeywords || []) if (kw) allTerms.add(kw)
    for (const code of (p as any).errorCodes || []) if (code) allTerms.add(code)
  }

  const foundTerms = new Set<string>()
  const remaining = new Set(allTerms)
  for (const line of rawLines) {
    if (remaining.size === 0) break
    for (const term of remaining) {
      if (line.raw.includes(term)) {
        foundTerms.add(term)
        remaining.delete(term)
      }
    }
  }

  const existingModules = new Set<string>()
  for (const line of rawLines) {
    if (line.module) existingModules.add(line.module)
  }

  return rules.filter((rule) => {
    const p = normalizeRule(rule).pattern
    if (p.requiredKeywords.length > 0 && p.requiredKeywords.some((kw) => kw && !foundTerms.has(kw))) return false
    if (p.errorCodes.length > 0 && !p.errorCodes.some((code) => foundTerms.has(code))) return false
    if (p.modules.length > 0 && p.requiredKeywords.length === 0 && p.errorCodes.length === 0) {
      const hasModule = p.modules.some((mod) => {
        for (const existing of existingModules) {
          if (existing.includes(mod)) return true
        }
        return false
      })
      if (!hasModule) return false
    }
    return true
  })
}

export function matchKnowledgeRule(rule: KnowledgeRule, rawLines: ParsedLogLine[]): KnowledgeMatch | null {
  const normalized = normalizeRule(rule)
  const candidateLines = rawLines.filter((line) => !hasExcludedKeyword(line, normalized.pattern.excludedKeywords))
  const anchorLines = candidateLines.filter((line) => lineMatchesAnyPositiveCondition(line, normalized.pattern))
  const windows = buildCandidateWindows(candidateLines, anchorLines, normalized.pattern.windowSeconds || 0)
  let best: { lines: ParsedLogLine[]; matchedPatterns: string[]; confidence: number } | null = null
  for (const windowLines of windows) {
    const matchedPatterns: string[] = []
    const evidence = filterEvidenceLines(windowLines, normalized.pattern, matchedPatterns)
    if (evidence.length < Math.max(1, normalized.pattern.minOccurrences || 1)) continue
    if (!requiredKeywordsMatched(windowLines, normalized.pattern.requiredKeywords)) continue
    if (!anyKeywordsMatched(windowLines, normalized.pattern.anyKeywords)) continue
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
  const library = await readKnowledgeLibrary()
  let changed = false
  for (const match of matches) {
    const rule = library.rules.find((item) => item.id === match.ruleId)
    if (!rule) continue
    rule.hitCount = (rule.hitCount || 0) + 1
    rule.recentHits = [
      {
        timestamp: new Date().toISOString(),
        logDir,
        evidenceCount: match.evidenceLines.length
      },
      ...(rule.recentHits || [])
    ].slice(0, 10)
    rule.updatedAt = new Date().toISOString()
    changed = true
  }
  if (changed) await writeKnowledgeLibrary(library)
}

function filterEvidenceLines(lines: ParsedLogLine[], pattern: KnowledgeEvidencePattern, matchedPatterns: string[]): ParsedLogLine[] {
  return lines.filter((line) => {
    let matched = false
    if (pattern.modules.length && pattern.modules.some((moduleName) => line.module.includes(moduleName))) {
      matchedPatterns.push(`模块 ${line.module}`)
      matched = true
    }
    if (pattern.levels.length && pattern.levels.includes(line.level)) {
      matchedPatterns.push(`等级 ${line.level}`)
      matched = true
    }
    for (const code of pattern.errorCodes) {
      if (line.raw.includes(code)) {
        matchedPatterns.push(`错误码 ${code}`)
        matched = true
      }
    }
    for (const keyword of [...pattern.requiredKeywords, ...pattern.anyKeywords]) {
      if (keyword && line.raw.includes(keyword)) {
        matchedPatterns.push(`关键词 ${keyword}`)
        matched = true
      }
    }
    return matched || patternIsLoose(pattern)
  })
}

function requiredKeywordsMatched(lines: ParsedLogLine[], keywords: string[]) {
  return keywords.every((keyword) => lines.some((line) => line.raw.includes(keyword)))
}

function anyKeywordsMatched(lines: ParsedLogLine[], keywords: string[]) {
  return keywords.length === 0 || keywords.some((keyword) => lines.some((line) => line.raw.includes(keyword)))
}

function hasExcludedKeyword(line: ParsedLogLine, keywords: string[]) {
  return keywords.some((keyword) => keyword && line.raw.includes(keyword))
}

function calculateConfidence(pattern: KnowledgeEvidencePattern, lines: ParsedLogLine[], matchedPatterns: string[]) {
  let confidence = pattern.confidenceBase ?? 0.6
  for (const weight of pattern.confidenceWeights || []) {
    const value = weight.value || ''
    if (!value) continue
    const matched = lines.some((line) => {
      if (weight.type === 'keyword') return line.raw.includes(value)
      if (weight.type === 'module') return line.module.includes(value)
      if (weight.type === 'level') return line.level === value
      if (weight.type === 'errorCode') return line.raw.includes(value)
      return false
    })
    if (matched) confidence += Number(weight.weight || 0)
  }
  confidence += Math.min(0.12, matchedPatterns.length * 0.01)
  confidence += Math.min(0.08, lines.length * 0.004)
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
  return pattern.requiredKeywords.length === 0 &&
    pattern.anyKeywords.length === 0 &&
    pattern.modules.length === 0 &&
    pattern.levels.length === 0 &&
    pattern.errorCodes.length === 0
}

function lineMatchesAnyPositiveCondition(line: ParsedLogLine, pattern: KnowledgeEvidencePattern): boolean {
  if (patternIsLoose(pattern)) return true
  if (pattern.modules.some((moduleName) => line.module.includes(moduleName))) return true
  if (pattern.levels.includes(line.level)) return true
  if (pattern.errorCodes.some((code) => line.raw.includes(code))) return true
  if ([...pattern.requiredKeywords, ...pattern.anyKeywords].some((keyword) => keyword && line.raw.includes(keyword))) return true
  return false
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
