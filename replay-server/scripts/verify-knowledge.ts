import fs from 'fs/promises'
import path from 'path'
import type { KnowledgeRule, ParsedLogLine } from '../src/types'
import {
  createKnowledgeRule,
  exportKnowledgeLibraryPayload,
  importKnowledgeLibraryPayload,
  matchKnowledgeRule,
  readKnowledgeLibrary,
  suggestKnowledgePattern,
  toggleKnowledgeRule,
  writeKnowledgeLibrary
} from '../src/core/knowledgeBase'
import { buildJsonReport, buildMarkdownReportAsync } from '../src/core/report'
import { ReplaySession } from '../src/core/session'
import { parseLogLine } from '../src/parser/logLine'
import { writeSessionCache } from '../src/core/cache'
import { parseVehicleState } from '../src/parser/vehicleState'
import { RawLogStore } from '../src/core/rawLogStore'

const LOG_DIR = '/home/xbl/Desktop'
const MAP_DIR = '/home/xbl/Desktop/jarvis-fork/params/map'
const KNOWLEDGE_PATH = path.resolve(process.cwd(), 'replay-server/config/knowledge-base.json')

async function getSessionRawLines(session: ReplaySession): Promise<ParsedLogLine[]> {
  if (session.data.rawLines.length > 0) return session.data.rawLines
  if (session.data.rawLinesPath) {
    const store = RawLogStore.load(session.data.rawLinesPath)
    if (store) return store.readAll()
  }
  return []
}

