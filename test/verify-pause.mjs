/** 验证：预处理换行后 SBV2 停顿是否减少 */
import { CustomHTTPTTS } from '../server/dist/tts/custom.js';
import { convertWavToPcm16 } from '../server/dist/voice/wav.js';

const tts = new CustomHTTPTTS({
  url: 'http://127.0.0.1:3000/synthesize',
  method: 'POST',
  bodyTemplate: '{"text":"{text}","ident":"Ling v2"}',
  apiKey: '',
});

const text = '你好，这是第一句话。\n这是第二句话，测试换行分段。\n第三句话，看看会不会断断续续。';

const buf = await tts.synthesize(text, 'x', 0);
const converted = convertWavToPcm16(buf) ?? buf;
const rate = 44100;
const samples = new Int16Array(converted.buffer, 44, (converted.length - 44) / 2);
const duration = samples.length / rate;
const win = Math.floor(rate * 0.05);
let sl = -1;
const sil = [];
for (let i = 0; i < samples.length; i += win) {
  let sum = 0;
  const n = Math.min(win, samples.length - i);
  for (let j = 0; j < n; j++) {
    const v = samples[i + j] / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / n);
  const t = i / rate;
  if (rms < 0.01) {
    if (sl < 0) sl = t;
  } else {
    if (sl >= 0) {
      sil.push([sl, t]);
      sl = -1;
    }
  }
}
if (sl >= 0) sil.push([sl, duration]);
const longS = sil.filter((x) => x[1] - x[0] > 0.3);
console.log(`预处理后 duration: ${duration.toFixed(2)}s, >0.3s 静音段: ${longS.length}`);
for (const s of longS.slice(0, 10)) console.log(`  ${s[0].toFixed(2)}~${s[1].toFixed(2)}s`);
console.log(longS.length <= 4 ? '✅ 停顿明显减少（连贯）' : '⚠️ 停顿仍较多');
process.exit(0);
