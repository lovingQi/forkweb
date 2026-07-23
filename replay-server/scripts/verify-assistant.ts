import http from 'http'
import fs from 'fs/promises'
import path from 'path'
import { createKnowledgeRule, readKnowledgeLibrary, writeKnowledgeLibrary } from '../src/core/knowledgeBase'
import { buildAssistantContext, askReplayAssistant, recommendSimilarCases } from '../src/core/ragAssistant'
import { getAssistantStatus, getPublicLlmConfig } from '../src/core/llmConfig'
import { clearLlmLocalConfig, writeLlmLocalConfig } from '../src/core/llmConfigStore'
import { redactText } from '../src/core/redaction'
import { rebuildVectorStore } from '../src/core/vectorStore'
import { buildJsonReport } from '../src/core/report'
import { exportDiagnosticPackage } from '../src/core/diagnosticPackage'
import { ReplaySession } from '../src/core/session'
import { RawLogStore } from '../src/core/rawLogStore'
import type { ParsedLogLine } from '../src/types'

async function getSessionRawLines(session: ReplaySession): Promise<ParsedLogLine[]> {
  if (session.data.rawLines.length > 0) return session.data.rawLines
  if (session.data.rawLinesPath) {
    const store = RawLogStore.load(session.data.rawLinesPath)
    if (store) return store.readAll()
  }
  return []
}

