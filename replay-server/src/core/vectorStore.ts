import { readJsonStore, writeJsonStore } from '../db/jsonStore'
import type { VectorDocumentChunk, VectorSearchResult } from '../types'
import { readCaseMeta } from './caseMeta'
import { buildCaseMetaChunks, buildKnowledgeRuleChunks, buildIdfTable, rankChunks, reEmbedChunkText } from './knowledgeEmbedding'
import { readKnowledgeLibrary, getKnowledgeLibraryFingerprint } from './knowledgeBase'

const KEY = 'vectorStore'
let lastRebuildFingerprint = ''

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
  const fingerprint = await getKnowledgeLibraryFingerprint()
  const existing = await readVectorStore()
  if (fingerprint === lastRebuildFingerprint && existing.chunks.length > 0) {
    return existing
  }
  const knowledge = await readKnowledgeLibrary()
  const caseMeta = await readCaseMeta()
  const ticketChunks = existing.chunks.filter((c) => c.source.type === 'ticket_conclusion')
  buildIdfTable(existing.chunks.length > 0 ? existing.chunks : [])
  const freshChunks = [
    ...buildKnowledgeRuleChunks(knowledge.rules.filter((rule) => rule.enabled)),
    ...buildCaseMetaChunks(caseMeta)
  ]
  const allChunks = [...freshChunks, ...ticketChunks]
  buildIdfTable(allChunks)
  const reEmbeddedChunks = allChunks.map((chunk) => ({ ...chunk, embedding: reEmbedChunkText(chunk.text) }))
  lastRebuildFingerprint = fingerprint
  return writeVectorStore({ version: 1, updatedAt: new Date().toISOString(), chunks: reEmbeddedChunks })
}

export async function appendVectorStoreChunk(chunk: VectorDocumentChunk): Promise<void> {
  const store = await readVectorStore()
  const idx = store.chunks.findIndex((c) => c.id === chunk.id)
  if (idx >= 0) store.chunks[idx] = chunk
  else store.chunks.push(chunk)
  await writeVectorStore({ ...store, updatedAt: new Date().toISOString() })
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
