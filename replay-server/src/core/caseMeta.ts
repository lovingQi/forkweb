import { readJsonStore, writeJsonStore } from '../db/jsonStore'
import type { ReplayCaseMeta } from '../types'

const KEY = 'caseMeta'

export async function readCaseMeta(): Promise<ReplayCaseMeta> {
  return readJsonStore<ReplayCaseMeta>(KEY, {})
}

export async function writeCaseMeta(input: ReplayCaseMeta): Promise<ReplayCaseMeta> {
  const meta = { ...input, updatedAt: new Date().toISOString() }
  await writeJsonStore(KEY, meta)
  return meta
}
