import { deleteJsonStore, readJsonStore, writeJsonStore } from '../db/jsonStore'
import type { LlmConfigUpdateRequest, LlmPublicConfig, LlmRuntimeConfig } from '../types'

const KEY = 'llmLocalConfig'

export interface LlmLocalConfig extends LlmConfigUpdateRequest {
  updatedAt?: string
}

export async function readLlmLocalConfig(): Promise<LlmLocalConfig | null> {
  return readJsonStore<LlmLocalConfig | null>(KEY, null)
}

export async function writeLlmLocalConfig(input: LlmConfigUpdateRequest): Promise<LlmLocalConfig> {
  const current = await readLlmLocalConfig()
  const next = normalizeLocalConfig({
    ...(current || {}),
    ...input,
    apiKey: input.apiKey === '' || input.apiKey === undefined ? current?.apiKey : input.apiKey,
    updatedAt: new Date().toISOString()
  })
  await writeJsonStore(KEY, next)
  return next
}

export async function clearLlmLocalConfig(): Promise<void> {
  await deleteJsonStore(KEY)
}

export function toPublicLlmConfig(config: LlmRuntimeConfig, updatedAt = ''): LlmPublicConfig {
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    enabled: Boolean(config.apiKey),
    apiKeyMasked: maskApiKey(config.apiKey),
    source: config.source,
    updatedAt
  }
}

export function maskApiKey(key = ''): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return `****${key.slice(-4)}`
}

function normalizeLocalConfig(input: unknown): LlmLocalConfig {
  const data = input && typeof input === 'object' ? input as LlmLocalConfig : {}
  return {
    provider: data.provider === 'openai_compatible' ? 'openai_compatible' : 'deepseek',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : undefined,
    model: String(data.model || defaultModel(data.provider)),
    baseUrl: String(data.baseUrl || defaultBaseUrl(data.provider)).replace(/\/+$/, ''),
    timeoutMs: positiveNumber(data.timeoutMs, 30000),
    maxTokens: positiveNumber(data.maxTokens, 1200),
    temperature: boundedNumber(data.temperature, 0.2, 0, 2),
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined
  }
}

function defaultModel(provider: unknown): string {
  return provider === 'openai_compatible' ? 'gpt-4o-mini' : 'deepseek-chat'
}

function defaultBaseUrl(provider: unknown): string {
  return provider === 'openai_compatible' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com'
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}
