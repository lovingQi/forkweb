import fs from 'fs/promises'
import path from 'path'
import type { ReplayCaseMeta } from '../types'

const CASE_META_FILE = path.resolve(process.cwd(), 'replay-server/.cache/case-meta.json')

export async function readCaseMeta(): Promise<ReplayCaseMeta> {
  try {
    return JSON.parse(await fs.readFile(CASE_META_FILE, 'utf8')) as ReplayCaseMeta
  } catch {
    return {}
  }
}

export async function writeCaseMeta(input: ReplayCaseMeta): Promise<ReplayCaseMeta> {
  const meta = { ...input, updatedAt: new Date().toISOString() }
  await fs.mkdir(path.dirname(CASE_META_FILE), { recursive: true })
  await fs.writeFile(CASE_META_FILE, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  return meta
}
