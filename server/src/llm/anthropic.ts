import type { ChatMessage, ChatOptions, ChatResult, LLMProvider, LlmKind, ToolCall, ToolDef } from '../types.js';
import { normalizeBaseUrl } from '../utils/url.js';

type AnthropicContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMsg {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

/** Anthropic Messages API 适配器 */
export class AnthropicProvider implements LLMProvider {
  readonly kind: LlmKind = 'anthropic';
  readonly displayName = 'Anthropic';

  constructor(private cfg: { baseUrl: string; apiKey: string; model: string }) {}

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const base = normalizeBaseUrl(this.cfg.baseUrl);
    const url = `${base}/v1/messages`;
    const useStream = Boolean(opts.onDelta) || Boolean(opts.tools?.length);

    const { system, msgs } = toAnthropicMessages(messages);
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      max_tokens: opts.maxTokens ?? 1024,
      messages: msgs,
      stream: useStream,
    };
    if (system) body.system = system;
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
    if (opts.tools?.length) body.tools = opts.tools.map(toAnthropicTool);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`LLM (Anthropic) HTTP ${res.status}: ${detail.slice(0, 500)}`);
    }

    if (useStream) {
      return this.parseStream(res, opts);
    }
    const json = (await res.json()) as { content?: AnthropicContent[] };
    return fromContentBlocks(json.content ?? []);
  }

  private async parseStream(res: Response, opts: ChatOptions): Promise<ChatResult> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    const toolsByIdx = new Map<number, { id: string; name: string; input: string }>();
    let lastEvent = '';

    const feed = (event: string, json: Record<string, unknown>) => {
      switch (event) {
        case 'content_block_start': {
          const block = json.content_block as AnthropicContent | undefined;
          if (block?.type === 'tool_use') {
            toolsByIdx.set(json.index as number, {
              id: block.id,
              name: block.name,
              input: '',
            });
          }
          break;
        }
        case 'content_block_delta': {
          const delta = json.delta as { type?: string; text?: string; partial_json?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.text) {
            text += delta.text;
            opts.onDelta?.(delta.text);
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const cur = toolsByIdx.get(json.index as number);
            if (cur) cur.input += delta.partial_json;
          }
          break;
        }
        default:
          break;
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
        if (line.startsWith('event:')) {
          lastEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]' || payload === '') continue;
          try {
            feed(lastEvent, JSON.parse(payload) as Record<string, unknown>);
          } catch {
            /* 忽略 */
          }
        }
      }
    }
    const toolCalls = [...toolsByIdx.values()].map((t) => ({
      id: t.id,
      name: t.name,
      args: safeParse(t.input),
    }));
    return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
  }
}

function toAnthropicMessages(messages: ChatMessage[]): { system: string; msgs: AnthropicMsg[] } {
  const system: string[] = [];
  const msgs: AnthropicMsg[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(m.content);
      continue;
    }
    let blocks: AnthropicContent[];
    if (m.role === 'assistant') {
      blocks = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args ?? {} });
      }
    } else if (m.role === 'tool') {
      blocks = [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }];
    } else {
      blocks = [{ type: 'text', text: m.content }];
    }
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) {
      last.content.push(...blocks);
    } else {
      msgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: blocks });
    }
  }
  return { system: system.join('\n\n'), msgs };
}

function toAnthropicTool(t: ToolDef): Record<string, unknown> {
  return { name: t.name, description: t.description, input_schema: t.parameters };
}

function fromContentBlocks(blocks: AnthropicContent[]): ChatResult {
  const text = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const toolCalls: ToolCall[] = blocks
    .filter((b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: b.input }));
  return { text, toolCalls: toolCalls.length ? toolCalls : undefined };
}

function safeParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
