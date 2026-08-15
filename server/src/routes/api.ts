import type { FastifyInstance } from 'fastify';
import type { PersonaRegistry } from '../personas.js';
import type { PluginManager } from '../plugins/manager.js';
import { loadPlugins } from '../plugins/loader.js';
import { createLLMProvider } from '../llm/index.js';
import { createTTSProvider } from '../tts/index.js';
import { createSTTProvider } from '../stt/index.js';
import { pcmToWav } from '../voice/wav.js';
import { normalizeBaseUrl } from '../utils/url.js';
import { appendDiary } from '../diary.js';
import type { Persona, SessionConfig } from '../types.js';

interface ApiDeps {
  personas: PersonaRegistry;
  plugins: PluginManager;
  version: string;
}

export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  app.get('/api/health', async () => ({ ok: true, version: deps.version, time: Date.now() }));

  /** 前端启动时拉取的元数据 */
  app.get('/api/bootstrap', async () => ({
    version: deps.version,
    personas: deps.personas.list(),
    plugins: deps.plugins.list.map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      tools: (p.tools ?? []).map((t) => t.name),
    })),
    llmKinds: ['openai', 'anthropic'],
    sttKinds: ['openai', 'azure', 'tencent', 'baidu', 'xfyun', 'none'],
    ttsKinds: ['edge', 'openai', 'azure', 'custom', 'none'],
  }));

  /** 热重载插件：重新扫描 mods/ 目录，无需重启服务（已有会话不受影响，新会话生效） */
  app.post('/api/plugins/reload', async () => {
    const fresh = await loadPlugins(true);
    deps.plugins.setPlugins(fresh);
    return {
      ok: true,
      message: `已重新加载 ${fresh.length} 个插件`,
      plugins: fresh.map((p) => ({ name: p.name, version: p.version })),
    };
  });

  /** 日记/对话压缩（HTTP，不依赖 WebSocket 连接）：把对话交给模型写日记并持久化 */
  app.post('/api/compress', async (req, reply) => {
    const body = req.body as
      | { config?: SessionConfig; personaId?: string; dialog?: string; pressure?: 'low' | 'medium' | 'high' }
      | null;
    const config = body?.config;
    const personaId = body?.personaId ?? 'assistant';
    const dialog = body?.dialog?.trim();
    const pressure = body?.pressure ?? config?.llm.diaryPressure ?? 'medium';
    if (!config || !config.llm?.baseUrl) {
      return reply.status(400).send({ ok: false, message: '缺少模型配置' });
    }
    if (!dialog) {
      return reply.status(400).send({ ok: false, message: '当前没有可压缩的对话内容，请先和 AI 聊几句再压缩' });
    }
    try {
      const llm = createLLMProvider(config.llm);
      const period = config.llm.diaryPeriod ?? 'daily';
      const pressureDesc =
        pressure === 'high'
          ? '只记录最关键的事实、决定和结论，尽量简略，忽略日常寒暄与细节，总长度控制在 200 字以内。'
          : pressure === 'low'
            ? '尽量详细地保留对话内容，包括具体话题、观点和重要细节，并给出每段的简要概括，可到 600 字以上。'
            : '记录主要话题、关键问答和重要结论，适度保留细节，简洁但不丢重点，约 300 字。';
      const periodDesc = period === 'weekly' ? '这是本周的周记，请按本周发生的事来写。' : '这是今天的日记，请按今天发生的事来写。';
      const custom = config.llm.diaryPrompt?.trim();
      const sysPrompt = custom
        ? custom.replaceAll('{pressure}', pressureDesc).replaceAll('{content}', dialog).replaceAll('{period}', periodDesc)
        : `你是对话记录员。请把下面的对话整理成一篇第三人称"日记"，记录聊了什么、关键话题、重要的事实/偏好/承诺。写作要求：${pressureDesc} ${periodDesc} 用中文。只输出日记正文，不要任何解释。`;

      const result = await llm.chat(
        [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: dialog },
        ],
        { temperature: 0.4, maxTokens: Math.max(config.llm.maxTokens, 1024), signal: AbortSignal.timeout(45_000) },
      );
      const diaryText = (result.text ?? '').trim();
      if (!diaryText) {
        return { ok: false, message: '写日记没拿到内容（模型返回为空），请重试或降低强度' };
      }
      // 日期标题：按天=当天；按周=本周（周一~周日）
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      let title: string;
      if (period === 'weekly') {
        const day = (now.getDay() + 6) % 7;
        const mon = new Date(now);
        mon.setDate(now.getDate() - day);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        title = `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())} ~ ${sun.getFullYear()}-${pad(sun.getMonth() + 1)}-${pad(sun.getDate())}（周记）`;
      } else {
        title = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}（日记）`;
      }
      const titled = `## ${title}\n${diaryText}`;
      appendDiary(personaId, titled);
      return { ok: true, diary: titled, personaId };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 连接测试：kind = llm | tts | stt */
  app.post('/api/test', async (req, reply) => {
    const body = req.body as { kind?: string; config?: SessionConfig } | null;
    const kind = body?.kind;
    const config = body?.config;
    if (!config || !kind) {
      return reply.status(400).send({ ok: false, message: '缺少 kind 或 config' });
    }
    try {
      if (kind === 'llm') {
        const llm = createLLMProvider(config.llm);
        const r = await llm.chat(
          [{ role: 'user', content: '你好，请只回复两个字：正常' }],
          { maxTokens: 16 },
        );
        return { ok: true, message: `连通成功：${r.text.trim().slice(0, 50)}` };
      }
      if (kind === 'tts') {
        const tts = createTTSProvider(config.tts);
        if (!tts) return { ok: false, message: '未选择 TTS 类型' };
        const audio = await tts.synthesize('你好，语音合成测试。', config.tts.voice, config.tts.rate);
        return { ok: true, message: `连通成功：合成 ${audio.length} 字节音频（${tts.displayName}）` };
      }
      if (kind === 'stt') {
        const stt = createSTTProvider(config.stt);
        if (!stt) return { ok: false, message: '未选择 STT 类型（语音识别）' };
        // 内置 0.5 秒测试音频（16kHz 正弦波），验证接口连通与返回结构
        const samples = new Int16Array(8000);
        for (let i = 0; i < samples.length; i++) {
          samples[i] = Math.round(Math.sin((i / 8000) * Math.PI * 2 * 440) * 8000);
        }
        const wav = pcmToWav(samples, 16000);
        const text = await stt.transcribe(wav, config.stt.language);
        return { ok: true, message: `连通成功：识别结果「${(text || '(空)').slice(0, 30)}」（${stt.displayName}）` };
      }
      return reply.status(400).send({ ok: false, message: `不支持测试类型: ${kind}` });
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  /** 从 LLM 网关拉取可用模型列表（GET {baseUrl}/models） */
  app.post('/api/models', async (req, reply) => {
    const body = (req.body ?? {}) as { config?: SessionConfig };
    const llm = body.config?.llm;
    if (!llm?.baseUrl || !llm.apiKey) {
      return reply.status(400).send({ ok: false, message: '请先填写 LLM 的 API 地址和 API Key' });
    }
    try {
      const base = normalizeBaseUrl(llm.baseUrl);
      const headers: Record<string, string> = {};
      if (llm.type === 'anthropic') {
        headers['x-api-key'] = llm.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${llm.apiKey}`;
      }
      const res = await fetch(`${base}/models`, { headers });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${detail.slice(0, 300)}`);
      }
      const json = (await res.json()) as { data?: { id?: string }[] };
      const models = [...new Set((json.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x)))].sort();
      if (!models.length) {
        return { ok: true, models: [], message: '网关返回了空模型列表' };
      }
      return { ok: true, models };
    } catch (err) {
      return { ok: false, message: `获取模型列表失败：${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // ===== 人设管理（自定义人设 CRUD，持久化到 server/personas/*.json） =====

  app.get('/api/personas', async () => ({ personas: deps.personas.list() }));

  app.post('/api/personas', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<Persona>;
    if (!body.name?.trim() || !body.systemPrompt?.trim()) {
      return reply.status(400).send({ ok: false, message: 'name 和 systemPrompt 不能为空' });
    }
    try {
      const persona = deps.personas.add(body as Persona & { name: string; systemPrompt: string });
      return { ok: true, persona };
    } catch (err) {
      return reply.status(400).send({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.put('/api/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Partial<Persona>;
    try {
      const persona = deps.personas.update(id, body);
      return { ok: true, persona };
    } catch (err) {
      return reply.status(400).send({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      deps.personas.remove(id);
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  });
}
