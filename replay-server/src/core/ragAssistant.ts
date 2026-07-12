import type {
  AssistantAnswer,
  AssistantAskRequest,
  AssistantContext,
  ParsedLogLine,
  ReplaySessionData,
  VectorSearchResult
} from '../types'
import { buildCurrentSessionChunks, rankChunks } from './knowledgeEmbedding'
import { readLlmConfig } from './llmConfig'
import { LlmProviderError, type LlmMessage } from './llmProvider'
import { OpenAiCompatibleClient } from './openAiCompatibleClient'
import { redactAssistantContext } from './redaction'
import { rebuildVectorStore, searchVectorStore } from './vectorStore'

export async function recommendSimilarCases(data: ReplaySessionData, question = ''): Promise<VectorSearchResult[]> {
  const query = buildSearchQuery(data, question)
  const persistent = await searchVectorStore(query, { limit: 8, rebuildIfEmpty: true })
  const current = rankChunks(query, buildCurrentSessionChunks(data), 5)
  return [...persistent, ...current]
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

export async function buildAssistantContext(data: ReplaySessionData, request: AssistantAskRequest): Promise<AssistantContext> {
  await rebuildVectorStore()
  const maxKnowledge = clamp(Number(request.maxKnowledge || 8), 1, 20)
  const maxLogLines = clamp(Number(request.maxLogLines || 80), 0, 300)
  const similarChunks = (await recommendSimilarCases(data, request.question)).slice(0, maxKnowledge)
  const logExcerpts = request.includeLogs === false ? [] : searchRelatedLogExcerpts(data, request.question, maxLogLines)
  const context: AssistantContext = {
    overview: {
      logDir: data.overview.logDir,
      startTime: data.overview.startTime,
      endTime: data.overview.endTime,
      robotName: data.overview.robotName,
      version: data.overview.version,
      branch: data.overview.branch,
      mapName: data.overview.mapName,
      frameCount: data.overview.frameCount,
      taskCount: data.overview.taskCount,
      errorCodeCount: data.overview.errorCodeCount,
      errorCount: data.overview.errorCount,
      warningCount: data.overview.warningCount,
      healthScore: data.overview.healthScore,
      logQualityScore: data.overview.logQualityScore,
      topIssues: data.overview.topIssues.slice(0, 10),
      dataWarnings: data.overview.dataWarnings.slice(0, 10)
    },
    rootCauses: data.overview.rootCauses.slice(0, 8),
    knowledgeMatches: (data.knowledgeMatches || []).slice(0, maxKnowledge),
    similarChunks,
    logExcerpts,
    redaction: { enabled: false, rules: [] }
  }
  const config = await readLlmConfig()
  return redactAssistantContext(context, config.redaction)
}

export async function askReplayAssistant(data: ReplaySessionData, request: AssistantAskRequest): Promise<AssistantAnswer> {
  const question = String(request.question || '').trim()
  if (!question) throw new Error('问题不能为空')
  const config = await readLlmConfig()
  const context = await buildAssistantContext(data, { ...request, question })
  const offlineAnswer = buildOfflineAnswer(question, context, config.model, 'missing_api_key')
  if (!config.apiKey) {
    data.assistant = { ...(data.assistant || {}), lastAnswer: offlineAnswer, similarCases: context.similarChunks }
    return offlineAnswer
  }
  try {
    const client = new OpenAiCompatibleClient(config)
    const payload = await client.chatJson(buildDeepSeekMessages(context, question), {
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs
    }) as any
    const answer: AssistantAnswer = normalizeAssistantAnswer(payload, context, config.model, config.provider)
    data.assistant = { ...(data.assistant || {}), lastAnswer: answer, similarCases: context.similarChunks }
    return answer
  } catch (error) {
    const message = error instanceof LlmProviderError ? error.message : error instanceof Error ? error.message : String(error)
    const answer = {
      ...buildOfflineAnswer(question, context, config.model, 'online_failed'),
      answer: `${buildOfflineAnswer(question, context, config.model, 'online_failed').answer}\n\n在线问答调用失败：${message}`,
      provider: 'offline' as const,
      offline: true
    }
    data.assistant = { ...(data.assistant || {}), lastAnswer: answer, similarCases: context.similarChunks }
    return answer
  }
}

export function buildDeepSeekMessages(context: AssistantContext, question: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是叉车现场日志诊断助手，只能基于用户提供的诊断上下文回答。',
        '不要声称已经读取全量日志。必须明确引用证据和不确定点。',
        '不要自动写入知识库。输出必须是 JSON 对象。',
        'JSON 字段: answer, rootCauseCandidates, suggestions, evidence, uncertainties。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        question,
        context: compactAssistantContext(context)
      }).slice(0, 60000)
    }
  ]
}

