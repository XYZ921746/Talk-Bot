import type { STTProvider, SttKind } from '../types.js';
import { normalizeBaseUrl } from '../utils/url.js';

/**
 * 把常见的语言代码映射到本地 ASR（Qwen3-ASR 等）期望的语言名。
 * Qwen3-ASR 要求 'Chinese'/'English' 这类全名，不认 'zh'/'en'。
 */
const LANGUAGE_MAP: Record<string, string> = {
  zh: 'Chinese',
  'zh-cn': 'Chinese',
  'zh-hans': 'Chinese',
  'zh-cn-hans': 'Chinese',
  'zh-tw': 'Chinese',
  'zh-hant': 'Chinese',
  'zh-hk': 'Cantonese',
  yue: 'Cantonese',
  en: 'English',
  'en-us': 'English',
  'en-gb': 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  it: 'Italian',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ar: 'Arabic',
  tr: 'Turkish',
  hi: 'Hindi',
  ms: 'Malay',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  pl: 'Polish',
  cs: 'Czech',
  fil: 'Filipino',
  fa: 'Persian',
  el: 'Greek',
  ro: 'Romanian',
  hu: 'Hungarian',
  mk: 'Macedonian',
};

/** 转成服务期望的语言：已知代码映射，否则原样传 */
function normalizeLanguage(language: string): string {
  const key = language.trim().toLowerCase();
  if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
  // 形如 'zh-CN' → 小写后 'zh-cn' 已覆盖；再尝试只取语言部分（如 'pt-BR' → pt）
  const base = key.split('-')[0];
  if (LANGUAGE_MAP[base]) return LANGUAGE_MAP[base];
  return language.trim();
}

/** OpenAI 兼容 /audio/transcriptions 适配器（OpenAI Whisper、Groq、Qwen3-ASR 等本地服务） */
export class OpenAICompatibleSTT implements STTProvider {
  readonly kind: SttKind = 'openai';
  readonly displayName = 'OpenAI 兼容 (Whisper)';

  constructor(private cfg: { baseUrl: string; apiKey: string; model: string }) {}

  async transcribe(wavBuffer: Buffer, language: string): Promise<string> {
    const mappedLang = language ? normalizeLanguage(language) : '';
    try {
      return await this.request(wavBuffer, mappedLang);
    } catch (err) {
      // 服务不认该语言代码（如 Qwen3-ASR 的 "Unsupported language"）→ 去掉 language 自动检测重试
      const msg = err instanceof Error ? err.message : String(err);
      if (mappedLang && /unsupported language|invalid language|language.*not (supported|valid)/i.test(msg)) {
        return await this.request(wavBuffer, '');
      }
      throw err;
    }
  }

  private async request(wavBuffer: Buffer, language: string): Promise<string> {
    const base = normalizeBaseUrl(this.cfg.baseUrl);
    const url = `${base}/audio/transcriptions`;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.cfg.model);
    if (language) form.append('language', language);

    // 30s 超时：防止本地 STT 服务挂起导致整个处理队列卡死
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`STT (${this.displayName}) HTTP ${res.status}: ${detail.slice(0, 500)}`);
      }
      const json = (await res.json()) as { text?: string };
      return (json.text ?? '').trim();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`STT (${this.displayName}) 请求超时（30s）`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
