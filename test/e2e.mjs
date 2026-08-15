/**
 * 端到端冒烟测试（不需要任何真实 API Key）：
 *  1. 启动一个本地 mock 的 OpenAI 兼容服务（chat / transcriptions / speech）
 *  2. 把应用服务端的 LLM/STT/TTS 全部指向 mock
 *  3. 走一遍文本聊天管道 + 语音管道（VAD → STT → LLM → TTS）
 */
import http from 'node:http';
import WebSocket from 'ws';

const MOCK_PORT = 9101;
const APP_PORT = 3210;

// ===== 1. mock OpenAI 兼容服务 =====
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      /* ignore */
    }

    if (url.pathname.endsWith('/chat/completions')) {
      const stream = body.stream === true;
      // 翻译请求（system 提示词含“翻译”）→ 返回英文，模拟翻译结果
      const sysPrompt = (body.messages ?? []).find((m) => m.role === 'system')?.content ?? '';
      const replyText = sysPrompt.includes('翻译') ? 'Hello! This is the translated reply.' : '你好，我是测试助手。';
      if (stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const parts = replyText.match(/./gu) ?? [replyText];
        let i = 0;
        const timer = setInterval(() => {
          if (i >= parts.length) {
            clearInterval(timer);
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }
          res.write(
            `data: ${JSON.stringify({
              choices: [{ delta: { content: parts[i] }, finish_reason: null }],
            })}\n\n`,
          );
          i++;
        }, 15);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: replyText } }] }));
      return;
    }

    if (url.pathname.endsWith('/audio/transcriptions')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: '测试语音识别' }));
      return;
    }

    if (url.pathname.endsWith('/audio/speech')) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.alloc(2048, 0x55)); // 伪造 MP3 字节
      return;
    }

    if (url.pathname.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            { id: 'gpt-4o', object: 'model' },
            { id: 'gpt-4o-mini', object: 'model' },
            { id: 'deepseek-chat', object: 'model' },
          ],
        }),
      );
      return;
    }

    // 自定义 HTTP TTS（模拟 SBV2 类本地 TTS 的 /synthesize，返回 32-bit float WAV）
    if (url.pathname.endsWith('/synthesize')) {
      const reqBody = raw ? JSON.parse(raw) : {};
      if (!reqBody.text || !reqBody.ident) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text 和 ident 必填' }));
        return;
      }
      const sampleRate = 44100;
      const samples = 4000;
      const dataSize = samples * 4;
      const wav = Buffer.alloc(44 + dataSize);
      wav.write('RIFF', 0);
      wav.writeUInt32LE(36 + dataSize, 4);
      wav.write('WAVE', 8);
      wav.write('fmt ', 12);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(3, 20); // IEEE float
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(sampleRate, 24);
      wav.writeUInt32LE(sampleRate * 4, 28);
      wav.writeUInt16LE(4, 32);
      wav.writeUInt16LE(32, 34);
      wav.write('data', 36);
      wav.writeUInt32LE(dataSize, 40);
      for (let i = 0; i < samples; i++) wav.writeFloatLE(0.5 * Math.sin(i / 20), 44 + i * 4);
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      res.end(wav);
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });
});

await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
console.log('[mock] OpenAI 兼容服务已启动 :' + MOCK_PORT);

// ===== 2. 通用配置（全部指向 mock） =====
const baseConfig = {
  llm: { type: 'openai', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'mock-key', model: 'mock-model', temperature: 0.7, maxTokens: 256, reasoningEffort: 'high', contextTokens: 200000 },
  stt: { type: 'openai', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'mock-key', model: 'whisper-1', language: '' },
  tts: { type: 'openai', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'mock-key', model: 'tts-1', voice: 'alloy', rate: 0 },
  vad: { threshold: 0.015, silenceMs: 650, maxSpeechMs: 15000 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failures++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

// ===== 3. 等待应用服务端就绪 =====
async function waitApp() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error('应用服务端 30 秒内未就绪');
}

console.log('\n[1/4] 等待应用服务端…');
await waitApp();
console.log('  已就绪');

console.log('\n[2/4] REST API');
const health = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/health`)).json();
check('GET /api/health 返回 ok', health.ok === true);

const boot = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/bootstrap`)).json();
check('GET /api/bootstrap 返回人设', Array.isArray(boot.personas) && boot.personas.length >= 1, `(实际 ${boot.personas?.length})`);
check('GET /api/bootstrap 返回插件', Array.isArray(boot.plugins) && boot.plugins.length >= 2, `(实际 ${boot.plugins?.length})`);

