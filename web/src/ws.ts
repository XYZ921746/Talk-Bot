import type { SessionConfig, SessionStatus } from './types';

export interface VoiceClientCallbacks {
  onOpen(): void;
  onClose(): void;
  onReady(greeting?: string): void;
  onStatus(status: SessionStatus): void;
  onSttText(text: string): void;
  onAssistantStart(messageId: string): void;
  onAssistantDelta(delta: string, messageId: string): void;
  onAssistantText(text: string, messageId: string): void;
  onAudioStart(id: number, mime: string, text: string): void;
  onAudioChunk(id: number, chunk: ArrayBuffer): void;
  onAudioEnd(id: number): void;
  onInterrupt(): void;
  onCompressed(diary: string, removed: number): void;
  onError(message: string): void;
}

/** WebSocket 客户端：负责与服务端的双向通信（语音流 + 文本） */
export class VoiceClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingAudioId: number | null = null;
  private pendingText: string[] = [];
  private pendingAudio: Int16Array[] = [];

  constructor(private cb: VoiceClientCallbacks) {}

  get isConnected(): boolean {
    return this.connected;
  }

  connect(config: SessionConfig, personaId: string, mode: 'voice' | 'text', disabledPlugins?: string[]): void {
    this.close();
    this.pendingText = [];
    this.pendingAudio = [];
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(`${proto}${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.cb.onOpen();
      ws.send(JSON.stringify({ type: 'init', config, personaId, mode, disabledPlugins }));
      // 冲刷连接建立前积压的消息（保证顺序：先 init 后 text/audio）
      for (const t of this.pendingText) ws.send(JSON.stringify({ type: 'text', text: t }));
      this.pendingText = [];
      for (const pcm of this.pendingAudio) this.sendPcm(ws, pcm);
      this.pendingAudio = [];
    };
    ws.onclose = () => {
      this.connected = false;
      this.cb.onClose();
    };
    ws.onerror = () => {
      this.cb.onError('与服务端的连接出错');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.handleJson(ev.data);
      } else if (ev.data instanceof ArrayBuffer) {
        if (this.pendingAudioId !== null) {
          this.cb.onAudioChunk(this.pendingAudioId, ev.data);
        }
      }
    };
  }

  private handleJson(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'ready':
        this.cb.onReady(typeof msg.greeting === 'string' ? msg.greeting : undefined);
        break;
      case 'status':
        this.cb.onStatus(msg.status as SessionStatus);
        break;
      case 'stt_text':
        this.cb.onSttText(String(msg.text ?? ''));
        break;
      case 'assistant_start':
        this.cb.onAssistantStart(String(msg.messageId ?? ''));
        break;
      case 'assistant_delta':
        this.cb.onAssistantDelta(String(msg.delta ?? ''), String(msg.messageId ?? ''));
        break;
      case 'assistant_text':
        this.cb.onAssistantText(String(msg.text ?? ''), String(msg.messageId ?? ''));
        break;
      case 'assistant_audio_start':
        this.pendingAudioId = Number(msg.id);
        this.cb.onAudioStart(this.pendingAudioId, String(msg.mime ?? 'audio/mpeg'), String(msg.text ?? ''));
        break;
      case 'assistant_audio_end':
        this.cb.onAudioEnd(Number(msg.id));
        this.pendingAudioId = null;
        break;
      case 'interrupt':
        this.cb.onInterrupt();
        break;
      case 'compressed':
        this.cb.onCompressed(String(msg.diary ?? ''), Number(msg.removed ?? 0));
        break;
      case 'error':
        this.cb.onError(String(msg.message ?? '未知错误'));
        break;
      default:
        break;
    }
  }

  sendAudio(pcm: Int16Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.pendingAudio.length < 300) this.pendingAudio.push(pcm); // 上限约 12 秒
      return;
    }
    this.sendPcm(this.ws, pcm);
  }

  private sendPcm(ws: WebSocket, pcm: Int16Array): void {
    const copy = new Int16Array(pcm);
    ws.send(copy.buffer);
  }

  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingText.push(text);
      return;
    }
    this.ws.send(JSON.stringify({ type: 'text', text }));
  }

  sendCompress(pressure?: 'low' | 'medium' | 'high', dialog?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'compress', pressure, dialog }));
  }

  close(): void {
    this.connected = false;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
