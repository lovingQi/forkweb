import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { ReplaySessionData } from '../types'

const CACHE_VERSION = 1
const CACHE_DIR = path.resolve(process.cwd(), 'replay-server/.cache')

export interface CacheInput {
  files: string[]
  mapDir?: string
  mapFile?: string
}

export async function buildCacheKey(input: CacheInput): Promise<string> {
  const fileStats = []
  for (const file of input.files) {
    const stat = await fs.stat(file)
    fileStats.push({ file, size: stat.size, mtimeMs: stat.mtimeMs })
  }
  const payload = JSON.stringify({
    version: CACHE_VERSION,
    files: fileStats,
    mapDir: input.mapDir || '',
    mapFile: input.mapFile || ''
  })
  return crypto.createHash('sha1').update(payload).digest('hex')
}

export async function readSessionCache(key: string): Promise<ReplaySessionData | null> {
  try {
    const text = await fs.readFile(cacheFile(key), 'utf8')
    const payload = JSON.parse(text)
    if (payload.version !== CACHE_VERSION) return null
    return payload.data as ReplaySessionData
  } catch {
    return null
  }
}

export async function writeSessionCache(key: string, data: ReplaySessionData): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  await fs.writeFile(cacheFile(key), JSON.stringify({ version: CACHE_VERSION, data }), 'utf8')
}

function cacheFile(key: string): string {
  return path.join(CACHE_DIR, `session-${key}.json`)
}
