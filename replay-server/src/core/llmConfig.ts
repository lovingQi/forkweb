import type { AssistantStatus, LlmRuntimeConfig } from '../types'
import { readLlmLocalConfig, toPublicLlmConfig } from './llmConfigStore'
import { getVectorStoreStats } from './vectorStore'

export type LlmConfig = LlmRuntimeConfig

export async function readLlmConfig(): Promise<LlmConfig> {
  const local = await readLlmLocalConfig()
  if (local?.apiKey || local?.baseUrl || local?.model) {
    return {
      provider: local.provider || 'deepseek',
      apiKey: String(local.apiKey || process.env.DEEPSEEK_API_KEY || ''),
      model: String(local.model || process.env.DEEPSEEK_MODEL || defaultModel(local.provider)),
      baseUrl: String(local.baseUrl || process.env.DEEPSEEK_BASE_URL || defaultBaseUrl(local.provider)).replace(/\/+$/, ''),
      timeoutMs: positiveNumber(local.timeoutMs ?? process.env.DEEPSEEK_TIMEOUT_MS, 30000),
      maxTokens: positiveNumber(local.maxTokens ?? process.env.DEEPSEEK_MAX_TOKENS, 1200),
      temperature: boundedNumber(local.temperature ?? process.env.DEEPSEEK_TEMPERATURE, 0.2, 0, 2),
      source: 'local_file',
      redaction: readRedactionConfig()
    }
  }
  const hasEnv = Boolean(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_MODEL)
  return {
    provider: 'deepseek',
    apiKey: String(process.env.DEEPSEEK_API_KEY || ''),
    model: String(process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
    baseUrl: String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    timeoutMs: positiveNumber(process.env.DEEPSEEK_TIMEOUT_MS, 30000),
    maxTokens: positiveNumber(process.env.DEEPSEEK_MAX_TOKENS, 1200),
    temperature: boundedNumber(process.env.DEEPSEEK_TEMPERATURE, 0.2, 0, 1),
    source: hasEnv ? 'env' : 'default',
    redaction: readRedactionConfig()
  }
}

export async function getAssistantStatus(): Promise<AssistantStatus> {
  const config = await readLlmConfig()
  const vectorStore = await getVectorStoreStats()
  const publicConfig = toPublicLlmConfig(config)
  return {
    provider: config.provider,
    model: config.model,
    baseUrl: publicConfig.baseUrl,
    enabled: Boolean(config.apiKey),
    apiKeyMasked: publicConfig.apiKeyMasked,
    source: config.source,
    reason: config.apiKey ? `${providerLabel(config.provider)} API Key 已配置` : '未配置 API Key，问诊助手处于离线模式',
    vectorStore
  }
}

export async function getPublicLlmConfig() {
  const local = await readLlmLocalConfig()
  const config = await readLlmConfig()
  return toPublicLlmConfig(config, local?.updatedAt || '')
}

function readRedactionConfig(): LlmConfig['redaction'] {
  return {
    enabled: envBool('REPLAY_ASSISTANT_REDACTION', true),
    redactPaths: envBool('REPLAY_ASSISTANT_REDACT_PATHS', true),
    redactIp: envBool('REPLAY_ASSISTANT_REDACT_IP', true),
    redactLongIds: envBool('REPLAY_ASSISTANT_REDACT_LONG_IDS', true),
    redactRobotName: envBool('REPLAY_ASSISTANT_REDACT_ROBOT_NAME', false)
  }
}

function defaultModel(provider: unknown): string {
  return provider === 'openai_compatible' ? 'gpt-4o-mini' : 'deepseek-chat'
}

function defaultBaseUrl(provider: unknown): string {
  return provider === 'openai_compatible' ? 'https://api.openai.com/v1' : 'https://api.deepseek.com'
}

function providerLabel(provider: string) {
  return provider === 'openai_compatible' ? 'OpenAI Compatible' : 'DeepSeek'
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

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}
