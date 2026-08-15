import type { LLMProvider, LlmConfig } from '../types.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';

export function createLLMProvider(cfg: LlmConfig): LLMProvider {
  switch (cfg.type) {
    case 'anthropic':
      return new AnthropicProvider({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
    case 'openai':
    default:
      return new OpenAIProvider({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        reasoningEffort: cfg.reasoningEffort,
      });
  }
}