function compactAssistantContext(context: AssistantContext) {
  return {
    overview: {
      logDir: context.overview.logDir,
      startTime: context.overview.startTime,
      endTime: context.overview.endTime,
      robotName: context.overview.robotName,
      version: context.overview.version,
      branch: context.overview.branch,
      mapName: context.overview.mapName,
      frameCount: context.overview.frameCount,
      taskCount: context.overview.taskCount,
      errorCodeCount: context.overview.errorCodeCount,
      errorCount: context.overview.errorCount,
      warningCount: context.overview.warningCount,
      healthScore: context.overview.healthScore,
      logQualityScore: context.overview.logQualityScore,
      topIssues: (context.overview.topIssues || []).slice(0, 8).map((event) => ({
        timestamp: event.timestamp,
        level: event.level,
        title: event.title,
        detail: event.detail,
        module: event.module,
        code: event.code
      })),
      dataWarnings: (context.overview.dataWarnings || []).slice(0, 8)
    },
    rootCauses: context.rootCauses.map((cause) => ({
      title: cause.title,
      severity: cause.severity,
      confidence: cause.confidence,
      suggestion: cause.suggestion,
      source: cause.source,
      evidence: cause.evidenceLines.slice(0, 3).map((line) => line.raw)
    })),
    knowledgeMatches: context.knowledgeMatches.map((match) => ({
      title: match.title,
      rootCause: match.rootCause,
      solution: match.solution,
      confidence: match.confidence,
      evidence: match.evidenceLines.slice(0, 3).map((line) => line.raw)
    })),
    similarCases: context.similarChunks.map((item) => ({
      title: item.chunk.source.title,
      source: item.chunk.source.type,
      score: item.score,
      solution: item.chunk.source.solution || item.chunk.metadata.solution || '',
      evidence: item.chunk.source.evidence || item.highlights
    })),
    logExcerpts: context.logExcerpts.map((line) => ({
      timestamp: line.timestamp,
      module: line.module,
      level: line.level,
      raw: line.raw
    })),
    redaction: context.redaction
  }
}

export function searchRelatedLogExcerpts(data: ReplaySessionData, question: string, limit: number): ParsedLogLine[] {
  if (limit <= 0) return []
  const keywords = extractQuestionKeywords(question)
  const eventLines = data.overview.topIssues.flatMap((event) => [event.line, ...(event.contextBefore || []), ...(event.contextAfter || [])]).filter(Boolean) as ParsedLogLine[]
  const rootCauseLines = data.overview.rootCauses.flatMap((cause) => cause.evidenceLines || [])
  const knowledgeLines = (data.knowledgeMatches || []).flatMap((match) => match.evidenceLines || [])
  const keywordLines = keywords.length
    ? data.rawLines.filter((line) => keywords.some((keyword) => line.raw.toLowerCase().includes(keyword))).slice(0, limit)
    : []
  return uniqueLines([...eventLines, ...rootCauseLines, ...knowledgeLines, ...keywordLines]).slice(0, limit)
}

