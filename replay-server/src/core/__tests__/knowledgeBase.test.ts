import { describe, it, expect } from 'vitest'
import { matchKnowledgeRule } from '../knowledgeBase'
import type { KnowledgeRule, ParsedLogLine } from '../../types'

function makeLine(message: string, timeMs = 1000, overrides?: Partial<ParsedLogLine>): ParsedLogLine & { globalIndex: number } {
  return {
    file: 'test.log',
    line: 1,
    timestamp: '2024-01-01 10:00:00.000',
    timeMs,
    module: 'TestModule',
    sourceLine: null,
    level: 'I',
    message,
    globalIndex: 0,
    ...overrides
  }
}

function makeRule(patternOverrides: Partial<KnowledgeRule['pattern']> = {}, ruleOverrides: Partial<KnowledgeRule> = {}): KnowledgeRule {
  return {
    id: 'test-rule-1',
    title: 'Test Rule',
    description: 'A test rule',
    severity: 'warning',
    enabled: true,
    status: 'verified',
    pattern: {
      requiredLineRegexes: [],
      requiredVehicleStates: [],
      requiredKeywords: [],
      anyKeywords: [],
      excludedKeywords: [],
      modules: [],
      levels: [],
      errorCodes: [],
      ...patternOverrides
    },
    rootCause: 'Test root cause',
    solution: 'Fix it',
    scope: 'all',
    tags: [],
    examples: [],
    hitCount: 0,
    createdAt: '2024-01-01',
    updatedAt: '2024-01-01',
    ...ruleOverrides
  } as any
}

describe('matchKnowledgeRule', () => {
  it('matches a rule when anyKeywords are found in log lines', () => {
    const rule = makeRule({ anyKeywords: ['motor fault'] })
    const lines = [
      makeLine('System starting up'),
      makeLine('motor fault detected at position 100'),
      makeLine('Recovery initiated')
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).not.toBeNull()
    expect(result!.ruleId).toBe('test-rule-1')
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('returns null when no keywords match', () => {
    const rule = makeRule({ anyKeywords: ['nuclear meltdown'] })
    const lines = [
      makeLine('Everything is running smoothly'),
      makeLine('Task completed successfully')
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).toBeNull()
  })

  it('respects minOccurrences', () => {
    const rule = makeRule({ anyKeywords: ['timeout'], minOccurrences: 3 })
    const lines = [
      makeLine('timeout on network'),
      makeLine('timeout again')
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).toBeNull()
  })

  it('matches when minOccurrences threshold is met', () => {
    const rule = makeRule({ anyKeywords: ['timeout'], minOccurrences: 2 })
    const lines = [
      makeLine('timeout on network', 1000),
      makeLine('timeout again', 1500),
      makeLine('system recovered', 2000)
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).not.toBeNull()
  })

  it('respects excludedKeywords', () => {
    const rule = makeRule({ anyKeywords: ['ERROR1001'], excludedKeywords: ['configure error'] })
    const lines = [
      makeLine('GrmFault: configure error for device error_code code ERROR1001')
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).toBeNull()
  })

  it('matches with requiredKeywords when all present', () => {
    const rule = makeRule({
      anyKeywords: ['fault'],
      requiredKeywords: ['motor', 'driver']
    })
    const lines = [
      makeLine('motor fault detected', 1000),
      makeLine('driver error in motor subsystem', 1200)
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).not.toBeNull()
  })

  it('returns null when requiredKeywords not all present', () => {
    const rule = makeRule({
      anyKeywords: ['fault'],
      requiredKeywords: ['motor', 'laser']
    })
    const lines = [
      makeLine('motor fault detected', 1000),
      makeLine('driver error in motor subsystem', 1200)
    ]
    const result = matchKnowledgeRule(rule, lines)
    expect(result).toBeNull()
  })
})