async function main() {
  const originalEnv = snapshotDeepSeekEnv()
  const knowledgeBackup = await readKnowledgeLibrary()
  const knowledgePath = path.resolve(process.cwd(), 'replay-server/config/knowledge-base.json')
  const knowledgeBackupText = await fs.readFile(knowledgePath, 'utf8').catch(() => '')
  const knowledgeMtime = (await fs.stat(knowledgePath).catch(() => null))?.mtime || null
  const llmPath = path.resolve(process.cwd(), 'replay-server/config/llm.local.json')
  const llmBackupText = await fs.readFile(llmPath, 'utf8').catch(() => '')
  const llmMtime = (await fs.stat(llmPath).catch(() => null))?.mtime || null
  let mockServer: http.Server | null = null
  try {
    restoreDeepSeekEnv({})
    await clearLlmLocalConfig()
    await writeKnowledgeLibrary({ version: 1, updatedAt: '', rules: [] })

    const session = new ReplaySession()
    const data = await session.load({
      logDir: '/home/xbl/Desktop',
      mapDir: '/home/xbl/Desktop/jarvis-fork/params/map',
      forceReload: true
    })
    assert(data.overview.hasFrames, '样本日志应能正常解析，保证离线规则知识库不受助手影响')

    const rawLines = await getSessionRawLines(session)
    const evidence = pickEvidence(rawLines, ['get battery failed'], 3)
    assert(evidence.length > 0, '应能从当前日志中选出知识库证据')
    await createKnowledgeRule({
      id: 'verify-assistant-battery-knowledge',
      title: '验收助手：电池数据采集失败历史处理',
      description: '相似案例应能返回历史问题标题、处理办法和相似证据。',
      rootCause: '电池设备配置、驱动或通信链路异常。',
      solution: '检查电池设备配置、驱动启动状态和通信连接。',
      severity: 'warning',
      tags: ['assistant-acceptance', 'battery'],
      enabled: true,
      examples: [{
        id: 'verify-assistant-battery-example',
        title: '电池证据',
        note: '验收样本',
        lines: evidence,
        createdAt: new Date().toISOString()
      }],
      pattern: {
        requiredLineRegexes: [],
        requiredVehicleStates: [],
        requiredKeywords: ['get battery failed'],
        anyKeywords: ['battery does not exist'],
        excludedKeywords: [],
        modules: ['s_forklift'],
        levels: ['W'],
        errorCodes: [],
        windowSeconds: 10,
        minOccurrences: 1,
        confidenceBase: 0.72,
        confidenceWeights: []
      }
    })

    const offlineStatus = await getAssistantStatus()
    assert(offlineStatus.enabled === false, '未配置 DEEPSEEK_API_KEY 时应为离线模式')
    const offlineSession = new ReplaySession()
    const offlineData = await offlineSession.load({
      logDir: '/home/xbl/Desktop',
      mapDir: '/home/xbl/Desktop/jarvis-fork/params/map',
      forceReload: true
    })
    const offlineRawLines = await getSessionRawLines(offlineSession)
    assert(offlineData.knowledgeMatches?.some((match) => match.ruleId === 'verify-assistant-battery-knowledge'), '未配置 API Key 时规则知识库仍应正常命中')

    const store = await rebuildVectorStore()
    assert(store.chunks.some((chunk) => chunk.source.id === 'verify-assistant-battery-knowledge'), '向量索引应包含知识库规则')
    const similar = await recommendSimilarCases(offlineData, '电池采集失败怎么处理')
    const batterySimilar = similar.find((item) => item.chunk.source.id === 'verify-assistant-battery-knowledge')
    assert(batterySimilar, '相似案例推荐应返回历史知识条目')
    assert(batterySimilar.chunk.source.title.includes('电池数据采集失败'), '相似案例应包含历史问题标题')
    assert(Boolean(batterySimilar.chunk.source.solution), '相似案例应包含处理办法')
    assert((batterySimilar.chunk.source.evidence || []).length > 0 || batterySimilar.highlights.length > 0, '相似案例应包含相似证据')

    const context = await buildAssistantContext(offlineData, {
      question: '电池采集失败怎么处理？',
      includeLogs: true,
      maxLogLines: 20,
      maxKnowledge: 5
    })
    assert(context.logExcerpts.length <= 20, '请求上下文不应上传全量日志，应受 maxLogLines 限制')
    assert(context.logExcerpts.length < offlineRawLines.length, '请求上下文日志片段数量应小于全量日志')
    assert(context.knowledgeMatches.some((match) => match.ruleId === 'verify-assistant-battery-knowledge'), '上下文应包含知识库命中')
    assert(context.similarChunks.length <= 5, '知识上下文应受 maxKnowledge 限制')

    const redacted = redactText('/home/xbl/Desktop/log.log 192.168.1.10 1234567890123', {
      enabled: true,
      redactPaths: true,
      redactIp: true,
      redactLongIds: true,
      redactRobotName: false
    })
    assert(!redacted.includes('/home/xbl'), '路径应被脱敏')
    assert(!redacted.includes('192.168.1.10'), 'IP 应被脱敏')
    assert(!redacted.includes('1234567890123'), '长 ID 应被脱敏')

    const offlineAnswer = await askReplayAssistant(offlineData, {
      question: '这次问题最可能是什么？',
      includeLogs: true,
      maxLogLines: 20,
      maxKnowledge: 5
    })
    assert(offlineAnswer.offline === true && offlineAnswer.provider === 'offline', '未配置 Key 时问答应返回离线结果')
    assert(offlineAnswer.evidence.some((item) => item.source === 'knowledge_base'), '离线问答结果应引用知识库证据')

    mockServer = await startMockDeepSeekServer()
    process.env.DEEPSEEK_API_KEY = 'mock-key'
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${(mockServer.address() as any).port}`
    process.env.DEEPSEEK_MODEL = 'deepseek-chat'
    const onlineStatus = await getAssistantStatus()
    assert(onlineStatus.enabled === true, '配置 DeepSeek API Key 后助手应进入在线模式')
    const onlineAnswer = await askReplayAssistant(offlineData, {
      question: '电池采集失败怎么处理？',
      includeLogs: true,
      maxLogLines: 20,
      maxKnowledge: 5
    })
    assert(onlineAnswer.provider === 'deepseek' && onlineAnswer.offline === false, '配置 Key 后应能走在线自然语言问答链路')
    assert(onlineAnswer.evidence.some((item) => item.source === 'knowledge_base'), '在线问答结果应引用知识库条目')
    assert(onlineAnswer.evidence.some((item) => item.source === 'log'), '在线问答结果应引用当前日志证据')
    assert(onlineAnswer.similarCases.some((item) => item.chunk.source.id === 'verify-assistant-battery-knowledge'), '在线问答结果应返回相似案例')

    const beforeRules = (await readKnowledgeLibrary()).rules.length
    assert(offlineData.assistant?.lastAnswer, '问答结果应写入 session assistant 快照')
    const afterRules = (await readKnowledgeLibrary()).rules.length
    assert(afterRules === beforeRules, 'AI 建议不会自动写入知识库，必须人工确认')
    const json = buildJsonReport(offlineData) as any
    assert(json.assistant?.lastAnswer, 'JSON 报告应包含 assistant 快照')
    const localConfig = await writeLlmLocalConfig({
      provider: 'openai_compatible',
      apiKey: 'local-secret-123456',
      baseUrl: `http://127.0.0.1:${(mockServer.address() as any).port}/v1`,
      model: 'mock-compatible',
      timeoutMs: 30000,
      maxTokens: 500,
      temperature: 0.1
    })
    assert(localConfig.apiKey === 'local-secret-123456', '本地配置应保存完整 key 到后端文件')
    const publicConfig = await getPublicLlmConfig()
    assert(publicConfig.source === 'local_file', '保存本地配置后 public config 应来自 local_file')
    assert(publicConfig.apiKeyMasked === '****3456', '前端公开配置只能返回 masked key')
    assert(JSON.stringify(publicConfig).includes('local-secret-123456') === false, '前端公开配置不能返回完整 key')
    const localStatus = await getAssistantStatus()
    assert(localStatus.provider === 'openai_compatible' && localStatus.source === 'local_file', 'status 应使用前端保存的本地配置')
    const compatibleAnswer = await askReplayAssistant(offlineData, {
      question: '电池采集失败怎么处理？',
      includeLogs: true,
      maxLogLines: 10,
      maxKnowledge: 3
    })
    assert(compatibleAnswer.provider === 'openai_compatible' && compatibleAnswer.offline === false, '本地配置应支持 OpenAI Compatible 在线问答')
    const pkg = await exportDiagnosticPackage(offlineData)
    const packageText = await fs.readFile(pkg.file, 'latin1')
    assert(!packageText.includes('local-secret-123456'), '诊断包不应包含 API Key')
    assert(!packageText.includes('llm.local.json'), '诊断包不应包含 llm.local.json')

    console.log(JSON.stringify({
      accepted: true,
      onlineProvider: onlineAnswer.provider,
      offlineProvider: offlineAnswer.provider,
      contextLogLines: context.logExcerpts.length,
      totalLogLines: offlineRawLines.length,
      similarTitle: batterySimilar.chunk.source.title,
      similarSolution: batterySimilar.chunk.source.solution,
      localProvider: compatibleAnswer.provider,
      publicApiKeyMasked: publicConfig.apiKeyMasked,
      knowledgeRulesBeforeAfterAsk: [beforeRules, afterRules],
      redacted
    }, null, 2))
  } finally {
    if (mockServer) await new Promise<void>((resolve) => mockServer?.close(() => resolve()))
    if (knowledgeBackupText) await fs.writeFile(knowledgePath, knowledgeBackupText, 'utf8')
    else await writeKnowledgeLibrary(knowledgeBackup)
    if (knowledgeMtime) await fs.utimes(knowledgePath, knowledgeMtime, knowledgeMtime).catch(() => undefined)
    if (llmBackupText) await fs.writeFile(llmPath, llmBackupText, 'utf8')
    else await clearLlmLocalConfig()
    if (llmMtime) await fs.utimes(llmPath, llmMtime, llmMtime).catch(() => undefined)
    restoreDeepSeekEnv(originalEnv)
  }
}