const index = await (await fetch(`http://127.0.0.1:${APP_PORT}/`)).text();
check('GET / 返回前端页面', index.includes('AI 语音助手'));

// 模型列表拉取
console.log('\n[2.75/4] 模型列表（GET /models 代理）');
const modelsRes = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: baseConfig }),
  })
).json();
check(
  'POST /api/models 返回模型列表',
  modelsRes.ok === true && Array.isArray(modelsRes.models) && modelsRes.models.includes('deepseek-chat'),
  JSON.stringify(modelsRes).slice(0, 200),
);

// 人设 CRUD
console.log('\n[2.5/4] 人设 CRUD（自定义人设）');
const created = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/personas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试人设', description: 'e2e 测试', systemPrompt: '你是测试人设，简短回答。', language: 'en-US' }),
  })
).json();
check('POST 新建人设', created.ok === true && !!created.persona?.id, JSON.stringify(created));
const pid = created.persona?.id ?? '';
const updated = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/personas/${pid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试人设改', greeting: 'hello' }),
  })
).json();
check('PUT 更新人设', updated.ok === true && updated.persona?.name === '测试人设改', JSON.stringify(updated));
const del = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/personas/${pid}`, { method: 'DELETE' })).json();
check('DELETE 删除人设', del.ok === true, JSON.stringify(del));
const afterDel = await (await fetch(`http://127.0.0.1:${APP_PORT}/api/personas`)).json();
check('删除后列表不含该人设', !afterDel.personas.some((p) => p.id === pid));

// ===== 3. STT 连接测试（ASR 检查） =====
console.log('\n[2.8/4] STT 连接测试（/api/test kind=stt）');
const sttTest = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'stt', config: baseConfig }),
  })
).json();
check('STT 测试连通（识别返回结果）', sttTest.ok === true && sttTest.message.includes('测试语音识别'), JSON.stringify(sttTest).slice(0, 200));

// ===== 4. 文本聊天管道 =====
console.log('\n[3/4] 文本聊天管道（mock LLM 流式）');
const textResult = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws`);
  const got = { ready: false, deltas: '', text: '', status: [] };
  const timer = setTimeout(() => resolve(got), 8000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'init', config: baseConfig, personaId: 'assistant', mode: 'text' }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'text', text: '你好' })), 200);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'ready') got.ready = true;
    if (msg.type === 'assistant_delta') got.deltas += msg.delta;
    if (msg.type === 'assistant_text') {
      got.text = msg.text;
      clearTimeout(timer);
      ws.close();
      resolve(got);
    }
  });
});
check('收到 ready', textResult.ready);
check('流式增量非空', textResult.deltas.length > 0, `(实际: "${textResult.deltas}")`);
check('最终回复正确', textResult.text === '你好，我是测试助手。', `(实际: "${textResult.text}")`);

// 文字回复朗读：文本模式回复也应触发 TTS 音频
console.log('\n[3.5/4] 文字回复朗读（文本模式 → TTS 音频）');
const readAloud = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws`);
  const got = { audioStart: 0, audioEnd: 0, bytes: 0 };
  const timer = setTimeout(() => {
    ws.close();
    resolve(got);
  }, 8000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'init', config: baseConfig, personaId: 'assistant', mode: 'text' }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'text', text: '你好' })), 200);
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      got.bytes += data.length;
      return;
    }
    const msg = JSON.parse(data.toString());
    if (msg.type === 'assistant_audio_start') got.audioStart++;
    if (msg.type === 'assistant_audio_end') {
      got.audioEnd++;
      clearTimeout(timer);
      ws.close();
      resolve(got);
    }
  });
});
check('文本回复触发朗读音频', readAloud.audioStart >= 1 && readAloud.audioEnd >= 1 && readAloud.bytes > 0, JSON.stringify(readAloud));

