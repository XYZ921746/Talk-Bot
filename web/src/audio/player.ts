/** 助手音频播放：解码 → 队列顺序播放，支持打断；自动恢复被挂起的 AudioContext；支持点击回放 */

export class AudioPlayer {
  private ctx: AudioContext;
  private queue: AudioBuffer[] = [];
  private current: AudioBufferSourceNode | null = null;
  private playing = false;
  private onIdleCb: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext();
  }

  /** 注册"播放器空闲"回调（队列播完时触发，用于 AI 说完后恢复麦克风） */
  setOnIdle(cb: (() => void) | null): void {
    this.onIdleCb = cb;
  }

  /** 需要用户手势后才能调用（浏览器自动播放策略） */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  /** 解码音频并返回 AudioBuffer（用于获取时长）。注意 decodeAudioData 可能使传入 buffer 失效，内部拷贝一份 */
  async decode(buf: ArrayBuffer): Promise<AudioBuffer> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    return await this.ctx.decodeAudioData(buf.slice(0));
  }

  /** 顺序播放（语音通话实时播放，进队列依次播） */
  async play(buf: ArrayBuffer): Promise<void> {
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      const audioBuffer = await this.ctx.decodeAudioData(buf.slice(0));
      this.queue.push(audioBuffer);
      this.pump();
    } catch (err) {
      console.warn('音频解码失败（可能格式不受支持）:', err);
    }
  }

  /** 点击回放：打断当前播放，立即播放，返回时长（秒），播完回调 onEnd */
  async replay(buf: ArrayBuffer, onEnd?: () => void): Promise<number> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.stop();
    try {
      const audioBuffer = await this.ctx.decodeAudioData(buf.slice(0));
      const duration = audioBuffer.duration;
      this.playing = true;
      const src = this.ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(this.ctx.destination);
      src.onended = () => {
        this.playing = false;
        this.current = null;
        if (onEnd) onEnd();
      };
      this.current = src;
      src.start();
      return duration;
    } catch (err) {
      this.playing = false;
      this.current = null;
      console.warn('回放启动失败:', err);
      if (onEnd) onEnd();
      return 0;
    }
  }

  /** 打断播放（用户开始说话 / 挂断） */
  stop(): void {
    this.queue = [];
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        /* ignore */
      }
      this.current = null;
    }
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    void this.ctx.close().catch(() => {});
  }

  private pump(): void {
    if (this.playing) return;
    if (!this.queue.length) {
      if (this.onIdleCb) this.onIdleCb();
      return;
    }
    const buf = this.queue.shift()!;
    this.playing = true;
    try {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.onended = () => {
        this.playing = false;
        this.current = null;
        this.pump();
      };
      this.current = src;
      src.start();
    } catch (err) {
      console.warn('音频播放启动失败:', err);
      this.playing = false;
      this.current = null;
      setTimeout(() => this.pump(), 100);
    }
  }
}
