import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, MicOff, Pause, PhoneOff, Play, Send, Trash2 } from 'lucide-react';
import { VoiceClient } from '../ws';
import { MicRecorder } from '../audio/recorder';
import { AudioPlayer } from '../audio/player';
import type { Conversation } from '../conversations';
import type { ChatMsg, Persona, SessionConfig, SessionStatus } from '../types';
import { compressDialog } from '../api';
import type { Translate } from '../i18n';

interface Props {
  conv: Conversation;
  persona: Persona | null;
  settings: SessionConfig;
  disabledPlugins: string[];
  deepThink: 'on' | 'off';
  onToggleDeepThink(): void;
  onMessagesChange(convId: string, msgs: ChatMsg[]): void;
  onBack?(): void;
  onDelete(): void;
  t: Translate;
}

function genId(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 均衡器条高度：由真实麦克风电平驱动，各条带不同权重（模拟频谱） */
const EQ_FACTORS = [1, 0.62, 0.85, 0.5, 0.72, 0.92];
function eqHeight(level: number, index: number): number {
  const v = level * 95 * EQ_FACTORS[index % EQ_FACTORS.length];
  return Math.max(8, Math.min(100, v));
}

/** 消息时间格式化（QQ 风格）：今天显示 HH:MM，否则 MM-DD HH:MM */
function formatMsgTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return hm;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

export function ChatView({ conv, persona, settings, disabledPlugins, deepThink, onToggleDeepThink, onMessagesChange, onBack, onDelete, t }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>(() => conv.messages);
  const [connected, setConnected] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [micLevel, setMicLevel] = useState(0);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const clientRef = useRef<VoiceClient | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const audioChunksRef = useRef<Map<number, ArrayBuffer[]>>(new Map());
  // QQ 式回放：缓存每条语音消息的音频数据
  const replayCacheRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const replayPlayerRef = useRef<AudioPlayer | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const callActiveRef = useRef(false);
  callActiveRef.current = callActive;
  // AI 正在说话时暂停发送麦克风（防止麦克风拾取 AI 自己的声音造成回声自打断）
  const aiSpeakingRef = useRef(false);
  // 记录最近一条"流式显示"的助手文字消息（用于文字模式朗读时把同一条标为语音，避免重复气泡）
  const lastTextMsgRef = useRef<{ id: string; text: string } | null>(null);
  // 压缩进行中，防止重复触发
  const compressingRef = useRef(false);

  // 消息变更持久化到会话
  useEffect(() => {
    onMessagesChange(conv.id, messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const pushMsg = useCallback((m: ChatMsg) => {
    // 消息自动带上时间（用于 QQ 样式时间显示）
    setMessages((prev) => [...prev, { ...m, time: m.time ?? Date.now() }]);
  }, []);

  /** 统一创建/获取播放器：保证任何路径创建的播放器都注册 onIdle，避免 aiSpeakingRef 卡死 */
  const ensurePlayer = useCallback((): AudioPlayer => {
    if (!playerRef.current) {
      playerRef.current = new AudioPlayer();
      playerRef.current.setOnIdle(() => {
        aiSpeakingRef.current = false;
      });
    }
    return playerRef.current;
  }, []);

  // QQ 式点击回放语音消息
  const replayAudio = useCallback(
    (msgId: string) => {
      const buf = replayCacheRef.current.get(msgId);
      if (!buf) return;
      if (!replayPlayerRef.current) replayPlayerRef.current = new AudioPlayer();
      const p = replayPlayerRef.current;
      if (playingId === msgId) {
        p.stop();
        setPlayingId(null);
        return;
      }
      p.resume();
      setPlayingId(msgId);
      void p.replay(buf, () => setPlayingId(null));
    },
    [playingId],
  );

  const ensureClient = useCallback((): VoiceClient => {
    if (clientRef.current) return clientRef.current;
    clientRef.current = new VoiceClient({
      onOpen: () => setConnected(true),
      onClose: () => {
        setConnected(false);
        setStatus('idle');
        if (callActiveRef.current) void stopCallRef.current();
      },
      onReady: () => {
        /* 问候语通过 audio_start 消息展示 */
      },
      onStatus: (s) => setStatus(s),
      onSttText: (text) => pushMsg({ id: genId(), role: 'user', text }),
      onAssistantStart: (messageId) => {
        setMessages((prev) =>
          prev.some((m) => m.id === messageId)
            ? prev
            : [...prev, { id: messageId, role: 'assistant', text: '', streaming: true }],
        );
      },
      onAssistantDelta: (delta, messageId) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: m.text + delta, streaming: true } : m)),
        );
      },
      onAssistantText: (text, messageId) => {
        // 记录最近一条流式文字消息，供 onAudioStart 朗读去重
        lastTextMsgRef.current = { id: messageId, text };
        setMessages((prev) => {
          if (prev.some((m) => m.id === messageId)) {
            return prev.map((m) => (m.id === messageId ? { ...m, text, streaming: false } : m));
          }
          return [...prev, { id: messageId, role: 'assistant', text, streaming: false }];
        });
      },
      onAudioStart: (id, _mime, text) => {
        // AI 开始说话：暂停麦克风上行，防止回声自打断
        aiSpeakingRef.current = true;
        setMessages((prev) => {
          // 文字模式朗读：若刚流式显示的同一条文字消息正被朗读 → 把它标记为语音（不新建，避免重复气泡）
          const last = lastTextMsgRef.current;
          if (last && last.text === text) {
            const hit = prev.find((m) => m.id === last.id);
            if (hit && hit.role === 'assistant' && !hit.audio) {
              lastTextMsgRef.current = null; // 只合并一次
              return prev.map((m) => (m.id === last.id ? { ...m, audio: true } : m));
            }
          }
          // 语音模式（无流式文字先行）或多句语音：每条以独立语音消息展示，避免文字被吞
          return prev.some((m) => m.id === `a${id}`)
            ? prev
            : [...prev, { id: `a${id}`, role: 'assistant', text, audio: true, time: Date.now() }];
        });
        audioChunksRef.current.set(id, []);
      },
      onAudioChunk: (id, chunk) => {
        const arr = audioChunksRef.current.get(id);
        if (arr) arr.push(chunk);
      },
      onAudioEnd: (id) => {
        const chunks = audioChunksRef.current.get(id);
        audioChunksRef.current.delete(id);
        if (chunks?.length) {
          const total = chunks.reduce((n, c) => n + c.byteLength, 0);
          const merged = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) {
            merged.set(new Uint8Array(c), off);
            off += c.byteLength;
          }
          // 缓存音频供 QQ 式点击回放
          const msgId = `a${id}`;
          replayCacheRef.current.set(msgId, merged.buffer.slice(0));
          void ensurePlayer().play(merged.buffer);
        }
      },
      onInterrupt: () => {
        // 打断时立即恢复麦克风，避免 aiSpeakingRef 卡死
        aiSpeakingRef.current = false;
        playerRef.current?.stop();
        setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
      },
      onCompressed: (diary, removed) => {
        // 对话被压缩成日记：清空之前的消息与音频缓存，日记作为一条 AI 对话消息展示（不朗读）
        aiSpeakingRef.current = false;
        compressingRef.current = false;
        audioChunksRef.current.clear();
        replayCacheRef.current.clear();
        replayPlayerRef.current?.stop();
        replayPlayerRef.current = null;
        setMessages([
          {
            id: genId(),
            role: 'assistant',
            text: diary || `（对话已压缩成日记，共 ${removed} 条历史已归档）`,
            time: Date.now(),
          },
        ]);
      },
      onError: (message) => {
        compressingRef.current = false;
        pushMsg({ id: genId(), role: 'system', text: `⚠️ ${message}` });
      },
    });
    return clientRef.current;
  }, [ensurePlayer, pushMsg]);

  const connect = useCallback(
    (mode: 'voice' | 'text') => {
      // 深度思考开关：开 → reasoningEffort=high；关 → auto
      const llm =
        deepThink === 'on'
          ? { ...settings.llm, reasoningEffort: 'high' as const }
          : { ...settings.llm, reasoningEffort: 'auto' as const };
      ensureClient().connect({ ...settings, llm }, conv.personaId, mode, disabledPlugins);
    },
    [ensureClient, settings, conv.personaId, disabledPlugins, deepThink],
  );

  // 进入会话即建立连接（文字模式），切换会话时断开
  useEffect(() => {
    connect('text');
    return () => {
      clientRef.current?.close();
      playerRef.current?.dispose();
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
    };
  }, [connect]);

  const stopCall = useCallback(async () => {
    aiSpeakingRef.current = false;
    setCallActive(false);
    setStatus('idle');
    setMicLevel(0);
    await recorderRef.current?.stop().catch(() => {});
    recorderRef.current = null;
    playerRef.current?.stop();
    clientRef.current?.close();
  }, []);
  const stopCallRef = useRef(stopCall);
  stopCallRef.current = stopCall;

  const startCall = useCallback(async () => {
    if (callActiveRef.current) return;
    // 语音通话前置检查：STT 未配置时直接提示，避免白试
    const stt = settings.stt;
    if (stt.type === 'none' || !stt.baseUrl.trim()) {
      pushMsg({
        id: genId(),
        role: 'system',
        text:
          '⚠️ 未配置语音识别（STT）：请到 设置 → 语音识别 选择「OpenAI 兼容」并填写地址（如 http://127.0.0.1:8000/v1，对应 Qwen3-ASR）后重试',
      });
      return;
    }
    setCallActive(true);
    try {
      // 重新开始通话：确保麦克风上行不被历史 aiSpeakingRef 卡死
      aiSpeakingRef.current = false;
      const player = ensurePlayer();
      player.resume();
      connect('voice');
      const rec = new MicRecorder();
      recorderRef.current = rec;
      await rec.start({
        // AI 说话时不发送麦克风，避免回声触发 VAD 自打断
        onPcm: (pcm) => {
          if (!aiSpeakingRef.current) clientRef.current?.sendAudio(pcm);
        },
        onLevel: (rms) => setMicLevel(Math.min(1, rms * 35)),
      });
      setStatus('listening');
      pushMsg({ id: genId(), role: 'system', text: t('sys.callConnected') });
    } catch (err) {
      setCallActive(false);
      aiSpeakingRef.current = false;
      playerRef.current?.dispose();
      playerRef.current = null;
      pushMsg({
        id: genId(),
        role: 'system',
        text: t('sys.micError', { msg: err instanceof Error ? err.message : String(err) }),
      });
    }
  }, [connect, ensurePlayer, pushMsg, t]);

  const sendText = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || sending) return;
      setSending(true);
      // 确保文字回复朗读的播放器存在（在用户手势内创建 AudioContext），且带 onIdle 复位
      ensurePlayer().resume();
      pushMsg({ id: genId(), role: 'user', text: value });
      setInput('');
      clientRef.current?.sendText(value);
      setStatus('thinking');
      setTimeout(() => setSending(false), 600);
    },
    [ensurePlayer, pushMsg, sending],
  );

  const statusText = (s: SessionStatus) => t(`status.${s}`);
  const personaName = persona?.name ?? 'AI';

  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  return (
    <section className="chat-panel">
      <header className="chat-head">
        {onBack && (
          <button className="icon-btn" title={t('conv.back')} onClick={onBack}>
            <ArrowLeft size={19} />
          </button>
        )}
        <div className="conv-avatar sm" style={{ background: '#6366f1' }}>
          {personaName.slice(0, 1)}
        </div>
        <div className="chat-head-main">
          <div className="chat-head-name">{personaName}</div>
          <div className={`chat-head-status ${connected ? 'on' : ''}`}>
            <span className="dot" />
            {callActive ? statusText(status) : connected ? t('conn.connected') : t('conn.disconnected')}
          </div>
        </div>
        <button className="icon-btn" title={t('conv.delete')} onClick={onDelete}>
          <Trash2 size={17} />
        </button>
      </header>

      <main className="msg-list" ref={listRef}>
        {messages.map((m) =>
          m.role === 'system' ? (
            <div key={m.id} className="sys-msg">
              {m.text}
            </div>
          ) : m.role === 'assistant' && m.audio ? (
            // QQ 式语音消息气泡：点击回放 + 显示文字
            <div key={m.id} className="msg assistant">
              <div className="conv-avatar sm" style={{ background: '#6366f1' }}>
                {personaName.slice(0, 1)}
              </div>
              <div
                className={`bubble voice-bubble ${playingId === m.id ? 'playing' : ''}`}
                onClick={() => replayAudio(m.id)}
                title={t('voice.replay')}
              >
                <div className="voice-play-icon">
                  {playingId === m.id ? <Pause size={16} /> : <Play size={16} />}
                </div>
                <div className="bubble-text">
                  {m.text}
                  {m.streaming && <span className="cursor">▍</span>}
                </div>
              </div>
              {m.time ? <div className="msg-time">{formatMsgTime(m.time)}</div> : null}
            </div>
          ) : (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.role === 'assistant' && (
                <div className="conv-avatar sm" style={{ background: '#6366f1' }}>
                  {personaName.slice(0, 1)}
                </div>
              )}
              <div className="bubble">
                <div className="bubble-text">
                  {m.text}
                  {m.streaming && <span className="cursor">▍</span>}
                </div>
                {m.time ? <div className="msg-time">{formatMsgTime(m.time)}</div> : null}
              </div>
            </div>
          ),
        )}
      </main>

      <footer className="qq-inputbar">
        {callActive && (
          <div className={`callbar ${status}`}>
            <div className="eq">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className="eq-bar"
                  style={{ height: `${eqHeight(micLevel, i)}%` }}
                />
              ))}
            </div>
            <div className="call-status">
              <strong>{statusText(status)}</strong>
              <span>
                {t('call.other')} · {personaName}
              </span>
            </div>
            <button className="hangup-btn" onClick={() => void stopCall()}>
              <PhoneOff size={18} />
              {t('call.hangup')}
            </button>
          </div>
        )}

        <div className="deepthink-row">
          <button
            type="button"
            className={`deepthink-btn ${deepThink === 'on' ? 'on' : ''}`}
            onClick={onToggleDeepThink}
            title={t('deepthinkHint')}
          >
            <span className="brain">🧠</span> {t('deepthink')}
            <span className={`deepthink-state ${deepThink === 'on' ? 'on' : ''}`}>
              {deepThink === 'on' ? t('plugins.on') : t('plugins.off')}
            </span>
          </button>
          {settings.llm.diaryEnabled && settings.llm.diaryMode === 'manual' && (
            <button
              type="button"
              className="deepthink-btn"
              disabled={compressingRef.current}
              title={t('diary.compressHint')}
              onClick={() => {
                if (compressingRef.current) return;
                compressingRef.current = true;
                // 把当前展示的完整对话拼成文本，通过 HTTP 压缩（不依赖 WebSocket 连接状态）
                const dialogText = messages
                  .filter((m) => m.role === 'user' || m.role === 'assistant')
                  .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.text}`)
                  .join('\n');
                pushMsg({ id: genId(), role: 'system', text: '📓 正在写日记压缩对话…（可能需要几秒到几十秒）' });
                void compressDialog(settings, conv.personaId, dialogText, settings.llm.diaryPressure).then((r) => {
                  compressingRef.current = false;
                  if (r.ok && r.diary) {
                    // 压缩成功：清空旧消息，日记作为一条 AI 对话消息展示（不朗读）
                    aiSpeakingRef.current = false;
                    audioChunksRef.current.clear();
                    replayCacheRef.current.clear();
                    replayPlayerRef.current?.stop();
                    replayPlayerRef.current = null;
                    setMessages([{ id: genId(), role: 'assistant', text: r.diary, time: Date.now() }]);
                  } else {
                    pushMsg({ id: genId(), role: 'system', text: `⚠️ 压缩失败：${r.message ?? '未知错误'}` });
                  }
                });
                // 兜底：60s 后恢复按钮（若请求异常未回包）
                setTimeout(() => { compressingRef.current = false; }, 60_000);
              }}
            >
              <span>📓</span> {t('diary.compressNow')}
              <span className="deepthink-state">{t('diary.pressure.' + (settings.llm.diaryPressure ?? 'medium'))}</span>
            </button>
          )}
        </div>

        <form
          className="qq-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            sendText(input);
          }}
        >
          <button
            type="button"
            className={`call-btn ${callActive ? 'active' : ''}`}
            title={callActive ? t('call.end') : t('call.start')}
            onClick={() => void (callActive ? stopCall() : startCall())}
          >
            {callActive ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <input
            className="text-input"
            placeholder={t('input.placeholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="send-btn" disabled={!input.trim() || sending}>
            <Send size={18} />
          </button>
        </form>
      </footer>
    </section>
  );
}
