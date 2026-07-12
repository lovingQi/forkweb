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

const LOG_DIR = '/home/xbl/Desktop'
const MAP_DIR = '/home/xbl/Desktop/jarvis-fork/params/map'
const KNOWLEDGE_PATH = path.resolve(process.cwd(), 'replay-server/config/knowledge-base.json')

async function main() {
  const backup = await readKnowledgeLibrary()
  const backupText = await fs.readFile(KNOWLEDGE_PATH, 'utf8').catch(() => '')
  let baselineMtime: Date | null = null
  try {
    baselineMtime = (await fs.stat(KNOWLEDGE_PATH).catch(() => null))?.mtime || null
    await writeKnowledgeLibrary({ version: 1, updatedAt: '', rules: [] })

    const baselineSession = new ReplaySession()
    const baseline = await baselineSession.load({ logDir: LOG_DIR, mapDir: MAP_DIR, forceReload: true })
    assert(baseline.rawLines.length > 0, '应解析到原始日志行，供研发选择证据')

    const evidenceRules = buildRulesFromEvidence(baseline.rawLines)
    assert(evidenceRules.length >= 3, '样本验证应准备至少 3 条知识库规则')

    for (const rule of evidenceRules) {
      const suggestion = suggestKnowledgePattern(rule.examples[0]?.lines || [])
      assert(suggestion.anyKeywords.length > 0 || suggestion.modules.length > 0, `${rule.title} 应能从证据提取候选规则`)
      const saved = await createKnowledgeRule(rule)
      assert(saved.id === rule.id, `${rule.title} 应能保存为知识条目`)
    }

    const directMatches = evidenceRules.map((rule) => matchKnowledgeRule(rule, baseline.rawLines))
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
    const afterDisabled = await afterDisabledSession.load({ logDir: LOG_DIR, mapDir: MAP_DIR, forceReload: true })
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

function buildRule(input: Omit<KnowledgeRule, 'enabled' | 'scope' | 'examples' | 'hitCount' | 'recentHits' | 'createdAt' | 'updatedAt' | 'createdBy'> & {
  lines: ParsedLogLine[]
}): KnowledgeRule {
  assert(input.lines.length > 0, `${input.title} 应从原始日志中选到证据`)
  const now = new Date().toISOString()
  return {
    ...input,
    enabled: true,
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

function pickEvidence(rawLines: ParsedLogLine[], keywords: string[], limit: number): ParsedLogLine[] {
  return rawLines
    .filter((line) => keywords.some((keyword) => line.raw.includes(keyword)))
    .slice(0, limit)
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
