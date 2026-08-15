import type { ChatMsg } from './types';

/** 会话：每个会话绑定一个人设（聊天对象），消息存本地浏览器 */
export interface Conversation {
  id: string;
  personaId: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMsg[];
}

const KEY = 'ava.convs.v1';
const MAX_MSG = 50;

export function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Conversation[];
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && c.id && c.personaId);
  } catch {
    return [];
  }
}

export function saveConversations(convs: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(convs));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function createConversation(personaId: string): Conversation {
  const now = Date.now();
  return {
    id: `c_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    personaId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function pushConversationMessage(convs: Conversation[], convId: string, msg: ChatMsg): Conversation[] {
  return convs.map((c) => {
    if (c.id !== convId) return c;
    const messages = [...c.messages, msg];
    if (messages.length > MAX_MSG) messages.splice(0, messages.length - MAX_MSG);
    return { ...c, messages, updatedAt: Date.now() };
  });
}

export function removeConversation(convs: Conversation[], convId: string): Conversation[] {
  return convs.filter((c) => c.id !== convId);
}

/** 会话列表排序：最近更新在前 */
export function sortConversations(convs: Conversation[]): Conversation[] {
  return [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
}
