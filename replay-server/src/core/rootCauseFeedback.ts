import { readJsonStore, writeJsonStore } from '../db/jsonStore'

export interface RootCauseFeedback {
  id: string
  verdict: 'useful' | 'false_positive'
  note?: string
  createdAt: string
}

const KEY = 'rootCauseFeedback'

export async function addRootCauseFeedback(input: {
  id: string
  verdict: 'useful' | 'false_positive'
  note?: string
}): Promise<RootCauseFeedback> {
  const all = await readRootCauseFeedback()
  const item: RootCauseFeedback = {
    id: input.id,
    verdict: input.verdict,
    note: input.note,
    createdAt: new Date().toISOString()
  }
  all.push(item)
  await writeJsonStore(KEY, all)
  return item
}

export async function readRootCauseFeedback(): Promise<RootCauseFeedback[]> {
  return readJsonStore<RootCauseFeedback[]>(KEY, [])
}
