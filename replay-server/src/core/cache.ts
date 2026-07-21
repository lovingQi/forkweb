import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { CACHE_DIR } from '../paths'
import type { ReplaySessionData } from '../types'

const CACHE_VERSION = 3
const CACHE_ROOT_DIR = CACHE_DIR
const DEFAULT_MAX_AGE_DAYS = 14
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

export interface CacheBucketSummary {
  key: string
  label: string
  dir: string
  files: number
  bytes: number
  note?: string
}

export interface CacheSummary {
  version: number
  dir: string
  files: number
  bytes: number
  maxAgeDays: number
  maxBytes: number
  cleanupAdvice: string[]
  buckets: CacheBucketSummary[]
}

export interface CacheInput {
  files: string[]
  mapDir?: string
  mapFile?: string
  knowledgeFingerprint?: string
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
    mapFile: input.mapFile || '',
    knowledgeFingerprint: input.knowledgeFingerprint || ''
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

export async function writeSessionCache(key: string, data: ReplaySessionData): Promise<boolean> {
  await fs.mkdir(CACHE_ROOT_DIR, { recursive: true })
  const target = cacheFile(key)
  const temporary = `${target}.${process.pid}.tmp`
  try {
    const payload = JSON.stringify({ version: CACHE_VERSION, data })
    await fs.writeFile(temporary, payload, 'utf8')
    await fs.rename(temporary, target)
    return true
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    await fs.rm(target, { force: true }).catch(() => undefined)
    return false
  }
}

export async function getCacheSummary(): Promise<CacheSummary> {
  const buckets = await Promise.all(cacheBuckets().map(async (bucket) => summarizeBucket(bucket)))
  const files = await listFiles(CACHE_ROOT_DIR)
  let bytes = 0
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null)
    bytes += stat?.size || 0
  }
  return {
    version: CACHE_VERSION,
    dir: CACHE_ROOT_DIR,
    files: files.length,
    bytes,
    maxAgeDays: Number(process.env.REPLAY_CACHE_MAX_AGE_DAYS || DEFAULT_MAX_AGE_DAYS),
    maxBytes: Number(process.env.REPLAY_CACHE_MAX_BYTES || DEFAULT_MAX_BYTES),
    cleanupAdvice: bytes > DEFAULT_MAX_BYTES ? ['缓存超过默认容量，建议清理 packages/imports 或 sessions'] : [],
    buckets
  }
}

export async function clearReplayCache(bucketKey?: string): Promise<void> {
  if (bucketKey) {
    const bucket = cacheBuckets().find((it) => it.key === bucketKey)
    if (!bucket) return
    const files = (await listFiles(bucket.dir)).filter((file) => bucketContainsFile(bucket.key, file))
    for (const file of files) await fs.rm(file, { force: true }).catch(() => undefined)
    if (bucket.key === 'packages' || bucket.key === 'imports') {
      await fs.rm(bucket.dir, { recursive: true, force: true }).catch(() => undefined)
    }
    return
  }
  await fs.rm(CACHE_ROOT_DIR, { recursive: true, force: true })
}

export async function cleanupReplayCache(maxAgeDays = Number(process.env.REPLAY_CACHE_MAX_AGE_DAYS || DEFAULT_MAX_AGE_DAYS)): Promise<void> {
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000
  const now = Date.now()
  for (const file of await listFiles(CACHE_ROOT_DIR)) {
    const stat = await fs.stat(file).catch(() => null)
    if (stat && now - stat.mtimeMs > maxAgeMs) await fs.rm(file, { force: true }).catch(() => undefined)
  }
  await cleanupBySize(Number(process.env.REPLAY_CACHE_MAX_BYTES || DEFAULT_MAX_BYTES))
}

function cacheFile(key: string): string {
  return path.join(CACHE_ROOT_DIR, `session-${key}.json`)
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const result: string[] = []
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...await listFiles(file))
    else if (entry.isFile()) result.push(file)
  }
  return result
}

function cacheBuckets(): CacheBucketSummary[] {
  return [
    { key: 'sessions', label: '会话缓存', dir: CACHE_ROOT_DIR, files: 0, bytes: 0 },
    { key: 'indexes', label: '日志索引缓存', dir: path.join(CACHE_ROOT_DIR, 'indexes'), files: 0, bytes: 0 },
    { key: 'packages', label: '导出诊断包', dir: path.join(CACHE_ROOT_DIR, 'packages'), files: 0, bytes: 0 },
    { key: 'imports', label: '导入诊断包', dir: path.join(CACHE_ROOT_DIR, 'imports'), files: 0, bytes: 0 },
    { key: 'feedback', label: '根因反馈', dir: CACHE_ROOT_DIR, files: 0, bytes: 0 },
    { key: 'other', label: '其他缓存', dir: CACHE_ROOT_DIR, files: 0, bytes: 0 }
  ]
}

async function summarizeBucket(bucket: CacheBucketSummary): Promise<CacheBucketSummary> {
  const allFiles = await listFiles(bucket.dir)
  const files = allFiles.filter((file) => bucketContainsFile(bucket.key, file))
  let bytes = 0
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null)
    bytes += stat?.size || 0
  }
  return { ...bucket, files: files.length, bytes }
}

function bucketContainsFile(key: string, file: string): boolean {
  const relative = path.relative(CACHE_ROOT_DIR, file)
  if (key === 'sessions') return /^session-.*\.json$/.test(relative)
  if (key === 'indexes') return relative.startsWith('indexes/')
  if (key === 'packages') return relative.startsWith('packages/')
  if (key === 'imports') return relative.startsWith('imports/')
  if (key === 'feedback') return relative === 'root-cause-feedback.json'
  if (key === 'other') {
    return !/^session-.*\.json$/.test(relative)
      && !relative.startsWith('packages/')
      && !relative.startsWith('imports/')
      && !relative.startsWith('indexes/')
      && relative !== 'root-cause-feedback.json'
  }
  return false
}

async function cleanupBySize(maxBytes: number): Promise<void> {
  const files = await listFiles(CACHE_ROOT_DIR)
  const stats = await Promise.all(files.map(async (file) => ({ file, stat: await fs.stat(file).catch(() => null) })))
  let total = stats.reduce((sum, item) => sum + (item.stat?.size || 0), 0)
  if (total <= maxBytes) return
  for (const item of stats.sort((a, b) => (a.stat?.mtimeMs || 0) - (b.stat?.mtimeMs || 0))) {
    if (total <= maxBytes) return
    if (!item.stat) continue
    await fs.rm(item.file, { force: true }).catch(() => undefined)
    total -= item.stat.size
  }
}