async function main() {
  const backup = await readKnowledgeLibrary()
  const backupText = await fs.readFile(KNOWLEDGE_PATH, 'utf8').catch(() => '')
  let baselineMtime: Date | null = null
  try {
    baselineMtime = (await fs.stat(KNOWLEDGE_PATH).catch(() => null))?.mtime || null
    await writeKnowledgeLibrary({ version: 1, updatedAt: '', rules: [] })

    verifyStrictLaserRule(backup)
    verifyStructuredRules(backup.rules)
    await verifyCacheFallback()

    const baselineSession = new ReplaySession()
    const baseline = await baselineSession.load({ logDir: LOG_DIR, mapDir: MAP_DIR, forceReload: true })
    const baselineRawLines = await getSessionRawLines(baselineSession)
    assert(baselineRawLines.length > 0, '应解析到原始日志行，供研发选择证据')

    const evidenceRules = buildRulesFromEvidence(baselineRawLines)
    assert(evidenceRules.length >= 3, '样本验证应准备至少 3 条知识库规则')

    for (const rule of evidenceRules) {
      const suggestion = suggestKnowledgePattern(rule.examples[0]?.lines || [])
      assert(suggestion.anyKeywords.length > 0 || suggestion.modules.length > 0, `${rule.title} 应能从证据提取候选规则`)
      const saved = await createKnowledgeRule(rule)
      assert(saved.id === rule.id, `${rule.title} 应能保存为知识条目`)
    }

    const directMatches = evidenceRules.map((rule) => matchKnowledgeRule(rule, baselineRawLines))
    assert(directMatches.every(Boolean), '3 条知识库规则直接试跑均应命中')

    const replaySession = new ReplaySession()
    const data = await replaySession.load({ logDir: LOG_DIR, mapDir: MAP_DIR, forceReload: true })
    const expectedIds = evidenceRules.map((rule) => rule.id)
    for (const id of expectedIds) {
      const match = data.knowledgeMatches?.find((item) => item.ruleId === id)
      assert(match, `重新解析同一份日志后应自动命中 ${id}`)
      assert(match.evidenceLines.length > 0, `${id} 命中结果应包含证据日志`)
      assert(match.confidence > 0, `${id} 命中结果应包含置信度`)
      assert(Boolean(match.solution), `${id} 命中结果应包含处理办法`)
    }
    assert(data.overview.rootCauses.some((cause) => cause.source === 'knowledge_base'), '知识库命中应出现在诊断结论中')
    for (const id of expectedIds) {
      assert(data.overview.rootCauses.some((cause) => cause.source === 'knowledge_base' && cause.knowledgeRuleId === id), `${id} 应标记来源为知识库`)
    }

    const markdown = await buildMarkdownReportAsync(data)
    assert(markdown.includes('## 知识库命中'), 'Markdown 报告应输出知识库命中小节')
    for (const rule of evidenceRules) {
      assert(markdown.includes(rule.title), `Markdown 报告应包含知识条目 ${rule.title}`)
      assert(markdown.includes(rule.solution), `Markdown 报告应包含 ${rule.title} 的处理办法`)
    }
    const json = buildJsonReport(data) as { knowledgeMatches?: unknown[] }
    assert(Array.isArray(json.knowledgeMatches), 'JSON 报告应输出 knowledgeMatches')
    assert((json.knowledgeMatches || []).length >= 3, 'JSON 报告应输出至少 3 条知识库命中')

    const disabled = await toggleKnowledgeRule(expectedIds[0], false)
    assert(disabled?.enabled === false, '应能禁用知识规则')
    const afterDisabledSession = new ReplaySession()
    const afterDisabled = await afterDisabledSession.load({ logDir: LOG_DIR, mapDir: MAP_DIR })
    assert(!afterDisabled.knowledgeMatches?.some((item) => item.ruleId === expectedIds[0]), '禁用后的知识规则不应参与诊断')
    assert(afterDisabled.knowledgeMatches?.some((item) => item.ruleId === expectedIds[1]), '禁用单条规则不应影响其他规则命中')

    await toggleKnowledgeRule(expectedIds[0], true)
    const exported = exportKnowledgeLibraryPayload(await readKnowledgeLibrary())
    assert(exported.rules.length === evidenceRules.length, '知识库导出应包含全部测试规则')
    await writeKnowledgeLibrary({ version: 1, updatedAt: '', rules: [] })
    const imported = await importKnowledgeLibraryPayload(exported, false)
    assert(imported.imported === evidenceRules.length, '知识库导入应导入全部测试规则')
    assert(imported.library.rules.length === evidenceRules.length, '导入后的知识库规则数量应正确')
    const afterImportSession = new ReplaySession()
    const afterImport = await afterImportSession.load({ logDir: LOG_DIR, mapDir: MAP_DIR, forceReload: true })
    for (const id of expectedIds) {
      assert(afterImport.knowledgeMatches?.some((item) => item.ruleId === id), `导入知识库后 ${id} 应仍可命中`)
    }

    console.log(JSON.stringify({
      accepted: true,
      rules: expectedIds.length,
      matches: data.knowledgeMatches?.length || 0,
      rootCauses: data.overview.rootCauses.filter((cause) => cause.source === 'knowledge_base').length,
      disabledRule: expectedIds[0],
      imported: imported.imported
    }, null, 2))
  } finally {
    if (backupText) {
      await fs.writeFile(KNOWLEDGE_PATH, backupText, 'utf8')
    } else {
      await writeKnowledgeLibrary(backup)
    }
    if (baselineMtime) await fs.utimes(KNOWLEDGE_PATH, baselineMtime, baselineMtime).catch(() => undefined)
  }
}

