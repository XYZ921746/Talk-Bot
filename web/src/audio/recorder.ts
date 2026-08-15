/** 麦克风采集（AudioWorklet）：降混单声道 → 重采样 16kHz → Int16 PCM，供 WebSocket 发送 */

const TARGET_RATE = 16000;

/** AudioWorklet 处理器代码：在音频线程内做重采样与 Int16 转换，避免 ScriptProcessor 在新版 Chrome 失效 */
const WORKLET_CODE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.acc = new Float32Array(0);
    this.pos = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch || ch.length === 0) return true;
    const merged = new Float32Array(this.acc.length + ch.length);
    merged.set(this.acc, 0);
    merged.set(ch, this.acc.length);
    this.acc = merged;
    const total = this.acc.length;
    const outLen = Math.floor((total - this.pos) / this.ratio);
    if (outLen > 0) {
      const out = new Int16Array(outLen);
      // 麦克风增益：很多麦克风音量偏低，放大 3 倍提升识别率（超限自动削波）
      const GAIN = 3;
      for (let i = 0; i < outLen; i++) {
        const idx = this.pos + i * this.ratio;
        const i0 = Math.floor(idx);
        const i1 = i0 + 1 < total ? i0 + 1 : i0;
        const frac = idx - i0;
        const s = this.acc[i0] * (1 - frac) + this.acc[i1] * frac;
        const g = s * GAIN;
        const c = g < -1 ? -1 : g > 1 ? 1 : g;
        out[i] = (c * 32767) | 0;
      }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.pos += outLen * this.ratio;
      const consumed = Math.floor(this.pos);
      if (consumed > 0) {
        this.acc = this.acc.slice(consumed);
        this.pos -= consumed;
      }
    }
    return true;
  }
}
registerProcessor('ava-recorder', RecorderProcessor);
`;

export function computeRmsInt16(samples: Int16Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

export interface RecorderCallbacks {
  onPcm(pcm: Int16Array): void;
  onLevel(rms: number): void;
}

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private workletUrl: string | null = null;
  private running = false;

  async start(cb: RecorderCallbacks): Promise<void> {
    if (this.running) return;
    console.log('[录音] 创建 AudioContext（用户手势内）…');
    this.ctx = new AudioContext();
    // 必须在用户手势窗口内 resume（await getUserMedia 之后可能已过期）
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('[录音] AudioContext.resume 失败:', err);
      }
    }
    console.log('[录音] AudioContext state =', this.ctx.state, 'sampleRate =', this.ctx.sampleRate);
    if (this.ctx.state !== 'running') {
      throw new Error('AudioContext 未运行（state=' + this.ctx.state + '），浏览器可能阻止了音频启动');
    }
    if (!this.workletUrl) {
      this.workletUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
    }
    await this.ctx.audioWorklet.addModule(this.workletUrl);

    console.log('[录音] 请求麦克风…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.node = new AudioWorkletNode(this.ctx, 'ava-recorder');
    this.source = this.ctx.createMediaStreamSource(this.stream);

    // 电平更新节流到 ~20fps，避免高频 setState
    let lastLevelTime = 0;
    let frameCount = 0;
    this.node.port.onmessage = (e) => {
      const pcm = new Int16Array(e.data as ArrayBuffer);
      cb.onPcm(pcm);
      if (frameCount < 3) {
        frameCount++;
        console.log(`[录音] 已收到音频数据 第${frameCount}帧 len=${pcm.length}`);
      }
      const now = performance.now();
      if (now - lastLevelTime > 50) {
        lastLevelTime = now;
        cb.onLevel(computeRmsInt16(pcm));
      }
    };

    this.source.connect(this.node);
    this.node.connect(this.ctx.destination); // worklet 不写输出 → 静音，仅保证被拉取
    this.running = true;
    console.log('[录音] 录音已启动');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    try {
      this.node?.disconnect();
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.node = null;
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
