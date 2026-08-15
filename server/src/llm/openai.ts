import type { ChatMessage, ChatOptions, ChatResult, LLMProvider, LlmKind, ToolDef } from '../types.js';
import { normalizeBaseUrl } from '../utils/url.js';

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

/** OpenAI 兼容 /chat/completions 适配器（OpenAI、DeepSeek、Moonshot、本地 vLLM 等皆可） */
export class OpenAIProvider implements LLMProvider {
  readonly kind: LlmKind = 'openai';
  readonly displayName = 'OpenAI 兼容';

  constructor(
    private cfg: { baseUrl: string; apiKey: string; model: string; reasoningEffort?: string },
  ) {}

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const base = normalizeBaseUrl(this.cfg.baseUrl);
    const url = `${base}/chat/completions`;
    const useStream = Boolean(opts.onDelta) || Boolean(opts.tools?.length);

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: messages.map(toOpenAIMessage),
      stream: useStream,
    };
    if (opts.tools?.length) body.tools = opts.tools.map(toOpenAITool);
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
    // 思考强度（推理模型，如 o 系列）；auto 时不传，让服务端默认
    if (this.cfg.reasoningEffort && this.cfg.reasoningEffort !== 'auto') {
      body.reasoning_effort = this.cfg.reasoningEffort;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      // 60s 超时兜底，避免网关不响应导致永远等待；支持外部打断信号
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let hint = '';
      if (detail.includes('model_not_found') || detail.includes('no available channel')) {
        hint = '（模型不可用：请在设置 → 对话模型 → 点“获取模型列表”选择网关实际支持的模型）';
      } else if (detail.includes('invalid api key') || detail.includes('401')) {
        hint = '（API Key 无效，请检查）';
      }
      throw new Error(`LLM (${this.displayName}) HTTP ${res.status}: ${detail.slice(0, 500)}${hint}`);
    }

    if (useStream) {
      return this.parseStream(res, opts);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: unknown[] } }[];
    };
    const msg = json.choices?.[0]?.message;
    return {
      text: msg?.content ?? '',
      toolCalls: toToolCalls(msg?.tool_calls),
    };
  }

  private async parseStream(res: Response, opts: ChatOptions): Promise<ChatResult> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    const tcByIdx = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: string | null = null;

    const feed = (json: Record<string, unknown>) => {
      const choice = (json.choices as Record<string, unknown>[] | undefined)?.[0];
      if (!choice) return;
      finishReason = (choice.finish_reason as string) ?? finishReason;
      const delta = choice.delta as
        | { content?: string; tool_calls?: OpenAIToolCallDelta[] }
        | undefined;
      if (delta) {
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          opts.onDelta?.(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          let cur = tcByIdx.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          tcByIdx.set(idx, cur);
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return { text, toolCalls: finishToToolCalls(tcByIdx) };
        try {
          feed(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          /* 忽略无法解析的行 */
        }
      }
    }
    return { text, toolCalls: finishToToolCalls(tcByIdx) };
  }
}

function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'system':
      return { role: 'system', content: m.content };
    case 'user':
      return { role: 'user', content: m.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  }
}

function toOpenAITool(t: ToolDef): Record<string, unknown> {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
}

function toToolCalls(raw: unknown[] | undefined) {
  if (!raw?.length) return undefined;
  return raw
    .map((tc) => tc as { id?: string; function?: { name?: string; arguments?: string } })
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: tc.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
      name: tc.function!.name!,
      args: safeParse(tc.function?.arguments ?? ''),
    }));
}

function finishToToolCalls(map: Map<number, { id: string; name: string; args: string }>) {
  if (!map.size) return undefined;
  return [...map.values()].map((tc) => ({
    id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
    name: tc.name,
    args: safeParse(tc.args),
  }));
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
