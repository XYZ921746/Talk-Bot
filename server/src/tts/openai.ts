import type { TTSProvider, TtsKind } from '../types.js';
import { normalizeBaseUrl } from '../utils/url.js';

/** OpenAI 兼容 /audio/speech 适配器 */
export class OpenAICompatibleTTS implements TTSProvider {
  readonly kind: TtsKind = 'openai';
  readonly displayName = 'OpenAI 兼容 TTS';
  readonly mime = 'audio/mpeg';

  constructor(private cfg: { baseUrl: string; apiKey: string; model: string }) {}

  async synthesize(text: string, voice: string, rate: number, signal?: AbortSignal): Promise<Buffer> {
    const base = normalizeBaseUrl(this.cfg.baseUrl);
    const url = `${base}/audio/speech`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        voice: voice || 'alloy',
        input: text,
        response_format: 'mp3',
      }),
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS (${this.displayName}) HTTP ${res.status}: ${detail.slice(0, 500)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
