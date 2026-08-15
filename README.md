# 🎙️ AI 语音通话

> **作者想说的话**：我是一个新手小白本项目是我的一个上传GitHub的项目这个项目是我的一个突发奇想写出来的我本人并不会代码所有代码都是由deepseek和qwen提供就连readme都是鲸鱼写的这一段不是，当然大部分是deepseek的事情毕竟qwen是真的贵啊！！！好啦希望你喜欢我的作品谢谢，附带上一只神秘蓝鲸鱼的照片  

<p align="center">
  <img src="docs/whale.jpg" alt="神秘蓝鲸鱼" width="400" />
</p>

多端互通的 **AI 实时语音通话**应用：像打电话一样跟 AI 聊天。基于 Node.js 构建，支持文字聊天、语音通话、自定义人设、插件系统，可接入多种云端语音识别/合成服务。

> 支持 OpenAI / Anthropic 兼容的大模型网关，语音识别支持腾讯云、百度、讯飞、Azure、OpenAI 兼容（Whisper），语音合成支持 Edge TTS（免费）、OpenAI、Azure 及自定义本地 TTS。

---

## ✨ 功能特性

- 📞 **实时语音通话**：点开语音键，说话 → AI 识别 → 大模型回复 → 语音播放，全程免手
- 💬 **文字聊天**：随时切换打字，回复可自动朗读（可关）
- 🧠 **深度思考开关**：一键切换 `reasoning_effort=high`（适合推理模型）
- 📓 **日记 / 对话压缩**：把长对话交给模型写成日记（按天/按周），自动清理历史、保留长期记忆、节省 token；支持自定义压缩提示词
- 🧩 **插件系统**：`mods/` 目录放一个 JS 文件即扩展能力（工具调用、文本改写、会话钩子、热重载）
- 👤 **自定义人设**：网页里新建/编辑人设（性格、系统提示词、音色、语言自动翻译），持久化到服务端
- 🌐 **多端访问**：局域网内电脑/手机浏览器直接访问（手机和电脑连同一 Wi-Fi）
- 🎨 **QQ 风格界面**：仿 QQ 的三栏布局（图标栏 + 会话列表 + 聊天窗口），明暗主题切换
- 🔤 **中英双语界面**

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js ≥ 20 · TypeScript · Fastify · ws |
| 前端 | React 18 · Vite · lucide-react |
| 语音采集 | Web Audio API（AudioWorklet，16kHz PCM） |
| 语音识别 | 腾讯云 / 百度 / 讯飞 / Azure / OpenAI 兼容 (Whisper) |
| 语音合成 | Edge TTS（免费）/ OpenAI / Azure / 自定义 HTTP TTS |

## 🚀 快速开始

### 环境要求

- **Node.js ≥ 20**（推荐 LTS，[下载地址](https://nodejs.org)）
- 无需 Python、无需显卡（云端语音服务即可）

### 方式一：一键启动（Windows）

双击根目录的 **`启动语音通话.bat`**，自动完成：检查 Node → 安装依赖 → 构建 → 放行防火墙 → 打开浏览器。

### 方式二：命令行

```bash
npm install
npm run dev        # 开发模式（前端 5173 + 后端 3210）
# 或
npm run build && npm start   # 生产模式（单端口 3210）
```

启动后浏览器访问 `http://localhost:3210`。

### 手机访问

手机与电脑连同一 Wi-Fi，访问电脑的局域网 IP：`http://<本机IP>:3210`。

## ⚙️ 配置

首次使用请打开网页 **「设置」** 完成配置：

| 模块 | 说明 |
| --- | --- |
| **对话模型 (LLM)** | 类型（OpenAI 兼容 / Anthropic）、API 地址、Key、模型、温度、上下文长度、思考强度 |
| **语音识别 (STT)** | 腾讯云 ASR（SecretId/Key）、百度、讯飞、Azure、OpenAI 兼容（如本地 Whisper） |
| **语音合成 (TTS)** | Edge TTS（免费）、OpenAI、Azure、自定义 HTTP（SBV2 / GPT-SoVITS） |
| **语音检测 (VAD)** | 触发分贝阈值、停顿判定、单句时长 |
| **人设** | 新建/编辑自定义人设（系统提示词、音色、回复语言、问候语） |
| **插件** | 查看/启停插件、热重载 |

> 服务端兜底配置写在 `.env`（**不会提交到仓库**，见 `.env.example`）。网页里填写的配置优先。

## 📓 日记 / 对话压缩

- 设置 → 对话模型 → 打开「日记 / 对话压缩」
- **自动模式**：对话达到设定条数后自动写日记并清理历史
- **手动模式**：聊天窗口点「📓 写日记/压缩」
- **记录周期**：按天（日记）/ 按周（周记），标题自动带日期
- **强度**：高（更简略）→ 低（保留更多）
- 日记持久化在 `server/diaries/`，下次会话自动注入，形成长期记忆

## 🧩 插件开发

插件放在项目根目录 **`mods/`**（兼容旧目录 `server/plugins/`），一个 `.js` 文件即可：

```js
export default {
  name: '我的插件',
  version: '1.0.0',
  hooks: {
    async onUserText(text, ctx) {
      if (text.trim() === '帮助') return '请用三句话介绍你自己。';
      return text;
    },
  },
  tools: [
    {
      name: 'get_current_time',
      description: '获取当前时间',
      parameters: { type: 'object', properties: {} },
    },
  ],
  async handleTool(name, args, ctx) {
    if (name === 'get_current_time') return { time: new Date().toLocaleString('zh-CN') };
  },
};
```

完整文档见 [`docs/插件开发.md`](docs/插件开发.md)。

## 📁 目录结构

```
├── server/          # 后端（Fastify + WS 语音流 + VAD/STT/LLM/TTS 管道）
│   └── src/
├── web/             # 前端（React + Vite）
│   └── src/
├── mods/            # 插件目录（用户可放自己的插件）
├── docs/            # 文档
├── test/            # e2e 测试
└── 启动语音通话.bat  # Windows 一键启动
```

## 🧪 测试

```bash
npm test   # e2e 冒烟测试（自带 mock 服务，无需任何真实 API Key）
```

## 📝 说明

- 本项目**不包含任何密钥**：所有 API Key 都在你本地 `.env` 或网页设置里，`server/personas/`、`server/diaries/` 为用户数据，均已被 `.gitignore` 忽略。
- 语音通话依赖已配置的 STT/TTS 服务；仅文字聊天也可正常使用。

## 📄 License

MIT