function buildRulesFromEvidence(rawLines: ParsedLogLine[]): KnowledgeRule[] {
  return [
    buildRule({
      id: 'verify-knowledge-map-io-area',
      title: '验收知识：地图缺少 IO 区域配置',
      description: '从 JObs 日志识别地图中缺少 IO sheild area 的配置提醒。',
      rootCause: '地图文件未配置 IO shield area，可能导致现场 IO 区域相关逻辑不可用。',
      solution: '检查现场地图 JSON 的 IO shield area 配置，必要时重新导出或补齐地图配置。',
      severity: 'warning',
      tags: ['acceptance', 'map'],
      lines: pickEvidence(rawLines, ['obs: the map', 'IO sheild area'], 3),
      pattern: {
        requiredLineRegexes: [],
        requiredVehicleStates: [],
        requiredKeywords: ['obs: the map'],
        anyKeywords: ['IO sheild area'],
        modules: ['JObs'],
        levels: ['D'],
        errorCodes: [],
        windowSeconds: 10,
        minOccurrences: 1,
        confidenceBase: 0.7,
        confidenceWeights: [
          { type: 'keyword', value: 'IO sheild area', weight: 0.12 },
          { type: 'module', value: 'JObs', weight: 0.08 }
        ]
      }
    }),
    buildRule({
      id: 'verify-knowledge-battery-missing',
      title: '验收知识：电池数据采集失败',
      description: '从 s_forklift 告警识别电池对象不存在或采集失败。',
      rootCause: '车辆电池配置、驱动或通信链路异常，导致 FLTROS 无法读取电池数据。',
      solution: '检查电池设备配置、驱动启动状态和通信连接，确认现场车型是否应上报电池数据。',
      severity: 'warning',
      tags: ['acceptance', 'battery'],
      lines: pickEvidence(rawLines, ['get battery failed'], 3),
      pattern: {
        requiredLineRegexes: [],
        requiredVehicleStates: [],
        requiredKeywords: ['get battery failed'],
        anyKeywords: ['battery does not exist'],
        modules: ['s_forklift'],
        levels: ['W'],
        errorCodes: [],
        windowSeconds: 10,
        minOccurrences: 1,
        confidenceBase: 0.72,
        confidenceWeights: [
          { type: 'keyword', value: 'get battery failed', weight: 0.14 },
          { type: 'module', value: 's_forklift', weight: 0.08 }
        ]
      }
    }),
    buildRule({
      id: 'verify-knowledge-empty-task-error-code',
      title: '验收知识：任务错误码为空',
      description: '从 error_code 日志识别 current_task_error_code 为空并被判定为无效任务错误码。',
      rootCause: '任务状态上报中没有携带有效任务错误码，可能掩盖真实任务失败原因。',
      solution: '结合任务前后日志检查任务失败链路，确认 current_task_error_code 的赋值与清空时机。',
      severity: 'info',
      tags: ['acceptance', 'task', 'error_code'],
      lines: pickEvidence(rawLines, ['current_task_error_code is', 'Invalid task error code'], 4),
      pattern: {
        requiredLineRegexes: [],
        requiredVehicleStates: [],
        requiredKeywords: ['current_task_error_code is'],
        anyKeywords: ['Invalid task error code'],
        modules: ['error_code'],
        levels: ['I', 'D'],
        errorCodes: [],
        windowSeconds: 3,
        minOccurrences: 2,
        confidenceBase: 0.68,
        confidenceWeights: [
          { type: 'keyword', value: 'current_task_error_code is', weight: 0.12 },
          { type: 'keyword', value: 'Invalid task error code', weight: 0.12 },
          { type: 'module', value: 'error_code', weight: 0.06 }
        ]
      }
    })
  ]
}

