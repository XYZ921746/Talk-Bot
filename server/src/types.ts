// ===== 通用类型定义 =====

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
  /** 思考强度（推理模型，如 OpenAI o 系列）；仅 OpenAI 兼容接口生效 */
  reasoningEffort?: 'auto' | 'low' | 'medium' | 'high';
  /** 上下文长度（token，估算值）：保留最近多少 token，默认 1,000,000 */
  contextTokens?: number;
  /** 日记 / 对话压缩功能 */
  diaryEnabled?: boolean; // 总开关
  diaryMode?: 'auto' | 'manual'; // 自动触发 / 手动按钮
  diaryPressure?: 'low' | 'medium' | 'high'; // 强度：high 删除更多、diary 更简略；low 保留更多
  diaryTriggerMessages?: number; // 自动模式：历史消息达到该条数触发压缩
  diaryPrompt?: string; // 自定义压缩提示词（空 = 内置默认）。{content} 可用作对话内容占位
  diaryPeriod?: 'daily' | 'weekly'; // 记录周期：daily=日记（按天）、weekly=周记（按周）
}

export interface SttConfig {
  type: SttKind;
  baseUrl: string; // OpenAI 兼容端点（如 https://api.openai.com/v1 或本地 faster-whisper-server）
  apiKey: string;
  model: string; // 如 whisper-1
  language: string; // 留空 = 自动检测
  region?: string; // Azure 专用：如 eastasia
  /** 腾讯云 ASR：SecretId / SecretKey / 引擎类型 */
  tencentSecretId?: string;
  tencentSecretKey?: string;
  tencentEngine?: string; // 如 16k_zh、16k_zh-PY、16k_en
  /** 百度短语音识别：API Key / Secret Key */
  baiduApiKey?: string;
  baiduSecretKey?: string;
  /** 讯飞一句话识别：APPID / APIKey / APISecret / 语言 / 方言 */
  xfyunAppId?: string;
  xfyunApiKey?: string;
  xfyunApiSecret?: string;
  xfyunLanguage?: string; // zh_cn / en_us
  xfyunAccent?: string; // mandarin / cantonese / henan 等
}

export interface TtsConfig {
  type: TtsKind;
  baseUrl: string;
  apiKey: string;
  model: string; // 如 tts-1
  voice: string; // 如 alloy / zh-CN-XiaoxiaoNeural
  rate: number; // edge-tts 语速百分比增量，如 0 / 10 / -10
  language: string; // 目标输出语言，如 zh-CN / en-US（LLM 输出语言不符时自动翻译）
  readText: boolean; // 文字回复也朗读（打字聊天的回复同样合成语音）
  region?: string; // Azure 专用：如 eastasia
  customMethod?: 'GET' | 'POST'; // 自定义 HTTP TTS：请求方法
  customBody?: string; // 自定义 HTTP TTS：JSON 参数模板，{text} 会被替换为待合成文本
}

export interface VadConfig {
  threshold: number; // 语音能量阈值（RMS）
  silenceMs: number; // 判定一句话结束的静音时长
  maxSpeechMs: number; // 单句最长时长（强制截断）
}

export interface SessionConfig {
  llm: LlmConfig;
  stt: SttConfig;
  tts: TtsConfig;
  vad: VadConfig;
}

/** 聊天消息（内部归一化格式，同时被 openai / anthropic 适配器转换） */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[]; // 仅 assistant 消息携带
  toolCallId?: string; // 仅 tool 消息携带
}

/** LLM 工具定义（OpenAI function calling 的 JSON Schema 风格） */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** 文本增量回调（逐 token 流式输出） */
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  readonly kind: LlmKind;
  readonly displayName: string;
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult>;
}

export interface STTProvider {
  readonly kind: SttKind;
  readonly displayName: string;
  /** wavBuffer: 16kHz 单声道 16bit PCM WAV */
  transcribe(wavBuffer: Buffer, language: string): Promise<string>;
}

export interface TTSProvider {
  readonly kind: TtsKind;
  readonly displayName: string;
  readonly mime: string; // audio/mpeg 或 audio/wav
  synthesize(text: string, voice: string, rate: number, signal?: AbortSignal): Promise<Buffer>;
}

/** 人设 */
export interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  temperature?: number;
  voice?: string;
  language?: string; // 要求的回复语言，如 zh-CN / en-US；LLM 输出语言不符时自动翻译
  greeting?: string;
}

/** 插件上下文（传给每个插件钩子） */
export interface PluginContext {
  sessionId: string;
  persona: Persona | null;
  config: SessionConfig;
  log(...args: unknown[]): void;
  /** 会话级存储：插件可跨钩子、跨轮次共享数据（每个会话独立） */
  store: Record<string, unknown>;
}

/** 插件定义 */
export interface VoiceAssistantPlugin {
  name: string;
  version?: string;
  description?: string;
  /** 优先级：数值越大越先执行，默认 0 */
  priority?: number;
  hooks?: {
    onSessionStart?(ctx: PluginContext): Promise<void>;
    onSessionEnd?(ctx: PluginContext): Promise<void>;
    /** 用户文本进入 LLM 前，可改写（返回字符串则替换） */
    onUserText?(text: string, ctx: PluginContext): Promise<string | void>;
    /** LLM 回复后、展示/合成前，可改写 */
    onAssistantText?(text: string, ctx: PluginContext): Promise<string | void>;
    /** TTS 合成前，可改写文本（用于发音纠正、敏感词过滤等） */
    onBeforeTTS?(text: string, ctx: PluginContext): Promise<string | void>;
    /** 工具调用执行前，可改写参数 */
    onToolCall?(
      name: string,
      args: Record<string, unknown>,
      ctx: PluginContext,
    ): Promise<Record<string, unknown> | void>;
    /** 工具执行后，可改写结果 */
    onToolResult?(
      name: string,
      args: Record<string, unknown>,
      result: string,
      ctx: PluginContext,
    ): Promise<string | void>;
    onError?(error: unknown, ctx: PluginContext): Promise<void>;
  };
  tools?: ToolDef[];
  handleTool?(name: string, args: Record<string, unknown>, ctx: PluginContext): Promise<string | Record<string, unknown>>;
}

/** WebSocket 消息（客户端 → 服务端） */
export type ClientMsg =
  | { type: 'init'; config: SessionConfig; personaId?: string; mode?: 'voice' | 'text'; disabledPlugins?: string[] }
  | { type: 'text'; text: string }
  | { type: 'compress'; pressure?: 'low' | 'medium' | 'high'; dialog?: string }
  | { type: 'ping' };

/** WebSocket 消息（服务端 → 客户端） */
export type ServerMsg =
  | { type: 'ready'; sessionId: string; persona: Persona | null; greeting?: string }
  | { type: 'status'; status: 'listening' | 'stt' | 'thinking' | 'speaking' | 'idle' }
  | { type: 'stt_text'; text: string }
  | { type: 'assistant_start'; messageId: string }
  | { type: 'assistant_delta'; delta: string; messageId: string }
  | { type: 'assistant_text'; text: string; messageId: string }
  | { type: 'assistant_audio_start'; id: number; mime: string; text: string }
  | { type: 'assistant_audio_end'; id: number }
  | { type: 'interrupt' }
  | { type: 'compressed'; diary: string; removed: number }
  | { type: 'error'; message: string }
  | { type: 'pong'; t: number };
