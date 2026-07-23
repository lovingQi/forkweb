import type {
  KnowledgeMatch,
  KnowledgeRule,
  ReplayCaseMeta,
  ReplaySessionData,
  VectorDocumentChunk,
  VectorSearchResult
} from '../types'

const EMBEDDING_SIZE = 128

export function buildKnowledgeRuleChunks(rules: KnowledgeRule[]): VectorDocumentChunk[] {
  return rules.map((rule) => makeChunk({
    id: `knowledge-rule:${rule.id}`,
    sourceType: 'knowledge_rule',
    sourceId: rule.id,
    title: rule.title,
    tags: rule.tags,
    text: [
      `标题: ${rule.title}`,
      `描述: ${rule.description}`,
      `根因: ${rule.rootCause}`,
      `处理办法: ${rule.solution}`,
      `等级: ${rule.severity}`,
      `标签: ${rule.tags.join(', ')}`,
      `核心行正则: ${rule.pattern.requiredLineRegexes.join(', ')}`,
      `关键词: ${[...rule.pattern.requiredKeywords, ...rule.pattern.anyKeywords, ...rule.pattern.errorCodes, ...rule.pattern.modules].join(', ')}`,
      ...rule.examples.flatMap((example) => (example.lines || []).slice(0, 12).map((line) => `证据: ${line.message}`))
    ].filter(Boolean).join('\n'),
    metadata: {
      severity: rule.severity,
      enabled: rule.enabled,
      hitCount: rule.hitCount,
      solution: rule.solution,
      evidence: rule.examples.flatMap((example) => (example.lines || []).slice(0, 3).map((line) => line.message)).slice(0, 5)
    },
    updatedAt: rule.updatedAt
  }))
}

export function buildCaseMetaChunks(caseMeta: ReplayCaseMeta): VectorDocumentChunk[] {
  if (!caseMeta || Object.keys(caseMeta).length === 0) return []
  const title = caseMeta.confirmedRootCause || caseMeta.note || '人工诊断结论'
  return [makeChunk({
    id: `case-meta:${caseMeta.updatedAt || 'local'}`,
    sourceType: 'case_meta',
    sourceId: caseMeta.updatedAt || 'local',
    title,
    tags: ['case_meta'],
    text: [
      `现场: ${caseMeta.site || ''}`,
      `车辆: ${caseMeta.robotName || ''}`,
      `轮次: ${caseMeta.testRound || ''}`,
      `状态: ${caseMeta.status || ''}`,
      `已确认根因: ${caseMeta.confirmedRootCause || ''}`,
      `备注: ${caseMeta.note || ''}`
    ].filter(Boolean).join('\n'),
    metadata: { status: caseMeta.status || '', solution: caseMeta.note || caseMeta.confirmedRootCause || '' },
    updatedAt: caseMeta.updatedAt || new Date().toISOString()
  })]
}

export function buildCurrentSessionChunks(data: ReplaySessionData): VectorDocumentChunk[] {
  return [
    ...buildKnowledgeMatchChunks(data.knowledgeMatches || []),
    ...data.overview.rootCauses.slice(0, 8).map((cause) => makeChunk({
      id: `root-cause:${cause.id}`,
      sourceType: 'knowledge_match',
      sourceId: cause.id,
      title: cause.title,
      tags: [cause.severity, cause.source || 'built_in'],
      text: [
        `根因候选: ${cause.title}`,
        `建议: ${cause.suggestion}`,
        `来源: ${cause.source || 'built_in'}`,
        `正向证据: ${(cause.positiveEvidence || []).join('; ')}`,
        ...cause.evidenceLines.slice(0, 8).map((line) => `证据: ${line.message}`)
      ].filter(Boolean).join('\n'),
      metadata: {
        confidence: cause.confidence,
        severity: cause.severity,
        solution: cause.suggestion,
        evidence: cause.evidenceLines.slice(0, 5).map((line) => line.message)
      },
      updatedAt: new Date().toISOString()
    }))
  ]
}

export function buildKnowledgeMatchChunks(matches: KnowledgeMatch[]): VectorDocumentChunk[] {
  return matches.map((match) => makeChunk({
    id: `knowledge-match:${match.ruleId}`,
    sourceType: 'knowledge_match',
    sourceId: match.ruleId,
    title: match.title,
    tags: match.tags,
    text: [
      `知识命中: ${match.title}`,
      `描述: ${match.description}`,
      `根因: ${match.rootCause}`,
      `处理办法: ${match.solution}`,
      `命中条件: ${match.matchedPatterns.join(', ')}`,
      ...match.evidenceLines.slice(0, 12).map((line) => `证据: ${line.message}`)
    ].filter(Boolean).join('\n'),
    metadata: {
      confidence: match.confidence,
      severity: match.severity,
      solution: match.solution,
      evidence: match.evidenceLines.slice(0, 5).map((line) => line.message)
    },
    updatedAt: new Date().toISOString()
  }))
}

export function embedText(text: string): number[] {
  const vector = new Array(EMBEDDING_SIZE).fill(0)
  const tokens = tokenize(text)
  for (const token of tokens) {
    const index = Math.abs(hash(token)) % EMBEDDING_SIZE
    vector[index] += 1
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
  return vector.map((value) => Number((value / norm).toFixed(6)))
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function rankChunks(query: string, chunks: VectorDocumentChunk[], limit = 8): VectorSearchResult[] {
  const queryEmbedding = embedText(query)
  const queryTokens = tokenize(query)
  return chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
      highlights: findHighlights(chunk.text, queryTokens)
    }))
    .filter((result) => result.score > 0 || result.highlights.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

function makeChunk(input: {
  id: string
  sourceType: VectorDocumentChunk['source']['type']
  sourceId: string
  title: string
  tags?: string[]
  text: string
  metadata: Record<string, unknown>
  updatedAt: string
}): VectorDocumentChunk {
  const text = input.text.slice(0, 8000)
  return {
    id: input.id,
    source: {
      type: input.sourceType,
      id: input.sourceId,
      title: input.title,
      tags: input.tags || [],
      solution: typeof input.metadata.solution === 'string' ? input.metadata.solution : '',
      evidence: Array.isArray(input.metadata.evidence) ? input.metadata.evidence.map((item) => String(item)).slice(0, 5) : []
    },
    text,
    summary: summarize(text),
    metadata: input.metadata,
    embedding: embedText(text),
    updatedAt: input.updatedAt
  }
}

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-z0-9_]{2,}|error\d{3,6}|[\u4e00-\u9fa5]{2,}/g) || []
  const grams: string[] = []
  for (const word of words) {
    grams.push(word)
    if (/[\u4e00-\u9fa5]/.test(word)) {
      for (let i = 0; i < word.length - 1; i++) grams.push(word.slice(i, i + 2))
    }
  }
  return grams
}

function hash(text: string): number {
  let value = 2166136261
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value
}

function summarize(text: string): string {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 4).join(' / ').slice(0, 300)
}

function findHighlights(text: string, queryTokens: string[]): string[] {
  const lines = text.split('\n').filter(Boolean)
  const uniqueTokens = Array.from(new Set(queryTokens)).slice(0, 12)
  return lines
    .filter((line) => uniqueTokens.some((token) => line.toLowerCase().includes(token)))
    .slice(0, 5)
}
