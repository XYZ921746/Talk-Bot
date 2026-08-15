import { createHmac } from 'node:crypto';
import WebSocket from 'ws';
import type { STTProvider, SttKind } from '../types.js';

const HOST = 'iat-api.xfyun.cn';
const PATH = '/v2/iat';
const URL = `wss://${HOST}${PATH}`;
const TIMEOUT_MS = 30_000;

/** RFC1123 GMT 日期 */
function rfc1123Date(d = new Date()): string {
  return d.toUTCString();
}

/** 生成讯飞一句话识别的鉴权 URL（HMAC-SHA256） */
function buildAuthUrl(apiKey: string, apiSecret: string): { url: string; date: string } {
  const date = rfc1123Date();
  // signature_origin = "host: HOST\ndate: DATE\nGET /v2/iat HTTP/1.1"
  const signatureOrigin = `host: ${HOST}\ndate: ${date}\nGET ${PATH} HTTP/1.1`;
  const signature = createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
  // authorization_origin = 'api_key="...", algorithm="hmac-sha256", headers="host date request-line", signature="..."'
  const authorizationOrigin =
    `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');
  const url = `${URL}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${HOST}`;
  return { url, date };
}

/**
 * 讯飞语音识别（一句话，iat 流式接口）。
 * 需要 APPID / APIKey / APISecret；语言 zh_cn / en_us；方言 mandarin / cantonese 等。
 */
export class XfyunSTT implements STTProvider {
  readonly kind: SttKind = 'xfyun';
  readonly displayName = '讯飞语音识别';

  constructor(
    private cfg: { appId: string; apiKey: string; apiSecret: string; language?: string; accent?: string },
  ) {}

  transcribe(wavBuffer: Buffer, _language: string): Promise<string> {
    if (!this.cfg.appId || !this.cfg.apiKey || !this.cfg.apiSecret) {
      return Promise.reject(new Error('讯飞语音识别未配置 APPID / APIKey / APISecret'));
    }
    return new Promise((resolve, reject) => {
      const { url } = buildAuthUrl(this.cfg.apiKey, this.cfg.apiSecret);
      let ws: WebSocket | null = null;
      let settled = false;
      let resultText = '';
      let chunks = '';
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            ws?.close();
          } catch {
            /* ignore */
          }
          reject(new Error('STT (讯飞语音) 请求超时'));
        }
      }, TIMEOUT_MS);

      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve(resultText.trim());
      };

      ws = new WebSocket(url);
      ws.on('open', () => {
        // 一句话识别：status=2 一次发完（raw PCM 16k）
        const payload = {
          common: { app_id: this.cfg.appId },
          business: {
            language: this.cfg.language ?? 'zh_cn',
            domain: 'iat',
            accent: this.cfg.accent ?? 'mandarin',
            vad_eos: 3000,
            ptt: 0,
          },
          data: {
            status: 2,
            format: 'audio/L16;rate=16000',
            encoding: 'raw',
            data: wavBuffer.toString('base64'),
          },
        };
        ws!.send(JSON.stringify(payload));
      });
      ws.on('message', (data) => {
        chunks += data.toString();
        // 可能有多个 JSON 帧连发，逐个解析
        let idx: number;
        while ((idx = chunks.indexOf('\n')) >= 0) {
          const line = chunks.slice(0, idx).trim();
          chunks = chunks.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as {
              code?: number;
              message?: string;
              data?: { status?: number; result?: { ws?: { cw?: { w?: string }[] }[] } };
            };
            if (msg.code !== 0) {
              finish(new Error(`STT (讯飞语音) ${msg.code}: ${msg.message ?? ''}`));
              return;
            }
            for (const w of msg.data?.result?.ws ?? []) {
              for (const c of w.cw ?? []) {
                if (c.w) resultText += c.w;
              }
            }
            if (msg.data?.status === 2) finish(null);
          } catch {
            /* 忽略不完整帧 */
          }
        }
      });
      ws.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
      ws.on('close', () => {
        if (!settled) finish(null); // 服务端未显式 status=2 但已关闭 → 用已收集文本
      });
    });
  }
}
