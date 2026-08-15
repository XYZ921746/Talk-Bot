// 探测 8000 端口 STT 服务的 API 接口
import http from 'node:http';

const base = 'http://127.0.0.1:8000';

async function get(path) {
  const r = await fetch(base + path);
  return { status: r.status, ct: r.headers.get('content-type') || '', text: r.status === 200 ? await r.text().catch(() => '') : '' };
}

// 尝试常见 STT 端点
for (const p of ['/v1/audio/transcriptions', '/audio/transcriptions', '/asr', '/recognize', '/speech-to-text', '/api/v1/audio/transcriptions', '/v1/audio/transcriptions?language=zh']) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
  if (r) {
    const text = await r.text().catch(() => '');
    console.log(`${p}: ${r.status} ${text.slice(0, 200)}`);
  } else {
    console.log(`${p}: connection failed`);
  }
}

// 尝试 GET / （根路径）
const root = await get('/');
console.log(`GET /: ${root.status} CT=${root.ct} ${root.text.slice(0, 200)}`);

// 尝试 /docs 和 /openapi.json
const docs = await get('/docs');
console.log(`GET /docs: ${docs.status} (${docs.text.length}B)`);

const oai = await get('/openapi.json');
console.log(`GET /openapi.json: ${oai.status} ${oai.ct} ${oai.text.slice(0, 400)}`);

process.exit(0);