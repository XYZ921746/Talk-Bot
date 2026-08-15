import type { SessionConfig } from './types';

const KEY = 'ava.settings.v1';

export const DEFAULT_SETTINGS: SessionConfig = {
  llm: {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 1024,
    reasoningEffort: 'auto',
    contextTokens: 1_000_000,
    diaryEnabled: false,
    diaryMode: 'auto',
    diaryPressure: 'medium',
    diaryTriggerMessages: 30,
    diaryPrompt: '',
  },
  stt: {
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    language: '',
    tencentSecretId: '',
    tencentSecretKey: '',
    tencentEngine: '16k_zh',
    baiduApiKey: '',
    baiduSecretKey: '',
    xfyunAppId: '',
    xfyunApiKey: '',
    xfyunApiSecret: '',
    xfyunLanguage: 'zh_cn',
    xfyunAccent: 'mandarin',
  },
  tts: {
    type: 'edge',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'tts-1',
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: 0,
    language: 'zh-CN',
    readText: true,
    customMethod: 'POST',
  },
  vad: {
    threshold: 0.0316, // ≈ -30dB：配合麦克风增益，正常说话可触发且减少环境噪声误触发
    silenceMs: 650,
    maxSpeechMs: 15000,
  },
};

/** 深拷贝设置（兼容无 structuredClone 的旧浏览器） */
export function cloneSettings(s: SessionConfig): SessionConfig {
  return {
    llm: { ...s.llm },
    stt: { ...s.stt },
    tts: { ...s.tts },
    vad: { ...s.vad },
  };
}

export function loadSettings(): SessionConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return cloneSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<SessionConfig>;
    const merged: SessionConfig = {
      llm: { ...DEFAULT_SETTINGS.llm, ...parsed.llm },
      stt: { ...DEFAULT_SETTINGS.stt, ...parsed.stt },
      tts: { ...DEFAULT_SETTINGS.tts, ...parsed.tts },
      vad: { ...DEFAULT_SETTINGS.vad, ...parsed.vad },
    };
    // 配置迁移：旧版本触发阈值过低（环境噪声误触发）→ 自动提升到 -30dB（配合麦克风增益）
    if (merged.vad.threshold < 0.03) {
      merged.vad.threshold = 0.0316;
    }
    return merged;
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: SessionConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等场景下忽略 */
  }
}

export function resetSettings(): SessionConfig {
  const s = cloneSettings(DEFAULT_SETTINGS);
  saveSettings(s);
  return s;
}

// ===== 插件开关（禁用的插件名列表） =====
const PLUGIN_KEY = 'ava.plugins.v1';

export function loadDisabledPlugins(): string[] {
  try {
    const raw = localStorage.getItem(PLUGIN_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDisabledPlugins(list: string[]): void {
  try {
    localStorage.setItem(PLUGIN_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}
