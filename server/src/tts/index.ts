import type { TTSProvider, TtsConfig } from '../types.js';
import { EdgeTTS } from './edge.js';
import { OpenAICompatibleTTS } from './openai.js';
import { AzureTTS } from './azure.js';
import { CustomHTTPTTS } from './custom.js';

export function createTTSProvider(cfg: TtsConfig): TTSProvider | null {
  switch (cfg.type) {
    case 'edge':
      return new EdgeTTS();
    case 'openai':
      return new OpenAICompatibleTTS({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
    case 'azure':
      return new AzureTTS({ apiKey: cfg.apiKey, region: cfg.region ?? '' });
    case 'custom':
      return new CustomHTTPTTS({
        url: cfg.baseUrl,
        method: cfg.customMethod ?? 'POST',
        bodyTemplate: cfg.customBody ?? '',
        apiKey: cfg.apiKey,
      });
    case 'none':
    default:
      return null;
  }
}
