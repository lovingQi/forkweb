import type { LlmConfig } from './llmConfig'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

export interface LlmProvider {
  chatJson(messages: LlmMessage[], options?: LlmChatOptions): Promise<unknown>
  getStatus(): { provider: string; model: string; enabled: boolean }
}

export class LlmProviderError extends Error {
  constructor(message: string, public code: string) {
    super(message)
  }
}

export function providerStatus(config: LlmConfig) {
  return {
    provider: config.provider,
    model: config.model,
    enabled: Boolean(config.apiKey)
  }
}
