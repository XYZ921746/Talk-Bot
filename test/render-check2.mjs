/** 增强渲染测试：覆盖设置面板全部分栏 + 获取模型列表交互，定位白屏 */
import { JSDOM } from 'jsdom';

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
  matches: true,
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
        plugins: [
          { name: '示例工具', version: '1.0.0', description: '测试插件', tools: ['get_current_time'] },
          { name: '帮助指令', description: '帮助' },
        ],
        llmKinds: ['openai', 'anthropic'],
        sttKinds: ['openai', 'azure', 'none'],
        ttsKinds: ['edge', 'openai', 'azure', 'none'],
      }),
    };
  }
  if (url.includes('/api/models')) {
    return {
      ok: true,
      json: async () => ({ ok: true, models: ['gpt-4o', 'gpt-4o-mini', 'deepseek-chat'] }),
    };
  }
  if (url.includes('/api/test')) {
    return { ok: true, json: async () => ({ ok: true, message: 'ok' }) };
  }
  return { ok: true, json: async () => ({}) };
};

globalThis.WebSocket = class {
  static OPEN = 1;
  constructor() {
    this.readyState = 1;
    this.OPEN = 1;
    this.binaryType = '';
  }
  send() {}
  close() {}
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
window.addEventListener('error', (e) => errors.push(e.error || e.message));
process.on('unhandledRejection', (e) => errors.push(e));
let failed = false;
const fail = (msg) => {
  console.log('❌ ' + msg);
  failed = true;
};

try {
  await import('../web/dist/assets/index-CzS2YAfD.js');
  await sleep(600);
  const root = document.getElementById('root');
  if (!root || root.innerHTML.length === 0) fail('首屏 root 为空（白屏）');
  else console.log('✅ 首屏渲染成功');

  // 打开设置
  const settingsBtn = document.querySelector('.icon-btn[title="设置"], .conv-head .icon-btn');
  if (!settingsBtn) fail('找不到设置按钮');
  else {
    settingsBtn.click();
    await sleep(300);
    if (!document.querySelector('.drawer')) fail('设置面板未打开');
    else console.log('✅ 设置面板打开');

    // 逐个点击分栏
    const tabBtns = [...document.querySelectorAll('.tab-btn')];
    console.log(`   分栏数: ${tabBtns.length}`);
    for (const btn of tabBtns) {
      btn.click();
      await sleep(120);
      const active = document.querySelector('.tab-btn.active');
      if (!active) fail('点击分栏后无激活项');
    }
    console.log('✅ 全部分栏可点击切换');

    // 找到对话模型分栏并点击
    const llmTab = tabBtns.find((b) => /模型|LLM/.test(b.textContent));
    if (!llmTab) fail('找不到对话模型分栏');
    else {
      llmTab.click();
      await sleep(150);
      // 点「获取模型列表」
      const fetchBtn = [...document.querySelectorAll('.btn')].find((b) => /获取模型/.test(b.textContent));
      if (!fetchBtn) fail('找不到「获取模型列表」按钮');
      else {
        fetchBtn.click();
        await sleep(400);
        const selects = document.querySelectorAll('.drawer select');
        const modelSelect = [...selects].find((s) => [...s.options].some((o) => o.value === 'gpt-4o'));
        if (!modelSelect) fail('获取模型后未出现模型下拉框');
        else {
          console.log('✅ 模型下拉框出现，选项数:', modelSelect.options.length);
          // 选择模型
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(modelSelect, 'deepseek-chat');
          modelSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
          await sleep(150);
          // LLM 分栏输入框顺序：API 地址、API Key、模型
          const inputs = document.querySelectorAll('.drawer input.t-input');
          const modelInput = inputs[2] ?? inputs[inputs.length - 1];
          console.log('   模型输入框当前值:', modelInput ? modelInput.value : '(无)');
          if (!modelInput || modelInput.value !== 'deepseek-chat') fail('选择模型后未填入输入框');
          else console.log('✅ 选择模型已填入输入框');
        }
      }
    }

    // 插件分栏渲染检查
    const pluginTab = tabBtns.find((b) => /插件/.test(b.textContent));
    if (pluginTab) {
      pluginTab.click();
      await sleep(150);
      if (document.querySelectorAll('.plugin-item').length === 0) fail('插件分栏未渲染插件列表');
      else console.log('✅ 插件分栏渲染正常');
    }
  }
} catch (e) {
  fail('渲染/交互异常: ' + (e && e.stack ? e.stack : e));
}

const rootNow = document.getElementById('root');
if (rootNow && rootNow.innerHTML.length === 0) fail('交互后 root 变空（白屏）');

console.log('captured errors:', errors.length);
for (const e of errors) console.log('  -', e && e.stack ? e.stack : e);
console.log(failed ? '❌ 存在失败项' : '✅ 全部通过');
process.exit(failed ? 1 : 0);