// ===== 5. 语音管道 =====
console.log('\n[4/4] 语音管道（VAD → mock STT → mock LLM → mock TTS）');
const voiceResult = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws`);
  const got = { ready: false, greetingAudio: false, sttText: '', audioStart: 0, audioEnd: 0, audioBytes: 0, statuses: [] };
  const timer = setTimeout(() => {
    ws.close();
    resolve(got);
  }, 15000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'init', config: baseConfig, personaId: 'assistant', mode: 'voice' }));
    // 等人设问候语发完，再发模拟语音
    setTimeout(() => {
      const chunk = new Int16Array(2048);
      // 0.5s 正弦波（约 4 帧）
      for (let f = 0; f < 4; f++) {
        for (let i = 0; i < 2048; i++) chunk[i] = Math.round(Math.sin((i / 2048) * Math.PI * 4) * 8000);
        ws.send(chunk.buffer);
      }
      // 0.9s 静音（约 7 帧）触发断句
      chunk.fill(0);
      for (let f = 0; f < 7; f++) ws.send(chunk.buffer);
    }, 1500);
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      got.audioBytes += data.length;
      return;
    }
    const msg = JSON.parse(data.toString());
    got.statuses.push(msg.type);
    if (msg.type === 'ready') got.ready = true;
    if (msg.type === 'assistant_audio_start') {
      if (msg.text.includes('你好呀')) got.greetingAudio = true;
      got.audioStart++;
    }
    if (msg.type === 'assistant_audio_end') {
      got.audioEnd++;
      if (got.audioStart >= 2) {
        clearTimeout(timer);
        ws.close();
        resolve(got);
      }
    }
    if (msg.type === 'stt_text') got.sttText = msg.text;
  });
});
check('语音模式收到 ready', voiceResult.ready);
check('人设问候语已合成播放', voiceResult.greetingAudio);
check('STT 识别文本正确', voiceResult.sttText === '测试语音识别', `(实际: "${voiceResult.sttText}")`);
check('收到 2 段语音回复（问候+回答）', voiceResult.audioStart === 2 && voiceResult.audioEnd === 2, `(start=${voiceResult.audioStart}, end=${voiceResult.audioEnd})`);
check('音频字节数 > 0', voiceResult.audioBytes > 0, `(实际 ${voiceResult.audioBytes} B)`);

// ===== 5. 语言自动翻译 + 自定义人设生效（动态创建 en-US 人设 → LLM 返回中文 → 应翻译成英文） =====
console.log('\n[5/5] 语言自动翻译 + 自定义人设生效（动态创建 en-US 人设）');
const createdP = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/personas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '翻译测试人设',
      description: 'e2e',
      systemPrompt: '你是翻译测试人设。',
      language: 'en-US',
    }),
  })
).json();
check('创建 en-US 自定义人设', createdP.ok === true && !!createdP.persona?.id, JSON.stringify(createdP).slice(0, 150));
const translatePersonaId = createdP.persona?.id ?? 'assistant';
const translateResult = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws`);
  const got = { text: '', deltas: '' };
  const timer = setTimeout(() => {
    ws.close();
    resolve(got);
  }, 8000);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'init', config: baseConfig, personaId: translatePersonaId, mode: 'text' }));
    setTimeout(() => ws.send(JSON.stringify({ type: 'text', text: '你好' })), 200);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'assistant_delta') got.deltas += msg.delta;
    if (msg.type === 'assistant_text') {
      got.text = msg.text;
      clearTimeout(timer);
      ws.close();
      resolve(got);
    }
  });
});
check('翻译后的最终回复为英文', translateResult.text === 'Hello! This is the translated reply.', `(实际: "${translateResult.text}")`);
// 清理测试人设
if (translatePersonaId !== 'assistant') {
  await fetch(`http://127.0.0.1:${APP_PORT}/api/personas/${translatePersonaId}`, { method: 'DELETE' });
}

