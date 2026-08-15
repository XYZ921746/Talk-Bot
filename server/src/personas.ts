import fs from 'node:fs';
import path from 'node:path';
import { PERSONA_DIR } from './config.js';
import type { Persona } from './types.js';

const BUILTIN: Persona = {
  id: 'assistant',
  name: '通用助手',
  description: '热情、清晰、乐于助人的全能助手',
  systemPrompt:
    '你是一个热情、清晰、乐于助人的 AI 语音助手。用户通过语音与你对话，请用口语化、简洁的中文回答，' +
    '每次回答控制在 2~4 句话，避免冗长。除非必要，不要使用 Markdown 符号。',
  temperature: 0.7,
  language: 'zh-CN',
  greeting: '你好呀！我是你的 AI 语音助手，想聊点什么？',
};

export class PersonaRegistry {
  private personas = new Map<string, Persona>();

  constructor() {
    this.load();
  }

  private load(): void {
    this.personas.set(BUILTIN.id, BUILTIN);
    if (!fs.existsSync(PERSONA_DIR)) return;
    for (const file of fs.readdirSync(PERSONA_DIR)) {
      if (!/\.(json|js|ts)$/.test(file)) continue;
      try {
        const full = path.join(PERSONA_DIR, file);
        const raw = fs.readFileSync(full, 'utf8');
        const p: Persona = JSON.parse(raw) as Persona;
        if (!p.id || !p.name || !p.systemPrompt) {
          console.warn(`[personas] 跳过无效人设文件: ${file}`);
          continue;
        }
        if (this.personas.has(p.id)) {
          console.warn(`[personas] 人设 id 重复，覆盖: ${p.id}`);
        }
        this.personas.set(p.id, { temperature: 0.7, ...p });
      } catch (err) {
        console.warn(`[personas] 加载失败 ${file}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  get(id?: string): Persona {
    if (id && this.personas.has(id)) return this.personas.get(id)!;
    return BUILTIN;
  }

  list(): Persona[] {
    return [...this.personas.values()];
  }

  /** 新建人设并持久化到 server/personas/ */
  add(p: Partial<Persona> & { name: string; systemPrompt: string }): Persona {
    const id = p.id?.trim() || `p_${Date.now().toString(36)}`;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error('人设 id 只能包含字母、数字、下划线和连字符');
    }
    const persona: Persona = {
      id,
      name: p.name.trim(),
      description: p.description?.trim() || '',
      systemPrompt: p.systemPrompt.trim(),
      temperature: p.temperature ?? 0.7,
      voice: p.voice?.trim() || undefined,
      language: p.language?.trim() || undefined,
      greeting: p.greeting?.trim() || undefined,
    };
    this.personas.set(id, persona);
    this.saveFile(persona);
    return persona;
  }

  /** 更新人设（内置人设可改但不会写文件） */
  update(id: string, patch: Partial<Persona>): Persona {
    const cur = this.personas.get(id);
    if (!cur) throw new Error(`人设不存在: ${id}`);
    const merged: Persona = {
      ...cur,
      ...patch,
      id: cur.id, // id 不可改
      name: (patch.name ?? cur.name).trim(),
      systemPrompt: (patch.systemPrompt ?? cur.systemPrompt).trim(),
      temperature: patch.temperature ?? cur.temperature,
      description: (patch.description ?? cur.description ?? '').trim(),
      voice: patch.voice !== undefined ? patch.voice.trim() || undefined : cur.voice,
      language: patch.language !== undefined ? patch.language.trim() || undefined : cur.language,
      greeting: patch.greeting !== undefined ? patch.greeting.trim() || undefined : cur.greeting,
    };
    this.personas.set(id, merged);
    if (id !== BUILTIN.id) this.saveFile(merged);
    return merged;
  }

  /** 删除人设（内置人设不可删除） */
  remove(id: string): void {
    if (id === BUILTIN.id) throw new Error('内置人设不可删除');
    if (!this.personas.has(id)) throw new Error(`人设不存在: ${id}`);
    this.personas.delete(id);
    const file = path.join(PERSONA_DIR, `${id}.json`);
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (err) {
        console.warn(`[personas] 删除文件失败 ${file}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private saveFile(p: Persona): void {
    if (!fs.existsSync(PERSONA_DIR)) {
      fs.mkdirSync(PERSONA_DIR, { recursive: true });
    }
    const file = path.join(PERSONA_DIR, `${p.id}.json`);
    fs.writeFileSync(file, JSON.stringify(p, null, 2), 'utf8');
  }
}
