import type { LlmConfig } from './llmConfig'
import type { LlmChatOptions, LlmMessage, LlmProvider } from './llmProvider'
import { OpenAiCompatibleClient } from './openAiCompatibleClient'

export class DeepSeekClient implements LlmProvider {
  private client: OpenAiCompatibleClient

  constructor(config: LlmConfig) {
    this.client = new OpenAiCompatibleClient(config)
  }

  getStatus() {
    return this.client.getStatus()
  }

  async chatJson(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<unknown> {
    return this.client.chatJson(messages, options)
  }
}
