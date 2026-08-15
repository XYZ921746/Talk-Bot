import type { BootstrapData, Persona, SessionConfig } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function fetchBootstrap(): Promise<BootstrapData> {
  return request<BootstrapData>('/api/bootstrap');
}

export async function testConnection(
  kind: 'llm' | 'tts' | 'stt',
  config: SessionConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    return await request<{ ok: boolean; message: string }>('/api/test', {
      method: 'POST',
      body: JSON.stringify({ kind, config }),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** 日记/对话压缩（HTTP，不依赖 WebSocket 连接） */
export async function compressDialog(
  config: SessionConfig,
  personaId: string,
  dialog: string,
  pressure?: 'low' | 'medium' | 'high',
): Promise<{ ok: boolean; diary?: string; message?: string }> {
  try {
    return await request<{ ok: boolean; diary?: string; message?: string }>('/api/compress', {
      method: 'POST',
      body: JSON.stringify({ config, personaId, dialog, pressure }),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** 从 LLM 网关拉取可用模型列表 */
export async function fetchModels(
  config: SessionConfig,
): Promise<{ ok: boolean; models?: string[]; message?: string }> {
  try {
    return await request<{ ok: boolean; models?: string[]; message?: string }>('/api/models', {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ===== 人设管理 =====

export async function createPersona(p: Partial<Persona>): Promise<Persona> {
  const r = await request<{ ok: boolean; persona: Persona }>('/api/personas', {
    method: 'POST',
    body: JSON.stringify(p),
  });
  return r.persona;
}

export async function updatePersona(id: string, p: Partial<Persona>): Promise<Persona> {
  const r = await request<{ ok: boolean; persona: Persona }>(`/api/personas/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(p),
  });
  return r.persona;
}

export async function deletePersona(id: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/personas/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 热重载插件（无需重启服务端） */
export async function reloadPlugins(): Promise<{ ok: boolean; message?: string }> {
  try {
    return await request<{ ok: boolean; message?: string }>('/api/plugins/reload', { method: 'POST' });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