function verifyStrictLaserRule(library: { rules: KnowledgeRule[] }) {
  const rule = library.rules.find((item) => item.id === 'knowledge-bdd72dd5')
  assert(rule, '知识库应包含激光无数据规则')

  const falsePositiveLines = parseLines([
    '2026-07-20 11:55:19.569     FltTask: 1062 [D] : there is no need to update path',
    '2026-07-20 11:55:19.569  ltBackGoto: 1140 [D] : now the robot is going to path p77',
    '2026-07-20 11:55:19.569  JActSecure:  200 [D] : JActSecure-clearance1: FrontMin 400.00',
    '2026-07-20 11:55:20.269   FltStatus:  114 [D] : the estop is 0'
  ])
  assert(!matchKnowledgeRule(rule, falsePositiveLines), 'update/date、estop/stop、robot、JActSecure 和 D 级别组合不应误报激光无数据')

  const splitKeywordLines = parseLines([
    '2026-07-20 11:55:19.569  JActSecure:  108 [D] : laser[midfront_up] is enabled',
    '2026-07-20 11:55:19.669  JActSecure:  108 [D] : date outof date',
    '2026-07-20 11:55:19.769  JActSecure:  108 [D] : stop robot'
  ])
  assert(!matchKnowledgeRule(rule, splitKeywordLines), '核心关键词分散在不同日志行时不应命中激光无数据')

  const realFaultLine = parseLines([
    '2026-07-20 11:55:19.569  JActSecure:  108 [D] : laser[midfront_up] date outof date, stop robot'
  ])
  const match = matchKnowledgeRule(rule, realFaultLine)
  assert(match, '真实激光超时日志应命中激光无数据')
  assert(match.evidenceLines.length === 1 && match.evidenceLines[0].line === 1, '激光无数据证据应只包含核心故障日志行')
  assert(match.matchedPatterns.some((item) => item.startsWith('核心正则 ')), '命中结果应说明核心正则已触发')

  const duplicatedContext = [
    ...realFaultLine,
    ...Array.from({ length: 100 }, (_, index) => parseLine(
      `2026-07-20 11:55:20.${String(index).padStart(3, '0')}  JActSecure:  200 [D] : normal debug line ${index}`,
      index + 2
    ))
  ]
  const duplicateMatch = matchKnowledgeRule(rule, duplicatedContext)
  assert(duplicateMatch, '增加重复 D 级别上下文后真实故障仍应命中')
  assert(duplicateMatch.confidence === match.confidence, '重复 D 日志和模块上下文不应虚增置信度')

  const duplicatedWeightsRule: KnowledgeRule = {
    ...rule,
    pattern: {
      ...rule.pattern,
      confidenceWeights: [
        { type: 'module', value: 'JActSecure', weight: 0.08 },
        { type: 'module', value: 'JActSecure', weight: 0.08 }
      ]
    }
  }
  const singleWeightRule: KnowledgeRule = {
    ...duplicatedWeightsRule,
    pattern: {
      ...duplicatedWeightsRule.pattern,
      confidenceWeights: [{ type: 'module', value: 'JActSecure', weight: 0.08 }]
    }
  }
  assert(
    matchKnowledgeRule(duplicatedWeightsRule, realFaultLine)?.confidence === matchKnowledgeRule(singleWeightRule, realFaultLine)?.confidence,
    '重复置信度权重只能计算一次'
  )
}

function parseLines(rawLines: string[]): ParsedLogLine[] {
  return rawLines.map((raw, index) => parseLine(raw, index + 1))
}

function parseLine(raw: string, line: number): ParsedLogLine {
  const parsed = parseLogLine(raw, '/tmp/verify-knowledge.log', line)
  assert(parsed, `测试日志应能解析: ${raw}`)
  return parsed
}

function buildRule(input: Omit<KnowledgeRule, 'enabled' | 'verificationStatus' | 'scope' | 'examples' | 'hitCount' | 'recentHits' | 'createdAt' | 'updatedAt' | 'createdBy'> & {
  lines: ParsedLogLine[]
}): KnowledgeRule {
  assert(input.lines.length > 0, `${input.title} 应从原始日志中选到证据`)
  const now = new Date().toISOString()
  return {
    ...input,
    enabled: true,
    verificationStatus: 'sample_verified',
    scope: {},
    examples: [{
      id: `${input.id}-example`,
      title: '验收证据',
      note: '由专项验收脚本模拟研发从原始日志选择证据生成。',
      lines: input.lines,
      createdAt: now
    }],
    hitCount: 0,
    recentHits: [],
    createdAt: now,
    updatedAt: now,
    createdBy: 'verify-knowledge'
  }
}

