import type { KnowledgeMatch, RootCauseCandidate } from '../types'
import { knowledgeMatchToRootCauseCandidate } from './knowledgeBase'
import { ROOT_CAUSE_RULES, type RootCauseContext } from './rootCauseRules'

export function buildRootCauses(ctx: RootCauseContext, knowledgeMatches: KnowledgeMatch[] = []): RootCauseCandidate[] {
  const candidates = ROOT_CAUSE_RULES.map((rule) => {
    const candidate = rule.build(ctx)
    return candidate ? applyConfidence({ ...candidate, source: candidate.source || 'built_in' }, rule.weight) : null
  }).filter(Boolean) as RootCauseCandidate[]

  const knowledgeCandidates = knowledgeMatches.map(knowledgeMatchToRootCauseCandidate)
  return [...candidates, ...knowledgeCandidates]
    .sort((a, b) => severityScore(b.severity) - severityScore(a.severity) || b.confidence - a.confidence)
}

function applyConfidence(candidate: RootCauseCandidate, weight: number): RootCauseCandidate {
  const evidenceCount = candidate.evidenceEvents.length + candidate.evidenceLines.length
  const evidenceBoost = Math.min(0.12, evidenceCount * 0.015)
  const timeBoost = candidate.evidenceEvents.length > 0 && candidate.evidenceLines.length > 0 ? 0.04 : 0
  const confidence = Math.max(0, Math.min(0.98, (candidate.confidence + evidenceBoost + timeBoost) * weight))
  return {
    ...candidate,
    confidence,
    confidenceFactors: [
      ...(candidate.confidenceFactors || []),
      `规则权重 ${weight}`,
      `证据数量 ${evidenceCount}`,
      evidenceBoost ? `证据加成 ${Math.round(evidenceBoost * 100)}%` : '',
      timeBoost ? '同时包含事件和日志证据' : ''
    ].filter(Boolean)
  }
}

function severityScore(severity: RootCauseCandidate['severity']): number {
  if (severity === 'error') return 3
  if (severity === 'warning') return 2
  return 1
}
