import fs from 'fs/promises'
import path from 'path'
import type { VectorDocumentChunk, VectorSearchResult } from '../types'
import { readCaseMeta } from './caseMeta'
import { buildCaseMetaChunks, buildKnowledgeRuleChunks, rankChunks } from './knowledgeEmbedding'
import { readKnowledgeLibrary } from './knowledgeBase'

const VECTOR_STORE_FILE = path.resolve(process.cwd(), 'replay-server/.cache/vector-store.json')

export interface VectorStoreData {
  version: 1
  updatedAt: string
  chunks: VectorDocumentChunk[]
}

export async function readVectorStore(): Promise<VectorStoreData> {
  try {
    const text = await fs.readFile(VECTOR_STORE_FILE, 'utf8')
    const data = JSON.parse(text) as Partial<VectorStoreData>
    return {
      version: 1,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      chunks: Array.isArray(data.chunks) ? data.chunks : []
    }
  } catch {
    return { version: 1, updatedAt: '', chunks: [] }
  }
}

export async function writeVectorStore(store: VectorStoreData): Promise<VectorStoreData> {
  const normalized = { version: 1 as const, updatedAt: store.updatedAt || new Date().toISOString(), chunks: store.chunks || [] }
  await fs.mkdir(path.dirname(VECTOR_STORE_FILE), { recursive: true })
  await fs.writeFile(VECTOR_STORE_FILE, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

export async function rebuildVectorStore(): Promise<VectorStoreData> {
  const knowledge = await readKnowledgeLibrary()
  const caseMeta = await readCaseMeta()
  const chunks = [
    ...buildKnowledgeRuleChunks(knowledge.rules.filter((rule) => rule.enabled)),
    ...buildCaseMetaChunks(caseMeta)
  ]
  return writeVectorStore({ version: 1, updatedAt: new Date().toISOString(), chunks })
}

export async function searchVectorStore(query: string, options: { limit?: number; rebuildIfEmpty?: boolean } = {}): Promise<VectorSearchResult[]> {
  let store = await readVectorStore()
  if (options.rebuildIfEmpty !== false && store.chunks.length === 0) store = await rebuildVectorStore()
  return rankChunks(query, store.chunks, options.limit || 8)
}

export async function getVectorStoreStats() {
  const store = await readVectorStore()
  return {
    chunks: store.chunks.length,
    updatedAt: store.updatedAt
  }
}