function pickEvidence(rawLines: ParsedLogLine[], keywords: string[], limit: number): ParsedLogLine[] {
  return rawLines.filter((line) => keywords.some((keyword) => line.message.includes(keyword))).slice(0, limit)
}

function startMockDeepSeekServer(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      const userContent = String(parsed.messages?.find((item: any) => item.role === 'user')?.content || '')
      assert(userContent.includes('knowledgeMatches'), 'DeepSeek 请求上下文应包含知识库命中摘要')
      assert(!userContent.includes('/home/xbl/Desktop'), 'DeepSeek 请求上下文应完成路径脱敏')
      const content = JSON.stringify({
        answer: '根据当前日志和知识库，电池数据采集失败需要优先检查电池配置、驱动和通信链路。',
        rootCauseCandidates: ['电池设备配置或通信链路异常'],
        suggestions: ['检查电池设备配置、驱动启动状态和通信连接'],
        evidence: [
          {
            title: '验收助手：电池数据采集失败历史处理',
            source: 'knowledge_base',
            excerpt: '检查电池设备配置、驱动启动状态和通信连接'
          },
          {
            title: '当前日志 s_forklift',
            source: 'log',
            excerpt: 'FLTROS: get battery failed, battery does not exist!'
          }
        ],
        uncertainties: ['需要确认现场车型是否应上报电池数据']
      })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function snapshotDeepSeekEnv() {
  return {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL
  }
}

function restoreDeepSeekEnv(values: Record<string, string | undefined>) {
  for (const key of ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL']) {
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
