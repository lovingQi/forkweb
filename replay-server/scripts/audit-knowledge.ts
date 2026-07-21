import fs from 'fs/promises'
import path from 'path'
import { matchKnowledgeRule, readKnowledgeLibrary } from '../src/core/knowledgeBase'
import { parseLogLine } from '../src/parser/logLine'
import type {
  ErrorOccurrence,
  KnowledgeMatchContext,
  KnowledgeRule,
  ParsedLogLine,
  VehicleStateOccurrence
} from '../src/types'

const JSON_REPORT = path.resolve(process.cwd(), 'replay-server/.cache/knowledge-audit.json')
const MARKDOWN_REPORT = path.resolve(process.cwd(), 'docs/knowledge-audit-report.md')

async function main() {
  const library = await readKnowledgeLibrary()
  const results = library.rules.map(auditRule)
  const summary = {
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    sampleVerified: results.filter((item) => item.verificationStatus === 'sample_verified').length,
    structureGuarded: results.filter((item) => item.verificationStatus === 'structure_guarded').length,
    pending: results.filter((item) => item.verificationStatus === 'pending').length
  }
  const report = { generatedAt: new Date().toISOString(), summary, rules: results }
  await fs.mkdir(path.dirname(JSON_REPORT), { recursive: true })
  await fs.writeFile(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await fs.writeFile(MARKDOWN_REPORT, buildMarkdown(report), 'utf8')
  console.log(JSON.stringify(summary, null, 2))
  if (summary.failed > 0) process.exitCode = 1
}

function auditRule(rule: KnowledgeRule) {
  const issues: string[] = []
  const pattern = rule.pattern
  const hasRegex = pattern.requiredLineRegexes.length > 0
  const hasErrorCode = pattern.errorCodes.length > 0
  const hasVehicleState = pattern.requiredVehicleStates.length > 0
  const hasHardCondition = hasRegex || hasErrorCode || hasVehicleState
  if (rule.enabled && !hasHardCondition) issues.push('启用规则缺少结构化硬条件或核心正则')
  if (rule.verificationStatus === 'pending' && rule.enabled) issues.push('待验证规则不应启用')
  if (rule.verificationStatus === 'sample_verified' && rule.examples.length === 0) issues.push('样本已验证规则缺少保存的样本')

  const definitionContext = buildDefinitionContext(pattern.errorCodes)
  const configContext = buildConfigContext(pattern.errorCodes)
  const negativeStateContext = buildNegativeStateContext(pattern.requiredVehicleStates)
  if (matchKnowledgeRule(rule, definitionContext)) issues.push('错误码定义行会误触发')
  if (matchKnowledgeRule(rule, configContext)) issues.push('错误码配置提醒会误触发')
  if (matchKnowledgeRule(rule, negativeStateContext)) issues.push('正常值或否定状态文案会误触发')

  const positiveContext = buildPositiveContext(rule)
  if (rule.enabled && hasHardCondition && !matchKnowledgeRule(rule, positiveContext)) issues.push('合成正样本未命中')

  return {
    id: rule.id,
    title: rule.title,
    enabled: rule.enabled,
    verificationStatus: rule.verificationStatus,
    hardConditions: {
      regexes: pattern.requiredLineRegexes,
      errorCodes: pattern.errorCodes,
      vehicleStates: pattern.requiredVehicleStates
    },
    passed: issues.length === 0,
    issues
  }
}

function buildDefinitionContext(codes: string[]): KnowledgeMatchContext {
  const lines = codes.map((code, index) => line(`error_name,error_str=${code},{"error_description":"definition only"}`, index + 1, 'error_code'))
  return { rawLines: lines, errorOccurrences: [], vehicleStateOccurrences: [] }
}

function buildConfigContext(codes: string[]): KnowledgeMatchContext {
  const lines = codes.map((code, index) => line(`GrmFault: configure error for device error_code code ${code}.`, index + 1, 'JFault'))
  const errorOccurrences = lines.map((item, index): ErrorOccurrence => ({
    code: codes[index], timestamp: item.timestamp, timeMs: item.timeMs, source: 'config_notice', kind: 'config_notice', line: item
  }))
  return { rawLines: lines, errorOccurrences, vehicleStateOccurrences: [] }
}

function buildNegativeStateContext(states: string[]): KnowledgeMatchContext {
  const raw = [
    line('mInFrontTruck = 0.', 1, 'JActSecure'),
    line('the estop is 0', 2, 'FltStatus'),
    line('No obs.Flt state is not FrontTruck or BackTruck or SideTruck or EStop.', 3, 'JModeDrive'),
    ...states.map((state, index) => line(`${state} = 0`, index + 4, 'JFltState'))
  ]
  return { rawLines: raw, errorOccurrences: [], vehicleStateOccurrences: [] }
}

function buildPositiveContext(rule: KnowledgeRule): KnowledgeMatchContext {
  const rawLines: ParsedLogLine[] = []
  const errorOccurrences: ErrorOccurrence[] = []
  const vehicleStateOccurrences: VehicleStateOccurrence[] = []
  let lineNumber = 1
  for (const regex of rule.pattern.requiredLineRegexes) {
    const example = rule.examples.flatMap((item) => item.lines).find((item) => new RegExp(regex, 'i').test(item.raw))
    if (example) rawLines.push(example)
  }
  for (const code of rule.pattern.errorCodes) {
    const item = line(`current_code is ${code}`, lineNumber++, 'error_code')
    rawLines.push(item)
    errorOccurrences.push({ code, timestamp: item.timestamp, timeMs: item.timeMs, source: 'current_code', kind: 'real_fault', line: item })
  }
  for (const state of rule.pattern.requiredVehicleStates) {
    const stateCode = vehicleStateCode(state)
    const item = line(`get flt state ${stateCode}`, lineNumber++, 'JFltState')
    rawLines.push(item)
    vehicleStateOccurrences.push({ state, stateCode, timestamp: item.timestamp, timeMs: item.timeMs, line: item })
  }
  return { rawLines, errorOccurrences, vehicleStateOccurrences }
}

function vehicleStateCode(state: string): number {
  const mapping: Record<string, number> = {
    FrontTruck: 1, BackTruck: 2, SideTruck: 3, LeftTruck: 4, RightTruck: 5, LowPower: 12,
    ForkTipActive: 19, EStopEnable: 24, CollisionStrip: 27, SaftyActive: 30, EStop: 37
  }
  return mapping[state] || -1
}

function line(message: string, lineNumber: number, module = 'verify'): ParsedLogLine {
  const raw = `2026-07-21 10:00:${String(lineNumber % 60).padStart(2, '0')}.000  ${module}:  100 [I] : ${message}`
  const parsed = parseLogLine(raw, '/tmp/knowledge-audit.log', lineNumber)
  if (!parsed) throw new Error(`无法解析审计日志: ${raw}`)
  return parsed
}

function buildMarkdown(report: any): string {
  const lines = [
    '# 诊断知识库审计报告', '',
    `- 生成时间: ${report.generatedAt}`,
    `- 规则总数: ${report.summary.total}`,
    `- 通过: ${report.summary.passed}`,
    `- 失败: ${report.summary.failed}`,
    `- 样本已验证: ${report.summary.sampleVerified}`,
    `- 结构已保护: ${report.summary.structureGuarded}`,
    `- 待验证: ${report.summary.pending}`, '',
    '| 规则 | 启用 | 验证状态 | 结果 | 问题 |',
    '|---|---:|---|---|---|'
  ]
  for (const item of report.rules) {
    lines.push(`| ${item.title} | ${item.enabled ? '是' : '否'} | ${item.verificationStatus} | ${item.passed ? '通过' : '失败'} | ${item.issues.join('；') || '-'} |`)
  }
  return `${lines.join('\n')}\n`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
