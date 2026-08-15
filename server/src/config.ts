import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LlmConfig, SessionConfig, SttConfig, TtsConfig, VadConfig } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(__dirname, '..'); // server/
export const WORKSPACE_DIR = path.resolve(ROOT_DIR, '..'); // 项目根
export const PERSONA_DIR = process.env.PERSONA_DIR || path.join(ROOT_DIR, 'personas');
export const MODS_DIR = process.env.MODS_DIR || path.join(WORKSPACE_DIR, 'mods'); // 插件主目录（项目根/mods）
export const PLUGIN_DIR = path.join(ROOT_DIR, 'plugins'); // 兼容旧目录
export const WEB_DIST_DIR = path.join(WORKSPACE_DIR, 'web', 'dist');

export const SERVER_VERSION = '0.1.0';

const envStr = (key: string, fallback = '') => process.env[key]?.trim() ?? fallback;
const envNum = (key: string, fallback: number) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && process.env[key] !== undefined ? v : fallback;
};

/** 服务端默认配置：网页端留空的字段会用这些兜底 */
export function loadDefaults(): SessionConfig {
  const llm: LlmConfig = {
    type: (envStr('LLM_TYPE', 'openai') as LlmConfig['type']),
    baseUrl: envStr('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    apiKey: envStr('OPENAI_API_KEY'),
    model: envStr('LLM_MODEL', 'gpt-4o-mini'),
    temperature: envNum('LLM_TEMPERATURE', 0.7),
    maxTokens: envNum('LLM_MAX_TOKENS', 1024),
    reasoningEffort: (envStr('LLM_REASONING_EFFORT', 'auto') as LlmConfig['reasoningEffort']),
    contextTokens: envNum('LLM_CONTEXT_TOKENS', 1_000_000),
    diaryEnabled: envStr('LLM_DIARY_ENABLED', 'false') === 'true',
    diaryMode: (envStr('LLM_DIARY_MODE', 'auto') as LlmConfig['diaryMode']),
    diaryPressure: (envStr('LLM_DIARY_PRESSURE', 'medium') as LlmConfig['diaryPressure']),
    diaryTriggerMessages: envNum('LLM_DIARY_TRIGGER_MESSAGES', 30),
    diaryPrompt: envStr('LLM_DIARY_PROMPT'),
    diaryPeriod: (envStr('LLM_DIARY_PERIOD', 'daily') as LlmConfig['diaryPeriod']),
  };
  const stt: SttConfig = {
    type: (envStr('STT_TYPE', 'openai') as SttConfig['type']),
    baseUrl: envStr('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    apiKey: envStr('OPENAI_API_KEY'),
    model: envStr('STT_MODEL', 'whisper-1'),
    language: envStr('STT_LANGUAGE', ''),
    // 腾讯云 ASR
    tencentSecretId: envStr('TENCENT_SECRET_ID'),
    tencentSecretKey: envStr('TENCENT_SECRET_KEY'),
    tencentEngine: envStr('TENCENT_ASR_ENGINE', '16k_zh'),
    // 百度语音
    baiduApiKey: envStr('BAIDU_ASR_API_KEY'),
    baiduSecretKey: envStr('BAIDU_ASR_SECRET_KEY'),
    // 讯飞语音
    xfyunAppId: envStr('XFYUN_APP_ID'),
    xfyunApiKey: envStr('XFYUN_API_KEY'),
    xfyunApiSecret: envStr('XFYUN_API_SECRET'),
    xfyunLanguage: envStr('XFYUN_ASR_LANGUAGE', 'zh_cn'),
    xfyunAccent: envStr('XFYUN_ASR_ACCENT', 'mandarin'),
  };
  const tts: TtsConfig = {
    type: (envStr('TTS_TYPE', 'edge') as TtsConfig['type']),
    baseUrl: envStr('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    apiKey: envStr('OPENAI_API_KEY'),
    model: envStr('TTS_MODEL', 'tts-1'),
    voice: envStr('EDGE_TTS_VOICE', 'zh-CN-XiaoxiaoNeural'),
    rate: envNum('TTS_RATE', 0),
    language: envStr('TTS_LANGUAGE', 'zh-CN'),
    readText: envStr('TTS_READ_TEXT', 'true') !== 'false',
  };
  const vad: VadConfig = {
    threshold: envNum('VAD_THRESHOLD', 0.0316),
    silenceMs: envNum('VAD_SILENCE_MS', 650),
    maxSpeechMs: envNum('VAD_MAX_SPEECH_MS', 15000),
  };
  return { llm, stt, tts, vad };
}

/** 合并：客户端提交的配置优先（非空值覆盖默认值） */
export function mergeSessionConfig(base: SessionConfig, client?: Partial<SessionConfig>): SessionConfig {
  if (!client) return base;
  const pick = <T extends object>(def: T, over?: Partial<T>): T => {
    const out: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    if (over) {
      for (const k of Object.keys(over) as (keyof T)[]) {
        const v = (over as Record<string, unknown>)[k as string];
        if (v !== undefined && v !== null && v !== '') out[k as string] = v;
      }
    }
    return out as T;
  };
  return {
    llm: pick(base.llm, client.llm),
    stt: pick(base.stt, client.stt),
    tts: pick(base.tts, client.tts),
    vad: pick(base.vad, client.vad),
  };
}
