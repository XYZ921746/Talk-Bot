import { MessageSquarePlus, Moon, Settings, Sun, Trash2 } from 'lucide-react';
import type { Conversation } from '../conversations';
import type { Persona } from '../types';
import type { Translate } from '../i18n';

interface Props {
  convs: Conversation[];
  personas: Persona[];
  activeId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onDelete(id: string): void;
  onOpenSettings(): void;
  theme: 'light' | 'dark';
  onToggleTheme(): void;
  /** 桌面端带左侧图标导航栏时，隐藏会话列表头部的主题/设置按钮 */
  rail?: boolean;
  t: Translate;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function personaName(personas: Persona[], id: string): string {
  return personas.find((p) => p.id === id)?.name ?? 'AI';
}

function avatarColor(id: string): string {
  const colors = ['#6366f1', '#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e'];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

export function ConvList({ convs, personas, activeId, onSelect, onNew, onDelete, onOpenSettings, theme, onToggleTheme, rail, t }: Props) {
  const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
  const lastMsg = (c: Conversation) => {
    const m = c.messages[c.messages.length - 1];
    if (!m) return t('conv.new');
    if (m.role === 'system') return m.text.replace(/^[^\w\u4e00-\u9fff]+/, '').slice(0, 30);
    return m.text.slice(0, 30) || '…';
  };

  return (
    <aside className="conv-panel">
      <div className="conv-head">
        <div className="brand">
          <div className="brand-icon">
            <MessageSquarePlus size={20} />
          </div>
          <div className="brand-text">
            <div className="brand-title">{t('conv.title')}</div>
            <div className="brand-sub">{t('app.subtitle')}</div>
          </div>
        </div>
        {!rail && (
          <>
            <button className="icon-btn" title={t('settings')} onClick={onOpenSettings}>
              <Settings size={19} />
            </button>
            <button
              className="icon-btn"
              title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
            </button>
          </>
        )}
      </div>

      <div className="conv-list">
        {sorted.length === 0 && <div className="conv-empty">{t('conv.empty')}</div>}
        {sorted.map((c) => {
          const active = c.id === activeId;
          return (
            <div
              key={c.id}
              className={`conv-item ${active ? 'active' : ''}`}
              onClick={() => onSelect(c.id)}
            >
              <div className="conv-avatar" style={{ background: avatarColor(c.personaId) }}>
                {personaName(personas, c.personaId).slice(0, 1)}
              </div>
              <div className="conv-item-main">
                <div className="conv-item-top">
                  <span className="conv-item-name">{personaName(personas, c.personaId)}</span>
                  <span className="conv-item-time">{formatTime(c.updatedAt)}</span>
                </div>
                <div className="conv-item-preview">{lastMsg(c)}</div>
              </div>
              <button
                className="conv-item-del"
                title={t('conv.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(t('conv.deleteConfirm'))) onDelete(c.id);
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="conv-new-bar">
        <button className="conv-new-btn" onClick={onNew}>
          <MessageSquarePlus size={18} /> {t('conv.new')}
        </button>
      </div>
    </aside>
  );
}
