import type { STTProvider, SttKind } from '../types.js';

/** Azure Speech 语音识别适配器 */
export class AzureSTT implements STTProvider {
  readonly kind: SttKind = 'azure';
  readonly displayName = 'Azure 语音识别';

  constructor(private cfg: { apiKey: string; region: string }) {}

  async transcribe(wavBuffer: Buffer, language: string): Promise<string> {
    const region = this.cfg.region;
    if (!region) throw new Error('Azure STT 需要配置 region（如 eastasia）');
    const lang = language || 'zh-CN';
    const url =
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1` +
      `?language=${encodeURIComponent(lang)}&format=simple`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.cfg.apiKey,
        'Content-Type': 'audio/wav',
      },
      body: new Uint8Array(wavBuffer),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`STT (Azure) HTTP ${res.status}: ${detail.slice(0, 500)}`);
    }
    const json = (await res.json()) as { RecognitionStatus?: string; DisplayText?: string };
    if (json.RecognitionStatus && json.RecognitionStatus !== 'Success') {
      throw new Error(`STT (Azure) 识别失败: ${json.RecognitionStatus}`);
    }
    return (json.DisplayText ?? '').trim();
  }
}
