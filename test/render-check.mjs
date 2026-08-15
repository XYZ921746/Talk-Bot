/** 用 jsdom 真实渲染前端 bundle：首屏 + 交互流程，捕获白屏错误 */
import { JSDOM } from 'jsdom';

const DESKTOP = process.argv.includes('--desktop');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3210/',
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.customElements = window.customElements;
globalThis.getComputedStyle = window.getComputedStyle;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.MutationObserver = window.MutationObserver;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.location = window.location;
const mmStub = (q) => ({
  matches: DESKTOP,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
window.matchMedia = window.matchMedia || mmStub;
globalThis.matchMedia = globalThis.matchMedia || mmStub;

globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.includes('/api/bootstrap')) {
    return {
      ok: true,
      json: async () => ({
        version: '0.1.0',
        personas: [{ id: 'assistant', name: '通用助手', description: 'desc', systemPrompt: 'sys', language: 'zh-CN' }],
        plugins: [],
        llmKinds: ['openai', 'anthropic'],
        sttKinds: ['openai', 'azure', 'none'],
        ttsKinds: ['edge', 'openai', 'azure', 'none'],
      }),
    };
  }
  return { ok: true, json: async () => ({}) };
};

globalThis.WebSocket = class {
  static OPEN = 1;
  constructor() {
    this.readyState = 1;
    this.OPEN = 1;
    this.binaryType = '';
    this.sent = [];
  }
  send(d) {
    this.sent.push(d);
  }
  close() {}
};

// jsdom 无 AudioContext，提供最小 stub（sendText 会创建 AudioPlayer）
globalThis.AudioContext = class {
  constructor() {
    this.state = 'running';
    this.sampleRate = 48000;
    this.destination = {};
    this.audioWorklet = { addModule: async () => {} };
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createGain() {
    return { connect() {}, gain: { value: 0 } };
  }
  decodeAudioData() {
    return Promise.reject(new Error('no decode in jsdom'));
  }
  createBufferSource() {
    return { connect() {}, start() {}, stop() {}, onended: null };
  }
  close() {
    return Promise.resolve();
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));

const fail = (msg) => {
  console.log('❌ ' + msg);
  process.exitCode = 1;
};

try {
  await import('../web/dist/assets/index-BDYebh_R.js');
  await sleep(600);
  const root = document.getElementById('root');
  if (!root || root.innerHTML.length === 0) fail('首屏 root 为空（白屏）');
  else console.log(`✅ 首屏渲染成功（${DESKTOP ? '桌面双栏' : '移动列表'}）: ${root.textContent.slice(0, 60).replace(/\s+/g, ' ')}`);

  // 桌面端：验证双栏都在
  if (DESKTOP) {
    const convPanel = document.querySelector('.conv-panel');
    const chatEmpty = document.querySelector('.chat-empty');
    if (!convPanel) fail('缺少会话列表面板');
    else if (!chatEmpty) fail('缺少右侧空状态');
    else console.log('✅ 桌面双栏布局存在');
  }

  // 打开新建聊天
  const newBtn = document.querySelector('.conv-new-btn');
  if (!newBtn) fail('找不到「新建聊天」按钮');
  else {
    newBtn.click();
    await sleep(200);
    const items = document.querySelectorAll('.newchat-item');
    if (items.length === 0) fail('新建聊天面板无人设');
    else {
      console.log(`✅ 新建聊天面板显示 ${items.length} 个人设`);
      items[0].click();
      await sleep(400);
      const chatPanel = document.querySelector('.chat-panel');
      const input = document.querySelector('.text-input');
      if (!chatPanel || !input) fail('进入聊天后找不到聊天窗口/输入框');
      else {
        console.log('✅ 已进入聊天窗口');
        // 输入并发送一条消息
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '你好');
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        await sleep(50);
        const sendBtn = document.querySelector('.send-btn');
        if (!sendBtn) fail('找不到发送按钮');
        else {
          sendBtn.click();
          await sleep(300);
          const userBubble = [...document.querySelectorAll('.msg.user .bubble-text')].some((n) => n.textContent.includes('你好'));
          if (!userBubble) fail('发送后未出现用户消息气泡');
          else console.log('✅ 文本消息发送并显示气泡');
        }
      }
    }
  }
} catch (e) {
  fail('渲染/交互异常: ' + (e && e.stack ? e.stack : e));
}

console.log('captured errors:', errors.length);
for (const e of errors) console.log('  -', e && e.stack ? e.stack : e);
process.exit(process.exitCode || 0);
