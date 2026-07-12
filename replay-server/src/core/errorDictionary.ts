import fs from 'fs/promises'
import path from 'path'
import type { ErrorCodeDefinition } from '../types'
import { enrichDictionarySource } from './errorDictionarySources'

export const ERROR_CODE_RE = /E?ERROR\d{4,5}/g
const MANUAL_DICTIONARY_FILE = path.resolve(process.cwd(), 'replay-server/config/manual-error-dictionary.json')
const DEFAULT_SOURCE_DIR = '/home/xbl/Desktop/jarvis-fork'
const MAX_FILES = 3000
const MAX_FILE_SIZE = 2_000_000
const SOURCE_EXT = new Set(['.c', '.cc', '.cpp', '.h', '.hpp', '.ts', '.js', '.json', '.yaml', '.yml', '.txt'])

export async function loadSourceErrorDictionary(sourceDir = DEFAULT_SOURCE_DIR): Promise<Map<string, ErrorCodeDefinition>> {
  const result = new Map<string, ErrorCodeDefinition>()
  const files = await listSourceFiles(sourceDir)
  for (const file of files) {
    let text = ''
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE_SIZE) continue
      text = await fs.readFile(file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      for (const match of line.matchAll(ERROR_CODE_RE)) {
        const code = match[0]
        if (result.has(code)) continue
        const context = extractContext(lines, index)
        result.set(code, enrichDictionarySource({
          code,
          description: guessDescription(context, code),
          source: 'source',
          sourceFile: file,
          sourceLine: index + 1,
          dictionaryConfidence: context.includes('error_description') ? 0.8 : 0.45,
          raw: { context }
        }, context.includes('error_description') ? 'source_config' : 'source_scan', context.includes('error_description') ? '源码上下文包含 error_description' : '源码扫描到 ERRORxxxx'))
      }
    }
  }
  return result
}

export async function loadManualErrorDictionary(): Promise<Map<string, ErrorCodeDefinition>> {
  const result = new Map<string, ErrorCodeDefinition>()
  let payload: any
  try {
    payload = JSON.parse(await fs.readFile(MANUAL_DICTIONARY_FILE, 'utf8'))
  } catch {
    return result
  }
  const codes = Array.isArray(payload.codes) ? payload.codes : []
  for (const item of codes) {
    const code = String(item.code || '').trim()
    if (!code) continue
    const definition = enrichDictionarySource({
      code,
      content: stringOrUndefined(item.content),
      description: stringOrUndefined(item.content),
      screenText: stringOrUndefined(item.screenText),
      troubleshooting: stringOrUndefined(item.troubleshooting),
      aliases: Array.isArray(item.aliases) ? item.aliases.map((alias: unknown) => String(alias || '').trim()).filter(Boolean) : [],
      manual: true,
      module: stringOrUndefined(item.module),
      severity: normalizeSeverity(item.severity),
      notes: stringOrUndefined(item.notes),
      source: 'source',
      sourceFile: MANUAL_DICTIONARY_FILE,
      dictionaryConfidence: 1,
      raw: item
    }, 'manual', '人工维护错误码字典')
    result.set(code, definition)
  }
  return result
}

async function listSourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  async function walk(dir: string) {
    if (files.length >= MAX_FILES) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'build') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name))) files.push(full)
    }
  }
  await walk(root)
  return files
}

function extractContext(lines: string[], index: number): string {
  return lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join('\n').trim()
}

function guessDescription(context: string, code: string): string | undefined {
  const jsonDesc = context.match(/"error_description"\s*:\s*"([^"]+)"/)
  if (jsonDesc?.[1]) return jsonDesc[1]
  const afterCode = context.match(new RegExp(`${code}[^\\n"]*["']([^"']{8,160})["']`))
  if (afterCode?.[1]) return afterCode[1]
  return undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeSeverity(value: unknown): ErrorCodeDefinition['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error'
}
