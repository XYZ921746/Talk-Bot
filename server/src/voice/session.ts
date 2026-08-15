import type { WebSocket } from 'ws';
import type { ChatMessage, Persona, PluginContext, SessionConfig, ServerMsg } from '../types.js';
import { createLLMProvider } from '../llm/index.js';
import { createSTTProvider } from '../stt/index.js';
import { createTTSProvider } from '../tts/index.js';
import type { PluginManager } from '../plugins/manager.js';
import { computeRms, concatInt16, pcmToWav } from './wav.js';
import { detectLanguage, isSameLanguage, languageDisplayName } from './lang.js';
import { appendDiary, getDiary } from '../diary.js';

interface SessionDeps {
  ws: WebSocket;
  plugins: PluginManager;
}

const MAX_CONTEXT_TOKENS = 1_000_000; // 上下文默认上限（token 估算）
const MIN_UTTERANCE_SAMPLES = 2400; // 16kHz 下 0.15 秒（过短碎片丢弃，但保留"嗯/好"等短词）

/** 内置默认压缩提示词（自定义为空时用这个） */
const DEFAULT_DIARY_PROMPT =
  '你是对话记录员。请把下面用户与 AI 的对话整理成一篇第三人称"日记"，记录聊了什么、关键话题、重要的事实/偏好/承诺。' +
  '写作要求：{pressure} 用中文。只输出日记正文，不要任何解释。';

let sessionSeq = 0;

/**
 * 一个语音/文本会话：
 * 麦克风 PCM → VAD 静音检测 → STT → 插件钩子 → LLM（工具循环）→ 插件钩子 → TTS → 音频回传
 */
export class VoiceSession {
  private readonly sessionId = `s_${++sessionSeq}`;
  private readonly ws: WebSocket;
  private readonly plugins: PluginManager;
  private readonly config: SessionConfig;
  private readonly persona: Persona;
  private readonly mode: 'voice' | 'text';

  private llm: ReturnType<typeof createLLMProvider>;
  private stt: ReturnType<typeof createSTTProvider>;
  private tts: ReturnType<typeof createTTSProvider>;

  private history: ChatMessage[] = [];
  private disposed = false;

  // VAD 状态
  private vadState: 'idle' | 'speech' = 'idle';
  private pcmBuf: Int16Array[] = [];
  private silenceFrames = 0;
  private speechMs = 0;

  // 处理队列（同时只处理一句）
  private queue: Int16Array[] = [];
  private processing = false;

  // 打断控制
  private abortController: AbortController | null = null;
  private cancelTts = false;
  private audioId = 0;
  private audioFrameCount = 0; // 诊断：收到的音频帧计数
  private pendingSpeechFrames = 0; // 连续超过阈值帧计数（防噪声误触发）
  private readonly pluginStore: Record<string, unknown> = {}; // 会话级插件存储

  constructor(deps: SessionDeps, config: SessionConfig, persona: Persona, mode: 'voice' | 'text') {
    this.ws = deps.ws;
    this.plugins = deps.plugins;
    this.config = config;
    this.persona = persona;
    this.mode = mode;
    this.llm = createLLMProvider(config.llm);
    this.stt = createSTTProvider(config.stt);
    this.tts = createTTSProvider(config.tts);
  }

  // ===== 生命周期 =====