// 插件禁用路径：init 带 disabledPlugins，会话仍正常工作
console.log('\n[5.5/5] 插件禁用（disabledPlugins 过滤）');
const pluginTest = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${APP_PORT}/ws`);
  const got = { ready: false, text: '' };
  const timer = setTimeout(() => resolve(got), 8000);
  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        type: 'init',
        config: baseConfig,
        personaId: 'assistant',
        mode: 'text',
        disabledPlugins: ['示例工具'],
      }),
    );
    setTimeout(() => ws.send(JSON.stringify({ type: 'text', text: '你好' })), 200);
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'ready') got.ready = true;
    if (msg.type === 'assistant_text') {
      got.text = msg.text;
      clearTimeout(timer);
      ws.close();
      resolve(got);
    }
  });
});
check('禁用插件后会话正常', pluginTest.ready && pluginTest.text.length > 0, JSON.stringify(pluginTest));

// ===== 6. 真实 Edge TTS（外部网络，尽力而为） =====
console.log('\n[6/5] 真实 Edge TTS（免费音色，需要外网）');
try {
  const r = await fetch(`http://127.0.0.1:${APP_PORT}/api/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'tts',
      config: { ...baseConfig, tts: { type: 'edge', baseUrl: '', apiKey: '', model: '', voice: 'zh-CN-XiaoxiaoNeural', rate: 0 } },
    }),
  });
  const j = await r.json();
  check('Edge TTS 合成成功', j.ok === true && /合成 \d+ 字节/.test(j.message), `(${j.message})`);
} catch (err) {
  console.log('  ⚠️ 跳过 Edge TTS 测试（网络不可达）:', err.message);
}

// 无协议地址自动补全（用户填 127.0.0.1:3000 也能用）
console.log('\n[6.6/5] 无协议地址自动补全');
const noProto = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'tts',
      config: {
        ...baseConfig,
        tts: { type: 'openai', baseUrl: `127.0.0.1:${MOCK_PORT}/v1`, apiKey: 'x', model: 'tts-1', voice: 'alloy', rate: 0, language: 'zh-CN', readText: true },
      },
    }),
  })
).json();
check('无协议地址自动补全 http:// 并合成成功', noProto.ok === true && /合成 \d+ 字节/.test(noProto.message), JSON.stringify(noProto).slice(0, 200));

// 自定义 HTTP TTS（SBV2 类本地 TTS）
console.log('\n[6.7/5] 自定义 HTTP TTS（POST /synthesize + JSON 模板）');
const customTts = await (
  await fetch(`http://127.0.0.1:${APP_PORT}/api/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'tts',
      config: {
        ...baseConfig,
        tts: {
          type: 'custom',
          baseUrl: `http://127.0.0.1:${MOCK_PORT}/synthesize`,
          apiKey: '',
          model: '',
          voice: '',
          rate: 0,
          language: 'zh-CN',
          readText: true,
          customMethod: 'POST',
          customBody: '{"text":"{text}","ident":"Ling v2"}',
        },
      },
    }),
  })
).json();
check('自定义 HTTP TTS 合成成功', customTts.ok === true && /合成 \d+ 字节/.test(customTts.message), JSON.stringify(customTts).slice(0, 200));
// float32 WAV 应被转码为 16bit PCM：4000 样本 × 2 字节 + 44 头 = 8044 字节（原为 4000×4+44=16044）
check('float32 WAV 自动转码为 16bit PCM', customTts.ok === true && customTts.message.includes('8044'), `(message: ${customTts.message})`);

// 含换行/引号的文本 → JSON 转义后仍能合成（修复 "control character found while parsing" 报错）
console.log('\n[6.8/5] 换行/引号文本 JSON 转义');
const { CustomHTTPTTS } = await import('../server/dist/tts/custom.js');
const customTtsInst = new CustomHTTPTTS({
  url: `http://127.0.0.1:${MOCK_PORT}/synthesize`,
  method: 'POST',
  bodyTemplate: '{"text":"{text}","ident":"Ling v2"}',
  apiKey: '',
});
try {
  const buf = await customTtsInst.synthesize('第一行\n第二行"带引号"\t制表', 'x', 0);
  check('含换行/引号文本合成成功', buf.length > 0, `(len=${buf.length})`);
} catch (err) {
  check('含换行/引号文本合成成功', false, String(err));
}

console.log(failures === 0 ? '\n🎉 全部测试通过！' : `\n⚠️ ${failures} 项失败`);
mock.close();
process.exit(failures === 0 ? 0 : 1);
