import type { STTProvider, SttKind } from '../types.js';

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const ASR_URL = 'https://vop.baidu.com/server_api';
const TIMEOUT_MS = 30_000;

/**
 * 百度短语音识别（一句话）：
 *  1. 用 API Key / Secret Key 换取 access_token
 *  2. POST 音频 base64 到 /server_api 识别
 * dev_pid：1537 普通话(含简单英文)、1737 英文、1637 粤语、1937 普通话+英文
 */
export class BaiduSTT implements STTProvider {
  readonly kind: SttKind = 'baidu';
  readonly displayName = '百度语音识别';

  private tokenCache: { token: string; expires: number } | null = null;

  constructor(
    private cfg: { apiKey: string; secretKey: string; pid?: number },
  ) {}

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expires - 60_000) {
      return this.tokenCache.token;
    }
    const url = `${TOKEN_URL}?grant_type=client_credentials&client_id=${encodeURIComponent(this.cfg.apiKey)}&client_secret=${encodeURIComponent(this.cfg.secretKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'POST', signal: controller.signal });
      const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
      if (!json.access_token) {
        throw new Error(`获取 token 失败: ${json.error ?? res.status}: ${json.error_description ?? ''}`);
      }
      this.tokenCache = { token: json.access_token, expires: Date.now() + 30 * 24 * 3600 * 1000 }; // token 约 30 天有效
      return json.access_token;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('获取百度 token 超时');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async transcribe(wavBuffer: Buffer, _language: string): Promise<string> {
    if (!this.cfg.apiKey || !this.cfg.secretKey) {
      throw new Error('百度语音识别未配置 API Key / Secret Key');
    }
    const token = await this.getToken();
    const payload = JSON.stringify({
      format: 'wav',
      rate: 16000,
      channel: 1,
      cuid: 'ava-assistant',
      token,
      dev_pid: this.cfg.pid ?? 1537,
      speech: wavBuffer.toString('base64'),
      len: wavBuffer.length,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${ASR_URL}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      const json = (await res.json()) as { err_no?: number; err_msg?: string; result?: string[] };
      if (json.err_no !== 0) {
        throw new Error(`STT (百度语音) ${json.err_msg ?? json.err_no ?? res.status}`);
      }
      return (json.result?.[0] ?? '').trim();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('STT (百度语音) 请求超时');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