  async start(): Promise<void> {
    // 注入人设系统提示词（人设生效的核心；历史裁剪时会保留这条）
    const baseSys = this.persona.systemPrompt;
    // 日记功能开启时，把历史日记注入系统提示词，实现跨会话长期记忆
    if (this.config.llm.diaryEnabled) {
      try {
        const diaryText = getDiary(this.persona.id);
        if (diaryText) {
          this.pushHistory({ role: 'system', content: `${baseSys}\n\n【历史日记（之前对话的压缩记录）】\n${diaryText}` });
        } else {
          this.pushHistory({ role: 'system', content: baseSys });
        }
      } catch {
        this.pushHistory({ role: 'system', content: baseSys });
      }
    } else {
      this.pushHistory({ role: 'system', content: baseSys });
    }
    this.send({ type: 'ready', sessionId: this.sessionId, persona: this.persona, greeting: this.persona.greeting });
    try {
      await this.plugins.onSessionStart(this.makeCtx());
    } catch (err) {
      this.log('onSessionStart 钩子异常', err);
    }
    // 语音模式下播放人设问候语
    if (this.mode === 'voice' && this.persona.greeting && this.tts) {
      try {
        await this.speak(this.persona.greeting, true);
      } catch {
        /* 问候语失败不阻塞 */
      }
      this.send({ type: 'status', status: 'listening' });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController?.abort();
    this.plugins.onSessionEnd(this.makeCtx()).catch(() => {});
  }

  // ===== 音频（语音通话） =====

  /** 接收客户端 PCM 帧（16kHz 单声道 16bit），做 VAD 检测 */
  handleAudio(buffer: Buffer): void {
    if (this.disposed) return;
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
    const frameMs = (samples.length / 16000) * 1000;
    const rms = computeRms(samples);

    // 诊断：音频帧到达但从未触发 VAD 时，周期性提示（避免刷屏）
    if (this.vadState === 'idle' && rms < this.config.vad.threshold) {
      this.audioFrameCount++;
      if (this.audioFrameCount === 1 || this.audioFrameCount % 150 === 0) {
        this.log(`[诊断] 收到音频帧 rms=${rms.toFixed(4)}（阈值 ${this.config.vad.threshold}，未触发语音）第${this.audioFrameCount}帧`);
      }
    }

    if (this.vadState === 'idle') {
      if (rms >= this.config.vad.threshold) {
        // 连续 2 帧超过阈值才判定开始说话（防单帧噪声误触发）
        this.pendingSpeechFrames++;
        if (this.pendingSpeechFrames >= 2) {
          this.pendingSpeechFrames = 0;
          this.log(`[诊断] VAD 触发语音：rms=${rms.toFixed(4)}（第${this.audioFrameCount}帧）`);
          // 开始说话 → 打断正在进行的回复
          this.cancelInFlight();
          this.vadState = 'speech';
          this.pcmBuf = [samples];
          this.silenceFrames = 0;
          this.speechMs = frameMs;
        }
      } else {
        this.pendingSpeechFrames = 0;
      }
      return;
    }

    this.pcmBuf.push(samples);
    this.speechMs += frameMs;
    this.silenceFrames = rms < this.config.vad.threshold * 0.6 ? this.silenceFrames + 1 : 0;
    const silenceMs = this.silenceFrames * frameMs;
    if (silenceMs >= this.config.vad.silenceMs || this.speechMs >= this.config.vad.maxSpeechMs) {
      this.log(`[诊断] 断句完成：${(this.speechMs / 1000).toFixed(1)}s 语音`);
      this.finishUtterance();
    }
  }

  private finishUtterance(): void {
    const pcm = concatInt16(this.pcmBuf);
    this.pcmBuf = [];
    this.vadState = 'idle';
    if (pcm.length < MIN_UTTERANCE_SAMPLES) return;
    this.queue.push(pcm);
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length && !this.disposed) {
        const pcm = this.queue.shift()!;
        await this.processUtterance(pcm);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processUtterance(pcm: Int16Array): Promise<void> {
    // 本次句子的独立控制：LLM 调用的取消只受超时/挂断影响，绝不被后续 VAD 触发误杀
    this.cancelTts = false;
    this.log(`[语音] 处理语音片段，${(pcm.length / 16000).toFixed(1)}s，${pcm.length} 样本`);
    const ctx = this.makeCtx();
    try {
      if (!this.stt) {
        this.log('STT 未配置（type=none），无法语音识别');
        this.send({
          type: 'error',
          message:
            '未配置语音识别（STT）。请到 设置 → 语音识别 选择「OpenAI 兼容」并填写地址（如 http://127.0.0.1:8000/v1，对应 Qwen3-ASR），保存后重新进入会话再试。',
        });
        return;
      }
      this.send({ type: 'status', status: 'stt' });
      const wav = pcmToWav(pcm, 16000);
      this.log(`[语音] 调用 STT（${this.stt.displayName}），音频 ${wav.length} 字节`);
      const text = (await this.stt.transcribe(wav, this.config.stt.language)).trim();
      this.log(`[语音] STT 结果: "${text.slice(0, 30)}"`);
      if (!text) {
        // 识别为空：给用户可见反馈，避免"说话没反应"
        this.send({ type: 'error', message: '没听清你说的话，请靠近麦克风、音量稍大再说一遍' });
        this.send({ type: 'status', status: 'listening' });
        return;
      }
      this.send({ type: 'stt_text', text });

      this.log(`[语音] 调 LLM（用户: ${text.slice(0, 20)}）`);
      const final = await this.runTurn(text, ctx, false);
      this.maybeAutoCompress();
      this.log(`[语音] LLM 完成`);
      if (final && this.tts) {
        this.send({ type: 'status', status: 'speaking' });
        try {
          await this.speak(final, false);
        } catch (err) {
          // TTS 合成失败时回退为文字展示，保证用户至少看到回复
          const mid = `m_${Date.now().toString(36)}`;
          this.send({ type: 'assistant_start', messageId: mid });
          this.send({ type: 'assistant_text', text: final, messageId: mid });
          throw err; // 交给外层 handleError 提示
        }
      }
      this.send({ type: 'status', status: 'listening' });
    } catch (err) {
      await this.handleError(err, ctx);
      this.send({ type: 'status', status: 'listening' });
    }
  }

  // ===== 文本聊天 =====

  async handleTextMessage(text: string): Promise<void> {
    if (this.disposed || !text.trim()) return;
    // 文字模式：切换会话/挂断时可取消
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.cancelTts = false;
    const ctx = this.makeCtx();
    this.send({ type: 'status', status: 'thinking' });
    try {
      await this.runTurn(text, ctx, true, this.abortController.signal);
      this.maybeAutoCompress();
      this.send({ type: 'status', status: 'idle' });
    } catch (err) {
      await this.handleError(err, ctx);
      this.send({ type: 'status', status: 'idle' });
    }
  }

  // ===== 日记 / 对话压缩 =====

  /** 手动压缩入口（对话框按钮触发）。dialogText 为前端传来的完整对话文本（不受服务端 session 历史限制）。 */
  async handleCompress(pressure?: 'low' | 'medium' | 'high', dialogText?: string): Promise<void> {
    if (this.disposed) return;
    const mode = pressure ?? this.config.llm.diaryPressure ?? 'medium';
    this.log(`[日记] === 手动压缩开始（强度 ${mode}）===`);
    this.log(`[日记] 前端传入对话: ${dialogText ? `${dialogText.length} 字符` : '无'}`);
    try {
      const removed = await this.compressHistory(mode, dialogText);
      this.log(`[日记] === 手动压缩完成，清理 ${removed} 条历史 ===`);
      this.send({ type: 'status', status: 'idle' });
    } catch (err) {
      this.log('[日记] 手动压缩异常:', err instanceof Error ? err.message : err);
      await this.handleError(err, this.makeCtx());
    }
  }

  /** 自动触发检查：历史消息条数超过阈值时压缩（在每次回复后调用） */
  private maybeAutoCompress(): void {
    if (!this.config.llm.diaryEnabled || this.config.llm.diaryMode !== 'auto') return;
    const trigger = Math.max(10, this.config.llm.diaryTriggerMessages ?? 30);
    // 去掉 system 消息后的对话条数
    const dialogCount = this.history.filter((m) => m.role !== 'system').length;
    if (dialogCount >= trigger) {
      const pressure = this.config.llm.diaryPressure ?? 'medium';
      this.log(`[日记] 历史达 ${dialogCount} 条（>= ${trigger}），触发自动压缩`);
      this.compressHistory(pressure).catch((err) =>
        this.log('[日记] 自动压缩失败:', err instanceof Error ? err.message : err),
      );
    }
  }

  /**
   * 把对话压缩成一篇日记并持久化，然后清空服务端历史（保留 system 提示）。
   * dialogText 优先（前端完整对话）；否则用服务端 session 历史。
   * @returns 被压缩/清理的对话条数
   */
  private async compressHistory(pressure: 'low' | 'medium' | 'high', dialogText?: string): Promise<number> {
    // 前端传来的完整对话：拼成 user 消息数组；否则用服务端 session 历史
    let dialog: ChatMessage[];
    let dialogFromServer = 0;
    if (dialogText && dialogText.trim()) {
      dialog = [{ role: 'user', content: dialogText.trim() }];
    } else {
      const hist = this.history.filter((m) => m.role !== 'system');
      dialog = hist;
      dialogFromServer = hist.length;
    }

    if (dialog.length === 0 || (dialogFromServer === 0 && !(dialogText && dialogText.trim()))) {
      this.log('[日记] 没有可压缩的对话内容');
      this.send({ type: 'error', message: '当前没有可压缩的对话内容。请先和 AI 聊几句再压缩。' });
      return 0;
    }

    const inputChars = dialog.reduce((n, m) => n + String(m.content ?? '').length, 0);
    this.log(`[日记] 待压缩 ${dialog.length} 条 / ${inputChars} 字符（强度 ${pressure}）`);

    const pressureDesc =
      pressure === 'high'
        ? '只记录最关键的事实、决定和结论，尽量简略，忽略日常寒暄与细节，总长度控制在 200 字以内。'
        : pressure === 'low'
          ? '尽量详细地保留对话内容，包括具体话题、观点和重要细节，并给出每段的简要概括，可到 600 字以上。'
          : '记录主要话题、关键问答和重要结论，适度保留细节，简洁但不丢重点，约 300 字。';

    // 自定义提示词优先；否则用内置默认（含 {pressure}/{content} 占位符）
    const custom = this.config.llm.diaryPrompt?.trim();
    const period = this.config.llm.diaryPeriod ?? 'daily';
    const periodDesc = period === 'weekly' ? '这是本周的周记，请按本周发生的事来写。' : '这是今天的日记，请按今天发生的事来写。';
    const dialogTextContent = dialog.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${String(m.content ?? '')}`).join('\n');
    const sysPrompt = custom
      ? custom.replaceAll('{pressure}', pressureDesc).replaceAll('{content}', dialogTextContent).replaceAll('{period}', periodDesc)
      : DEFAULT_DIARY_PROMPT.replaceAll('{pressure}', pressureDesc).replaceAll('{period}', periodDesc);

    const messages: ChatMessage[] = [{ role: 'system', content: sysPrompt }, ...dialog];
    this.log(`[日记] 提示词: ${custom ? '自定义' : '内置默认'}（${sysPrompt.length} 字符），周期 ${period}`);

    this.log('[日记] 正在调用模型写日记…');
    const result = await this.llm.chat(messages, {
      temperature: 0.4,
      maxTokens: Math.max(this.config.llm.maxTokens, 1024),
      signal: AbortSignal.timeout(45_000),
    });

    const diaryText = (result.text ?? '').trim();
    this.log(`[日记] 模型返回 ${diaryText.length} 字符`);
    if (!diaryText) {
      this.send({ type: 'error', message: '写日记没拿到内容（模型返回为空），请重试或降低强度' });
      return 0;
    }

    // 加日期标题：按天=当天日期；按周=本周（周一~周日）
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    let title: string;
    if (period === 'weekly') {
      const day = (now.getDay() + 6) % 7; // 周一=0
      const mon = new Date(now);
      mon.setDate(now.getDate() - day);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      title = `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())} ~ ${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}（周记）`;
    } else {
      title = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}（日记）`;
    }
    const titledDiary = `## ${title}\n${diaryText}`;

