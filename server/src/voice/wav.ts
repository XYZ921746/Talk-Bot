/** 16kHz 单声道 16bit PCM → WAV（用于 STT 接口） */
export function pcmToWav(pcm: Int16Array, sampleRate = 16000): Buffer {
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).copy(buf, 44);
  return buf;
}

/** 合并多个 Int16 PCM 片段 */
export function concatInt16(parts: Int16Array[]): Int16Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** 逐帧能量（RMS）计算，用于 VAD */
export function computeRms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

interface WavInfo {
  format: number;
  realFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Buffer;
}

/** 解析 WAV（支持标准 PCM 与 WAVE_FORMAT_EXTENSIBLE），失败返回 null */
function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let fmt: WavInfo | null = null;
  let fmtOffset = -1;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmtOffset = offset;
      fmt = {
        format: buf.readUInt16LE(offset + 8),
        realFormat: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22),
        data: Buffer.alloc(0),
      };
    } else if (id === 'data') {
      data = buf.subarray(offset + 8, offset + 8 + Math.min(size, buf.length - offset - 8));
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !data) return null;
  // WAVE_FORMAT_EXTENSIBLE：真实格式在 SubFormat GUID 前 2 字节（fmt 数据 + 24 处）
  if (fmt.format === 65534 && fmtOffset >= 0 && fmtOffset + 8 + 40 <= buf.length) {
    fmt.realFormat = buf.readUInt16LE(fmtOffset + 8 + 24);
  }
  fmt.data = data;
  return fmt;
}

function buildWav16(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * 把任意 WAV 转成浏览器通用的 16bit PCM WAV（兼容 32-bit float / WAVE_FORMAT_EXTENSIBLE）。
 * 非 WAV（mp3 等）或无法解析时原样返回 null，由调用方决定是否使用原数据。
 */
export function convertWavToPcm16(buf: Buffer): Buffer | null {
  const info = parseWav(buf);
  if (!info) return null;
  const { realFormat, channels, sampleRate, bitsPerSample, data } = info;

  // 已经是标准 16bit PCM → 无需转换
  if (realFormat === 1 && bitsPerSample === 16) return buf;

  if (realFormat === 3 && bitsPerSample === 32 && data.length % 4 === 0) {
    // 32-bit float → 16bit PCM
    const samples = data.length / 4;
    const out = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const f = data.readFloatLE(i * 4);
      const clamped = f < -1 ? -1 : f > 1 ? 1 : f;
      out.writeInt16LE(Math.round(clamped * 32767), i * 2);
    }
    return buildWav16(out, sampleRate, channels);
  }

  if (bitsPerSample === 16 && data.length % 2 === 0) {
    // 16bit 但格式标记非标准（如 extensible）→ 重写头
    return buildWav16(Buffer.from(data), sampleRate, channels);
  }

  return null;
}