function buildOfflineAnswer(question: string, context: AssistantContext, model: string, reason: 'missing_api_key' | 'online_failed'): AssistantAnswer {
  const topRootCause = context.rootCauses[0]
  const answer = [
    reason === 'missing_api_key'
      ? '当前未配置 DeepSeek API Key，已基于本地规则、知识库和相似案例给出离线建议。'
      : 'DeepSeek 在线问答调用失败，已基于本地规则、知识库和相似案例给出离线建议。',
    topRootCause ? `最优先关注：${topRootCause.title}。${topRootCause.suggestion}` : '当前没有明确根因候选，建议先查看 Top 问题和关键日志片段。',
    context.similarChunks.length ? `已检索到 ${context.similarChunks.length} 条相似知识/案例。` : '本地向量库暂未检索到相似历史案例。'
  ].join('\n')
  return {
    answer,
    rootCauseCandidates: context.rootCauses.map((cause) => cause.title).slice(0, 5),
    suggestions: context.rootCauses.map((cause) => cause.suggestion).filter(Boolean).slice(0, 5),
    evidence: [
      ...context.knowledgeMatches.slice(0, 4).map((match) => ({
        title: match.title,
        source: 'knowledge_base',
        excerpt: match.evidenceLines[0]?.raw || match.description,
        score: match.confidence
      })),
      ...context.logExcerpts.slice(0, 4).map((line) => ({
        title: `${line.timestamp} ${line.module}`,
        source: 'log',
        excerpt: line.raw,
        timestamp: line.timestamp
      }))
    ],
    uncertainties: ['离线模式没有调用大模型，复杂链路需要研发结合地图回放和原始日志确认。'],
    similarCases: context.similarChunks,
    provider: 'offline',
    model,
    offline: true,
    createdAt: new Date().toISOString()
  }
}

function normalizeAssistantAnswer(payload: any, context: AssistantContext, model: string, provider: AssistantAnswer['provider']): AssistantAnswer {
  return {
    answer: String(payload?.answer || 'AI 未返回明确结论。'),
    rootCauseCandidates: normalizeStringArray(payload?.rootCauseCandidates),
    suggestions: normalizeStringArray(payload?.suggestions),
    evidence: Array.isArray(payload?.evidence)
      ? payload.evidence.slice(0, 12).map((item: any) => ({
        title: String(item?.title || '证据'),
        source: String(item?.source || 'assistant'),
        excerpt: String(item?.excerpt || item || ''),
        timestamp: item?.timestamp ? String(item.timestamp) : undefined,
        score: Number.isFinite(Number(item?.score)) ? Number(item.score) : undefined
      }))
      : [],
    uncertainties: normalizeStringArray(payload?.uncertainties),
    similarCases: context.similarChunks,
    provider,
    model,
    offline: false,
    createdAt: new Date().toISOString()
  }
}

function buildSearchQuery(data: ReplaySessionData, question: string) {
  return [
    question,
    ...data.overview.rootCauses.slice(0, 5).map((cause) => `${cause.title} ${cause.suggestion}`),
    ...data.overview.topIssues.slice(0, 10).map((event) => `${event.title} ${event.detail}`),
    ...(data.knowledgeMatches || []).slice(0, 5).map((match) => `${match.title} ${match.rootCause} ${match.solution}`)
  ].join('\n')
}

function extractQuestionKeywords(question: string): string[] {
  return Array.from(new Set((question.toLowerCase().match(/error\d{3,6}|[a-z0-9_]{3,}|[\u4e00-\u9fa5]{2,}/g) || []).slice(0, 20)))
}

function uniqueLines(lines: ParsedLogLine[]): ParsedLogLine[] {
  const seen = new Set<string>()
  const result: ParsedLogLine[] = []
  for (const line of lines) {
    const key = `${line.file}:${line.line}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(line)
  }
  return result
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min))
}
