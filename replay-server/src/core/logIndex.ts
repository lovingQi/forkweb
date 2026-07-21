import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { CACHE_DIR } from '../paths'
import type { ErrorCodeDefinition, ErrorOccurrence, ParsedLogLine, ReplayFrame } from '../types'

export const LOG_INDEX_VERSION = 1
const INDEX_DIR = path.join(CACHE_DIR, 'indexes')

export interface LogIndexPayload {
  version: number
  fingerprint: string
  file: string
  rawLines: ParsedLogLine[]
  frames: ReplayFrame[]
  definitions: ErrorCodeDefinition[]
  occurrences: ErrorOccurrence[]
}

export async function fileFingerprint(file: string): Promise<string> {
  const stat = await fs.stat(file)
  const payload = `${file}:${stat.size}:${stat.mtimeMs}`
  return crypto.createHash('sha1').update(payload).digest('hex')
}

export async function readLogIndex(file: string): Promise<LogIndexPayload | null> {
  try {
    const fingerprint = await fileFingerprint(file)
    const text = await fs.readFile(indexFile(fingerprint), 'utf8')
    const payload = JSON.parse(text) as LogIndexPayload
    if (payload.version !== LOG_INDEX_VERSION || payload.fingerprint !== fingerprint) return null
    return payload
  } catch {
    return null
  }
}

export async function writeLogIndex(payload: Omit<LogIndexPayload, 'version'>): Promise<void> {
  await fs.mkdir(INDEX_DIR, { recursive: true })
  await fs.writeFile(indexFile(payload.fingerprint), `${JSON.stringify({ ...payload, version: LOG_INDEX_VERSION })}\n`, 'utf8')
}

function indexFile(fingerprint: string): string {
  return path.join(INDEX_DIR, `log-index-${fingerprint}.json`)
}
