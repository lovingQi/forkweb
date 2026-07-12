import type { LlmConfig } from './llmConfig'
import type { LlmChatOptions, LlmMessage, LlmProvider } from './llmProvider'
import { LlmProviderError, providerStatus } from './llmProvider'

export class OpenAiCompatibleClient implements LlmProvider {
  constructor(private config: LlmConfig) {}

  getStatus() {
    return providerStatus(this.config)
  }

  async chatJson(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<unknown> {
    if (!this.config.apiKey) throw new LlmProviderError('未配置 API Key', 'missing_api_key')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.config.timeoutMs)
    try {
      const response = await fetch(resolveChatCompletionsUrl(this.config.baseUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: options.model || this.config.model,
          messages,
          temperature: options.temperature ?? this.config.temperature,
          max_tokens: options.maxTokens || this.config.maxTokens,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new LlmProviderError(`${providerLabel(this.config.provider)} 请求失败: ${response.status} ${text.slice(0, 200)}`, 'request_failed')
      }
      const data = await response.json() as any
      const content = data?.choices?.[0]?.message?.content
      if (!content || typeof content !== 'string') throw new LlmProviderError(`${providerLabel(this.config.provider)} 返回内容为空`, 'empty_response')
      try {
        return JSON.parse(content)
      } catch {
        throw new LlmProviderError(`${providerLabel(this.config.provider)} 返回内容不是有效 JSON`, 'invalid_json')
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') throw new LlmProviderError(`${providerLabel(this.config.provider)} 请求超时`, 'timeout')
      if (error instanceof LlmProviderError) throw error
      throw new LlmProviderError(error?.message || String(error), 'network_error')
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  if (normalized.endsWith('/chat/completions')) return normalized
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`
  return `${normalized}/chat/completions`
}

function providerLabel(provider: string) {
  return provider === 'openai_compatible' ? 'OpenAI Compatible' : 'DeepSeek'
}
