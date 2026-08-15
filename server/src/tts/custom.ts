import type { TTSProvider, TtsKind } from '../types.js';
import { normalizeBaseUrl } from '../utils/url.js';
import { convertWavToPcm16 } from '../voice/wav.js';

interface CustomTTSConfig {
  url: string;
  method: 'GET' | 'POST';
  bodyTemplate: string; // JSON 参数模板，{text} 会被替换为待合成文本
  apiKey: string;
}

/** 把待合成文本转义成可安全嵌入 JSON 字符串的内容（转义引号、反斜杠、换行与全部控制字符） */
function escapeJsonText(s: string): string {
  return s
    .split('\\')
    .join('\\\\')
    .split('"')
    .join('\\"')
    .split('\n')
    .join('\\n')
    .split('\r')
    .join('\\r')
    .split('\t')
    .join('\\t')
    .replace(/[\u0000-\u001f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * 预处理待合成文本：压缩换行与连续空白。
 * 本地 TTS（如 SBV2）对换行会强制分段，导致语音停顿明显、断断续续；
 * 这里把「标点+换行」保留标点、其余换行替换为逗号，让句子连贯合成。
 */
function preprocessText(text: string): string {
  return text
    .replace(/[。！？；]+\r?\n+/g, (m) => m[0]) // 句末标点+换行 → 只保留标点
    .replace(/\r?\n+/g, '，') // 其余换行 → 逗号
    .replace(/[，,]{2,}/g, '，') // 连续逗号合并
    .replace(/[ \t]{2,}/g, ' ') // 连续空白压缩
    .trim();
}

/**
 * 自定义 HTTP TTS：POST/GET 到任意本地或远程服务，返回音频字节（wav/mp3）。
 * 例如 Style-Bert-VITS2 的 SBV2-API：
 *   POST http://127.0.0.1:3000/synthesize
 *   body: {"text":"{text}","ident":"Ling v2"}
 *   返回: audio/wav
 * 模板中的 {text} 会被替换为预处理 + JSON 转义后的文本。
 */
export class CustomHTTPTTS implements TTSProvider {
  readonly kind: TtsKind = 'custom';
  readonly displayName = '自定义 HTTP TTS';
  readonly mime = 'audio/wav';

  constructor(private cfg: CustomTTSConfig) {}

  async synthesize(text: string, _voice: string, _rate: number, signal?: AbortSignal): Promise<Buffer> {
    text = preprocessText(text);
    const url = normalizeBaseUrl(this.cfg.url);
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) headers.Authorization = `Bearer ${this.cfg.apiKey}`;

    let res: Response;
    if (this.cfg.method === 'GET') {
      const sep = url.includes('?') ? '&' : '?';
      res = await fetch(`${url}${sep}text=${encodeURIComponent(text)}`, { headers, signal });
    } else {
      const body = (this.cfg.bodyTemplate || '').split('{text}').join(escapeJsonText(text));
      headers['Content-Type'] = 'application/json';
      res = await fetch(url, { method: 'POST', headers, body: body || JSON.stringify({ text }), signal });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`自定义 TTS HTTP ${res.status}: ${detail.slice(0, 300)}`);
    }
    const raw = Buffer.from(await res.arrayBuffer());
    // 32-bit float / WAVE_FORMAT_EXTENSIBLE 的 WAV 部分浏览器无法解码，
    // 统一转成标准 16bit PCM WAV 保证可播放；非 WAV（mp3 等）原样返回
    const converted = convertWavToPcm16(raw);
    return converted ?? raw;
  }
}