function verifyStructuredRules(rules: KnowledgeRule[]) {
  const codeRules = rules.filter((rule) => rule.pattern.errorCodes.length > 0)
  assert(codeRules.length === 52, '应有 52 条结构化错误码规则')
  for (const rule of codeRules) {
    const code = rule.pattern.errorCodes[0]
    const definition = parseLine(`2026-07-21 10:00:00.000  error_code:  36 [I] : error_name,error_str=${code},{"error_description":"definition"}`, 1)
    const config = parseLine(`2026-07-21 10:00:00.100  JFault:  361 [W] : GrmFault: configure error for device error_code code ${code}.`, 2)
    assert(!matchKnowledgeRule(rule, {
      rawLines: [definition, config],
      errorOccurrences: [{ code, timestamp: config.timestamp, timeMs: config.timeMs, source: 'config_notice', kind: 'config_notice', line: config }],
      vehicleStateOccurrences: []
    }), `${rule.title} 不应被定义行或配置提醒触发`)
    const real = parseLine(`2026-07-21 10:00:01.000  error_code:  218 [I] : current_code is ${code}`, 3)
    const match = matchKnowledgeRule(rule, {
      rawLines: [real],
      errorOccurrences: [{ code, timestamp: real.timestamp, timeMs: real.timeMs, source: 'current_code', kind: 'real_fault', line: real }],
      vehicleStateOccurrences: []
    })
    assert(match?.evidenceLines[0]?.line === 3, `${rule.title} 应由真实错误码 occurrence 触发并返回真实证据`)
  }

  const stateRules = rules.filter((rule) => rule.pattern.requiredVehicleStates.length > 0)
  assert(stateRules.length === 8, '应有 8 条结构化车辆状态规则')
  for (const rule of stateRules) {
    const state = rule.pattern.requiredVehicleStates[0]
    const negative = parseLines([
      `2026-07-21 10:00:00.000  JFltState:  100 [I] : ${state} = 0`,
      '2026-07-21 10:00:00.100  JModeDrive:  212 [I] : No obs.Flt state is not FrontTruck or BackTruck or SideTruck or EStop.'
    ])
    assert(!matchKnowledgeRule(rule, negative), `${rule.title} 不应被正常值或否定文案触发`)
    const code = stateCode(state)
    const positive = parseLine(`2026-07-21 10:00:01.000  JFltState:  334 [D] : get flt state ${code}`, 3)
    const occurrence = parseVehicleState(positive)
    assert(occurrence, `${rule.title} 正样本车辆状态应可解析`)
    assert(matchKnowledgeRule(rule, {
      rawLines: [positive], errorOccurrences: [], vehicleStateOccurrences: [occurrence]
    }), `${rule.title} 应由结构化车辆状态触发`)
  }

  const pending = rules.filter((rule) => rule.verificationStatus === 'pending')
  assert(pending.length === 3 && pending.every((rule) => !rule.enabled), '3 条不可观测规则应标记待验证并禁用')
}

async function verifyCacheFallback() {
  const circular: any = { overview: {} }
  circular.self = circular
  const written = await writeSessionCache('verify-cache-fallback', circular)
  assert(written === false, '缓存序列化失败时应返回 false 而不是抛出异常')
}

function stateCode(state: string) {
  const mapping: Record<string, number> = {
    FrontTruck: 1, BackTruck: 2, SideTruck: 3, LeftTruck: 4, RightTruck: 5, LowPower: 12,
    ForkTipActive: 19, EStopEnable: 24, CollisionStrip: 27, SaftyActive: 30, EStop: 37
  }
  return mapping[state]
}

function pickEvidence(rawLines: ParsedLogLine[], keywords: string[], limit: number): ParsedLogLine[] {
  return rawLines
    .filter((line) => keywords.some((keyword) => line.message.includes(keyword)))
    .slice(0, limit)
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
