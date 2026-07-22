import type { DbAnalysisVersion } from '../db/analysisVersions';
import type { DbTicket } from '../db/tickets';
import type { KnowledgeMatch, ReplaySessionData } from '../types';

export interface TroubleshootingPathCandidate {
  ruleId: string;
  title: string;
  priority: number;
  confidence: number;
  severity: 'info' | 'warning' | 'error';
  suggestion: string;
  description: string;
  rootCause: string;
  solution: string;
  tags: string[];
  matchedPatterns: string[];
  evidenceLines: any[];
  guideSteps: Array<{
    stepNo: number;
    title: string;
    instruction?: string;
    criteria?: string;
    stepType: 'readonly_check' | 'field_operation' | 'rd_required';
    estimatedTime?: string;
    evidenceConfig?: Record<string, unknown>;
    isCritical: boolean;
    failureAction?: string;
  }>;
}

function severityScore(severity: 'info' | 'warning' | 'error'): number {
  if (severity === 'error') return 3;
  if (severity === 'warning') return 2;
  return 1;
}

function isBlockingOrSafety(match: KnowledgeMatch): boolean {
  const text = `${match.title} ${match.suggestion} ${match.tags.join(' ')}`.toLowerCase();
  return /(阻塞|安全|急停|estop|碰撞|collision|任务失败|task failed|无法运行)/.test(text);
}

function timeProximityScore(match: KnowledgeMatch, occurredStartMs?: number, occurredEndMs?: number): number {
  if (!occurredStartMs || !occurredEndMs || match.evidenceLines.length === 0) return 0;
  const evidenceTimes = match.evidenceLines
    .map((line: any) => line.timeMs)
    .filter((t): t is number => typeof t === 'number');
  if (evidenceTimes.length === 0) return 0;
  const avgTime = evidenceTimes.reduce((a, b) => a + b, 0) / evidenceTimes.length;
  if (avgTime >= occurredStartMs && avgTime <= occurredEndMs) return 1;
  const minDistance = Math.min(...evidenceTimes.map((t) => Math.min(Math.abs(t - occurredStartMs), Math.abs(t - occurredEndMs))));
  if (minDistance < 60_000) return 0.5;
  return 0;
}

export function generateTroubleshootingPaths(
  sessionData: ReplaySessionData,
  ticket: DbTicket,
  _analysisVersion: DbAnalysisVersion
): TroubleshootingPathCandidate[] {
  const matches = (sessionData.knowledgeMatches || []).filter(
    (match) => match.ruleSnapshot.publicationStatus === 'verified'
  );

  const occurredStartMs = ticket.occurred_start_at ? new Date(ticket.occurred_start_at).getTime() : undefined;
  const occurredEndMs = ticket.occurred_end_at ? new Date(ticket.occurred_end_at).getTime() : undefined;

  const scored = matches.map((match) => {
    const score =
      severityScore(match.severity) * 100 +
      (isBlockingOrSafety(match) ? 50 : 0) +
      match.confidence * 30 +
      timeProximityScore(match, occurredStartMs, occurredEndMs) * 20;
    return { match, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item, idx) => ({
      ruleId: item.match.ruleId,
      title: item.match.title,
      priority: idx,
      confidence: item.match.confidence,
      severity: item.match.severity,
      suggestion: item.match.suggestion,
      description: item.match.description,
      rootCause: item.match.rootCause,
      solution: item.match.solution,
      tags: item.match.tags,
      matchedPatterns: item.match.matchedPatterns,
      evidenceLines: item.match.evidenceLines,
      guideSteps: (item.match.ruleSnapshot.guideSteps || []).map((step) => ({
        stepNo: step.stepNo,
        title: step.title,
        instruction: step.instruction,
        criteria: step.criteria,
        stepType: step.stepType,
        estimatedTime: step.estimatedTime,
        evidenceConfig: step.evidenceConfig,
        isCritical: step.isCritical,
        failureAction: step.failureAction
      }))
    }));
}
