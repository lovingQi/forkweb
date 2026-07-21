import fs from 'fs/promises'
import path from 'path'
import { CACHE_DIR } from '../paths'

export interface RootCauseFeedback {
  id: string
  verdict: 'useful' | 'false_positive'
  note?: string
  createdAt: string
}

const FEEDBACK_FILE = path.join(CACHE_DIR, 'root-cause-feedback.json')

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
  await fs.mkdir(path.dirname(FEEDBACK_FILE), { recursive: true })
  await fs.writeFile(FEEDBACK_FILE, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  return item
}

export async function readRootCauseFeedback(): Promise<RootCauseFeedback[]> {
  try {
    const text = await fs.readFile(FEEDBACK_FILE, 'utf8')
    const data = JSON.parse(text)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
