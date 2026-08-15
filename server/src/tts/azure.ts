import type { TTSProvider, TtsKind } from '../types.js';

/** Azure 语音合成适配器 */
export class AzureTTS implements TTSProvider {
  readonly kind: TtsKind = 'azure';
  readonly displayName = 'Azure 语音合成';
  readonly mime = 'audio/mpeg';

  constructor(private cfg: { apiKey: string; region: string }) {}

  async synthesize(text: string, voice: string, rate: number, signal?: AbortSignal): Promise<Buffer> {
    const region = this.cfg.region;
    if (!region) throw new Error('Azure TTS 需要配置 region（如 eastasia）');
    const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`;
    const ssml =
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>` +
      `<voice name='${voice || 'zh-CN-XiaoxiaoNeural'}'><prosody rate='${rateStr}'>` +
      `${escapeXml(text)}</prosody></voice></speak>`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.cfg.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ai-voice-assistant',
      },
      body: ssml,
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`TTS (Azure) HTTP ${res.status}: ${detail.slice(0, 500)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