    // 持久化日记（带日期标题）
    try {
      appendDiary(this.persona.id, titledDiary);
      this.log('[日记] 已持久化到 diaries/' + this.persona.id + '.json');
    } catch (err) {
      this.log('[日记] 持久化失败:', err instanceof Error ? err.message : err);
    }

    // 清空服务端历史，用「基础人设 + 最新完整日记」重建系统消息（避免旧日记重复累加）
    let fullDiary = '';
    try {
      fullDiary = getDiary(this.persona.id);
    } catch {
      /* ignore */
    }
    this.history = [
      {
        role: 'system',
        content: fullDiary
          ? `${this.persona.systemPrompt}\n\n【历史日记（之前对话的压缩记录）】\n${fullDiary}`
          : this.persona.systemPrompt,
      },
    ];

    this.send({ type: 'compressed', diary: titledDiary, removed: dialogFromServer || dialog.length });
    this.log(`[日记] 压缩完成，历史 ${dialog.length} 条已替换为日记`);
    return dialog.length;
  }

  // ===== 核心管道：STT 文本 / 输入文本 → LLM（含工具循环）→ 最终文本 =====

  private async runTurn(userText: string, ctx: PluginContext, stream: boolean, signal?: AbortSignal): Promise<string> {
    const messageId = genMessageId();
    const finalUserText = await this.plugins.onUserText(userText, ctx);
    this.pushHistory({ role: 'user', content: finalUserText });

    const tools = this.plugins.tools;
    const onDelta = stream
      ? (delta: string) => {
          this.send({ type: 'assistant_start', messageId });
          this.send({ type: 'assistant_delta', delta, messageId });
        }
      : undefined;

    let reply = await this.llm.chat(this.history, {
      tools,
      temperature: this.persona.temperature ?? this.config.llm.temperature,
      maxTokens: this.config.llm.maxTokens,
      onDelta,
      signal,
    });

    let guard = 0;
    while (reply.toolCalls?.length && guard++ < 8) {
      this.pushHistory({ role: 'assistant', content: reply.text ?? '', toolCalls: reply.toolCalls });
      for (const tc of reply.toolCalls) {
        let result: string;
        try {
          result = await this.plugins.handleTool(tc.name, tc.args, ctx);
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
        this.pushHistory({ role: 'tool', content: result, toolCallId: tc.id });
      }
      reply = await this.llm.chat(this.history, { tools, temperature: this.config.llm.temperature, maxTokens: this.config.llm.maxTokens, signal });
    }

    let final = reply.text ?? '';
    this.pushHistory({ role: 'assistant', content: final });
    final = (await this.plugins.onAssistantText(final, ctx)) || '';
    if (!final) final = '好的，已经处理好了。';

    // 语言一致性：人设/TTS 要求的目标语言与输出语言不符时，翻译后再展示/合成
    const targetLang = this.targetLang();
    if (targetLang && !isSameLanguage(detectLanguage(final), targetLang)) {
      const translated = await this.translateTo(final, targetLang);
      if (translated && translated.trim()) final = translated.trim();
    }

    if (stream) {
      this.send({ type: 'assistant_start', messageId });
      this.send({ type: 'assistant_text', text: final, messageId });
      // 文字回复朗读：开启后，打字聊天的回复同样合成语音（失败不阻塞文本，但给出可见提示）
      if (this.config.tts.readText && this.tts && final.trim()) {
        try {
          await this.speak(final, false);
        } catch (err) {
          if (!(err instanceof Error && err.name === 'AbortError')) {
            this.log('文字朗读失败:', err instanceof Error ? err.message : err);
            this.send({
              type: 'error',
              message: `语音合成失败：${err instanceof Error ? err.message.slice(0, 200) : String(err)}`,
            });
          }
        }
      }
    }
    return final;
  }

  /** 目标输出语言：人设优先，其次 TTS 配置；空 = 不强制翻译 */
  private targetLang(): string {
    return this.persona.language?.trim() || this.config.tts.language?.trim() || '';
  }

  /** 用当前 LLM 把文本翻译成目标语言；失败时返回原文 */
  private async translateTo(text: string, lang: string): Promise<string> {
    try {
      this.log(`[翻译] ${detectLanguage(text)} -> ${lang}: ${text.slice(0, 40)}`);
      const r = await this.llm.chat(
        [
          {
            role: 'system',
            content:
              `你是专业翻译引擎。把用户输入的文本翻译成${languageDisplayName(lang)}。` +
              '只输出翻译结果本身，不要任何解释、引号或多余文字。',
          },
          { role: 'user', content: text },
        ],
        { temperature: 0.2, maxTokens: Math.max(this.config.llm.maxTokens, 1024), signal: this.abortController?.signal },
      );
      return (r.text ?? '').trim();
    } catch (err) {
      this.log('翻译失败，使用原文:', err instanceof Error ? err.message : err);
      return text;
    }
  }

  /** 粗略估算一条消息的 token 数（中文约 1 token/字，英文约 1 token/4 字符，按字符数 0.6 折算） */
  private static estimateTokens(msg: ChatMessage): number {
    let len = msg.content.length;
    if (msg.toolCalls?.length) len += JSON.stringify(msg.toolCalls).length;
    if (msg.toolCallId) len += msg.toolCallId.length;
    return Math.max(1, Math.round(len * 0.6));
  }

  private pushHistory(msg: ChatMessage): void {
    this.history.push(msg);
    // 上下文长度（token 估算）：超过上限时从最前面裁剪，始终保留人设 system 消息
    const limit = Math.max(4_000, Math.min(50_000_000, this.config.llm.contextTokens ?? MAX_CONTEXT_TOKENS));
    let total = this.history.reduce((sum, m) => sum + VoiceSession.estimateTokens(m), 0);
    while (total > limit && this.history.length > 2) {
      const removed = this.history[0];
      if (removed.role === 'system') break; // 人设提示词不能丢
      this.history.shift();
      total -= VoiceSession.estimateTokens(removed);
    }
  }

  // ===== TTS =====

  private async speak(text: string, isGreeting: boolean): Promise<void> {
    this.cancelTts = false;
    const signal = this.abortController?.signal;
    // TTS 前钩子：允许插件改写文本（发音纠正、敏感词过滤等），内部已错误隔离
    let finalText = text;
    try {
      const r = await this.plugins.onBeforeTTS(text, this.makeCtx());
      if (r.trim()) finalText = r;
    } catch {
      /* onBeforeTTS 已内部隔离，此处兜底 */
    }
    if (!finalText.trim()) return;
    const voice = this.persona.voice ?? this.config.tts.voice;
    const audio = await this.tts!.synthesize(finalText, voice, this.config.tts.rate, signal);
    if (!audio.length || this.cancelTts || this.disposed) return;
    const id = ++this.audioId;
    this.send({ type: 'assistant_audio_start', id, mime: this.tts!.mime, text: finalText });
    const CHUNK = 16 * 1024;
    for (let i = 0; i < audio.length; i += CHUNK) {
      if (this.cancelTts || this.disposed) break;
      this.ws.send(audio.subarray(i, i + CHUNK));
    }
    this.send({ type: 'assistant_audio_end', id });
  }

  /** 用户开始说话：打断正在进行的回复 */
  private cancelInFlight(): void {
    this.send({ type: 'interrupt' });
    this.cancelTts = true;
    this.abortController?.abort();
  }

  // ===== 工具 =====

  private async handleError(err: unknown, ctx: PluginContext): Promise<void> {
    // 被用户打断（又说了话/环境音触发 VAD）：静默中止即可，但给出轻提示避免"没反应"的错觉
    if (err instanceof Error && err.name === 'AbortError') {
      this.send({ type: 'status', status: 'listening' });
      return;
    }
    this.log('错误', err);
    try {
      await this.plugins.onError(err, ctx);
    } catch {
      /* ignore */
    }
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    const msg = isTimeout
      ? '模型响应超时，请稍后重试（或检查模型网关连接）'
      : err instanceof Error
        ? err.message
        : String(err);
    this.send({ type: 'error', message: msg.slice(0, 300) });
  }

  private makeCtx(): PluginContext {
    return {
      sessionId: this.sessionId,
      persona: this.persona,
      config: this.config,
      log: (...args: unknown[]) => this.log(...args),
      store: this.pluginStore,
    };
  }

  private send(msg: ServerMsg | Buffer): void {
    if (this.disposed) return;
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(Buffer.isBuffer(msg) ? msg : JSON.stringify(msg));
    }
  }

  private log(...args: unknown[]): void {
    console.log(`[session ${this.sessionId}]`, ...args);
  }
}

function genMessageId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
