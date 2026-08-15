import type { STTProvider, SttConfig } from '../types.js';
import { OpenAICompatibleSTT } from './openai.js';
import { AzureSTT } from './azure.js';
import { TencentSTT } from './tencent.js';
import { BaiduSTT } from './baidu.js';
import { XfyunSTT } from './xfyun.js';

export function createSTTProvider(cfg: SttConfig): STTProvider | null {
  switch (cfg.type) {
    case 'openai':
      return new OpenAICompatibleSTT({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
    case 'azure':
      return new AzureSTT({ apiKey: cfg.apiKey, region: cfg.region ?? '' });
    case 'tencent':
      return new TencentSTT({
        secretId: cfg.tencentSecretId ?? '',
        secretKey: cfg.tencentSecretKey ?? '',
        engine: cfg.tencentEngine ?? '16k_zh',
      });
    case 'baidu':
      return new BaiduSTT({ apiKey: cfg.baiduApiKey ?? '', secretKey: cfg.baiduSecretKey ?? '' });
    case 'xfyun':
      return new XfyunSTT({
        appId: cfg.xfyunAppId ?? '',
        apiKey: cfg.xfyunApiKey ?? '',
        apiSecret: cfg.xfyunApiSecret ?? '',
        language: cfg.xfyunLanguage,
        accent: cfg.xfyunAccent,
      });
    case 'none':
    default:
      return null;
  }
}
