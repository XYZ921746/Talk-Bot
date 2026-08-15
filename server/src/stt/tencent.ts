import { createHash, createHmac } from 'node:crypto';
import type { STTProvider, SttKind } from '../types.js';

const HOST = 'asr.tencentcloudapi.com';
const VERSION = '2019-06-14';
const ACTION = 'SentenceRecognition';
const SERVICE = 'asr';
const TIMEOUT_MS = 30_000;

/** 生成 TC3-HMAC-SHA256 签名头（腾讯云 API v3 签名） */
function tc3Sign(secretId: string, secretKey: string, timestamp: number, payload: string): string {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex');
  const hmacSha256 = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();

  // 1. CanonicalRequest（官方规范：x-tc-action 用 action 名全小写）
  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${HOST}\n` +
    `x-tc-action:${ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;

  // 2. StringToSign
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/${SERVICE}/tc3_request\n${sha256Hex(canonicalRequest)}`;

  // 3. 派生密钥并签名
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  return (
    `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${SERVICE}/tc3_request, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}

/**
 * 腾讯云语音识别（ASR）一句话版 SentenceRecognition。
 * 需要 SecretId / SecretKey（TC3 签名）。
 */
export class TencentSTT implements STTProvider {
  readonly kind: SttKind = 'tencent';
  readonly displayName = '腾讯云 ASR';

  constructor(
    private cfg: { secretId: string; secretKey: string; engine: string },
  ) {}

  async transcribe(wavBuffer: Buffer, _language: string): Promise<string> {
    if (!this.cfg.secretId || !this.cfg.secretKey) {
      throw new Error('腾讯云 ASR 未配置 SecretId / SecretKey');
    }
    const payload = JSON.stringify({
      ProjectId: 0,
      SubServiceType: 2,
      EngSerViceType: this.cfg.engine || '16k_zh',
      SourceType: 1, // 语音数据来自本地上传
      VoiceFormat: 'wav',
      UsrAudioKey: `ava_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      Data: wavBuffer.toString('base64'),
      DataLen: wavBuffer.length,
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = tc3Sign(this.cfg.secretId, this.cfg.secretKey, timestamp, payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://${HOST}/`, {
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json; charset=utf-8',
          Host: HOST,
          'X-TC-Action': ACTION,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Version': VERSION,
        },
        body: payload,
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        Response?: { Result?: string; Error?: { Code?: string; Message?: string } };
      };
      const resp = json.Response;
      if (!res.ok || !resp || resp.Error) {
        const err = resp?.Error;
        throw new Error(
          `STT (腾讯云 ASR) HTTP ${res.status}: ${err ? `${err.Code}: ${err.Message}` : JSON.stringify(json).slice(0, 300)}`,
        );
      }
      return (resp.Result ?? '').trim();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('STT (腾讯云 ASR) 请求超时');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
