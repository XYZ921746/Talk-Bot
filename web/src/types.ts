// ===== 与服务端共享的类型（客户端侧镜像） =====

export type LlmKind = 'openai' | 'anthropic';
export type SttKind = 'openai' | 'azure' | 'tencent' | 'baidu' | 'xfyun' | 'none';
export type TtsKind = 'edge' | 'openai' | 'azure' | 'custom' | 'none';

export interface LlmConfig {
  type: LlmKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort?: 'auto' | 'low' | 'medium' | 'high';
  contextTokens?: number;
  diaryEnabled?: boolean;
  diaryMode?: 'auto' | 'manual';
  diaryPressure?: 'low' | 'medium' | 'high';
  diaryTriggerMessages?: number;
  diaryPrompt?: string;
  diaryPeriod?: 'daily' | 'weekly';
}

export interface SttConfig {
  type: SttKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
  region?: string;
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentEngine?: string;
  baiduApiKey?: string;
  baiduSecretKey?: string;
  xfyunAppId?: string;
  xfyunApiKey?: string;
  xfyunApiSecret?: string;
  xfyunLanguage?: string;
  xfyunAccent?: string;
}

export interface TtsConfig {
  type: TtsKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  rate: number;
  language: string; // 目标输出语言，如 zh-CN / en-US（LLM 输出语言不符时自动翻译）
  readText: boolean; // 文字回复也朗读
  region?: string;
  customMethod?: 'GET' | 'POST'; // 自定义 HTTP TTS：请求方法
  customBody?: string; // 自定义 HTTP TTS：JSON 参数模板，{text} 为文本占位
}

export interface VadConfig {
  threshold: number;
  silenceMs: number;
  maxSpeechMs: number;
}

export interface SessionConfig {
  llm: LlmConfig;
  stt: SttConfig;
  tts: TtsConfig;
  vad: VadConfig;
}

export interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature?: number;
  voice?: string;
  language?: string;
  greeting?: string;
}

export interface PluginInfo {
  name: string;
  version?: string;
  description?: string;
  tools?: string[];
}

export interface BootstrapData {
  version: string;
  personas: Persona[];
  plugins: PluginInfo[];
  llmKinds: string[];
  sttKinds: string[];
  ttsKinds: string[];
}

export type SessionStatus = 'idle' | 'listening' | 'stt' | 'thinking' | 'speaking';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming?: boolean;
  audio?: boolean;
  /** 消息时间戳（毫秒），用于像 QQ 一样展示时间 */
  time?: number;
}
