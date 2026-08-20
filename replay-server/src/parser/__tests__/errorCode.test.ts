import { describe, it, expect } from 'vitest'
import { parseErrorDefinition, parseErrorOccurrences } from '../errorCode'
import type { ErrorCodeDefinition, ParsedLogLine } from '../../types'

function makeLine(message: string, overrides?: Partial<ParsedLogLine>): ParsedLogLine {
  return {
    file: 'test.log',
    line: 1,
    timestamp: '2024-01-01 10:00:00.000',
    timeMs: 1000,
    module: 'TestModule',
    sourceLine: null,
    level: 'E',
    message,
    ...overrides
  }
}

describe('parseErrorDefinition', () => {
  it('parses a complete error definition line', () => {
    const msg = 'error_name,error_str=ERROR1001,{"error_description":"Motor fault","error_level":2,"to_rms":true,"to_screen":true,"to_warn":false}'
    const result = parseErrorDefinition(makeLine(msg))
    expect(result).not.toBeNull()
    expect(result!.code).toBe('ERROR1001')
    expect(result!.description).toBe('Motor fault')
    expect(result!.level).toBe(2)
    expect(result!.toRms).toBe(true)
    expect(result!.source).toBe('log')
  })

  it('handles EERROR prefix', () => {
    const msg = 'error_name,error_str=EERROR2003,{"error_description":"Sensor offline","error_level":3}'
    const result = parseErrorDefinition(makeLine(msg))
    expect(result).not.toBeNull()
    expect(result!.code).toBe('EERROR2003')
  })

  it('returns null for non-definition lines', () => {
    expect(parseErrorDefinition(makeLine('Normal log message'))).toBeNull()
    expect(parseErrorDefinition(makeLine('ERROR1001 occurred'))).toBeNull()
  })

  it('handles malformed JSON gracefully', () => {
    const msg = 'error_name,error_str=ERROR5001,{invalid json}'
    const result = parseErrorDefinition(makeLine(msg))
    expect(result).not.toBeNull()
    expect(result!.code).toBe('ERROR5001')
    expect(result!.dictionaryConfidence).toBeLessThan(1)
  })
})

describe('parseErrorOccurrences', () => {
  const definitions = new Map<string, ErrorCodeDefinition>()

  it('detects error codes in log messages', () => {
    const line = makeLine('Task failed with ERROR1001 and ERROR2002')
    const results = parseErrorOccurrences(line, definitions)
    expect(results).toHaveLength(2)
    expect(results[0].code).toBe('ERROR1001')
    expect(results[1].code).toBe('ERROR2002')
  })

  it('deduplicates same code within one line', () => {
    const line = makeLine('ERROR1001 appeared again ERROR1001')
    const results = parseErrorOccurrences(line, definitions)
    expect(results).toHaveLength(1)
  })

  it('skips definition lines', () => {
    const msg = 'error_name,error_str=ERROR1001,{"error_description":"test"}'
    const results = parseErrorOccurrences(makeLine(msg), definitions)
    expect(results).toHaveLength(0)
  })

  it('attaches task ID when provided', () => {
    const line = makeLine('current_task_error_code ERROR3001')
    const results = parseErrorOccurrences(line, definitions, 'task-42')
    expect(results).toHaveLength(1)
    expect(results[0].taskId).toBe('task-42')
    expect(results[0].kind).toBe('real_fault')
  })

  it('classifies config_notice kind', () => {
    const line = makeLine('GrmFault: configure error for device error_code code ERROR4001 ...')
    const results = parseErrorOccurrences(line, definitions)
    expect(results).toHaveLength(1)
    expect(results[0].kind).toBe('config_notice')
  })

  it('returns empty array when no error codes found', () => {
    const results = parseErrorOccurrences(makeLine('Everything is fine'), definitions)
    expect(results).toHaveLength(0)
  })
})
