import crypto from 'node:crypto';
import WebSocket from 'ws';
import type { TTSProvider, TtsKind } from '../types.js';

// ===== 免费 Microsoft Edge TTS（无需任何 API Key）=====
// 协议与鉴权对齐 edge-tts 7.2.8（drm.py / communicate.py）：
//   Sec-MS-GEC = SHA256("{1601-epoch 起算、向下取整 5 分钟的 100ns ticks}{TrustedClientToken}").hex().upper()

const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600; // 秒：1601-01-01 与 1970-01-01 之差
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const ORIGIN = 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0';

/** 生成 Sec-MS-GEC 令牌（64 位大写 hex 摘要） */
function generateSecMsGec(): string {
  const unixSec = Date.now() / 1000;
  let ticks = unixSec + WIN_EPOCH;
  ticks -= ticks % 300; // 向下取整到 5 分钟
  const ticks100ns = Math.round(ticks * 10_000_000);
  const strToHash = `${ticks100ns}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

/** JS 风格日期字符串，如 "Wed Nov 12 2025 08:30:00 GMT+0000 (Coordinated Universal Time)" */
function dateToString(): string {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 消息帧：X-RequestId / Content-Type / X-Timestamp / Path 头 + 空行 + 消息体 */
function frame(path: string, contentType: string, body: string, withTimestampZ = false): string {
  const requestId = crypto.randomUUID().replace(/-/g, '');
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:${contentType}\r\n` +
    `X-Timestamp:${dateToString()}${withTimestampZ ? 'Z' : ''}\r\n` +
    `Path:${path}\r\n\r\n` +
    body
  );
}

const speechConfig = () =>
  JSON.stringify({
    context: {
      synthesis: {
        audio: {
          metadataoptions: { sentenceBoundaryEnabled: 'true', wordBoundaryEnabled: 'false' },
          outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        },
      },
    },
  });

function ssmlFor(voice: string, rate: number, text: string): string {
  const rateStr = rate >= 0 ? `+${rate}%` : `${rate}%`;
  return (
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='+0Hz' rate='${rateStr}' volume='+0%'>` +
    `${xmlEscape(text)}</prosody></voice></speak>`
  );
}

export class EdgeTTS implements TTSProvider {
  readonly kind: TtsKind = 'edge';
  readonly displayName = 'Edge TTS（免费）';
  readonly mime = 'audio/mpeg';

  synthesize(text: string, voice: string, rate: number, signal?: AbortSignal): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const url =
        `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
        `&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}` +
        `&Sec-MS-GEC=${generateSecMsGec()}` +
        `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
      const ws = new WebSocket(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9',
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          Origin: ORIGIN,
          'Sec-WebSocket-Version': '13',
          Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};`,
        },
      });
      const chunks: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => fail(new Error('Edge TTS 请求超时')), 20000);

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(err);
      };
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(Buffer.concat(chunks));
      };

      const onAbort = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        fail(err);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      ws.on('open', () => {
        try {
          // 帧 1：speech.config（消息体末尾带 \r\n）
          ws.send(
            `X-Timestamp:${dateToString()}\r\n` +
              'Content-Type:application/json; charset=utf-8\r\n' +
              'Path:speech.config\r\n\r\n' +
              `${speechConfig()}\r\n`,
          );
          // 帧 2：ssml（无 synthesis.context；X-Timestamp 带 Z 后缀是微软侧约定）
          ws.send(frame('ssml', 'application/ssml+xml', ssmlFor(voice, rate, text), true));
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on('message', (raw) => {
        const data = raw as unknown as string | Buffer;
        const text = typeof data === 'string' ? data : data.toString('utf8');
        // 完成帧（turn.end）可能以文本帧或二进制帧（无长度前缀的纯文本）到达
        if (text.includes('Path:turn.end')) {
          done();
          return;
        }
        if (typeof data === 'string' || data.length < 3) return;
        // 音频帧：[2 字节大端头长度][头部文本][音频数据]
        // 控制帧（turn.start/response/audio.metadata）没有长度前缀，读到无效长度时直接忽略
        const headerLen = data.readUInt16BE(0);
        if (2 + headerLen >= data.length) return;
        const header = data.subarray(2, 2 + headerLen).toString('utf8');
        if (!header.includes('Path:audio\r\n')) return;
        chunks.push(Buffer.from(data.subarray(2 + headerLen)));
      });

      ws.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
      ws.on('close', () => {
        if (!settled) fail(new Error('Edge TTS 连接意外关闭'));
      });
    });
  }
}
