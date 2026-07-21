import { readJsonStore, writeJsonStore } from '../db/jsonStore'
import type { VectorDocumentChunk, VectorSearchResult } from '../types'
import { readCaseMeta } from './caseMeta'
import { buildCaseMetaChunks, buildKnowledgeRuleChunks, rankChunks } from './knowledgeEmbedding'
import { readKnowledgeLibrary } from './knowledgeBase'

const KEY = 'vectorStore'

export interface VectorStoreData {
  version: 1
  updatedAt: string
  chunks: VectorDocumentChunk[]
}

export async function readVectorStore(): Promise<VectorStoreData> {
  return readJsonStore<VectorStoreData>(KEY, { version: 1, updatedAt: '', chunks: [] })
}

export async function writeVectorStore(store: VectorStoreData): Promise<VectorStoreData> {
  const normalized = { version: 1 as const, updatedAt: store.updatedAt || new Date().toISOString(), chunks: store.chunks || [] }
  await writeJsonStore(KEY, normalized)
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
