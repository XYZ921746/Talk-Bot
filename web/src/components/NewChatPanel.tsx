import { Plus, X } from 'lucide-react';
import type { Persona } from '../types';
import type { Translate } from '../i18n';

interface Props {
  personas: Persona[];
  onPick(personaId: string): void;
  onManagePersonas(): void;
  onClose(): void;
  t: Translate;
}

function avatarColor(id: string): string {
  const colors = ['#6366f1', '#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e'];
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

export function NewChatPanel({ personas, onPick, onManagePersonas, onClose, t }: Props) {
  return (
    <div className="newchat-mask" onClick={onClose}>
      <div className="newchat" onClick={(e) => e.stopPropagation()}>
        <div className="newchat-head">
          <div>
            <div className="newchat-title">{t('conv.newTitle')}</div>
            <div className="newchat-sub">{t('conv.newHint')}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="newchat-list">
          {personas.map((p) => (
            <div key={p.id} className="newchat-item" onClick={() => onPick(p.id)}>
              <div className="conv-avatar" style={{ background: avatarColor(p.id) }}>
                {p.name.slice(0, 1)}
              </div>
              <div className="newchat-item-main">
                <div className="newchat-item-top">
                  <span className="conv-item-name">{p.name}</span>
                  {p.language && <span className="newchat-lang">{p.language}</span>}
                </div>
                <div className="newchat-item-desc">{p.description}</div>
              </div>
            </div>
          ))}
          {personas.length === 0 && <div className="conv-empty">{t('persona.empty')}</div>}
        </div>

        <div className="newchat-foot">
          <button className="btn primary" onClick={onManagePersonas}>
            <Plus size={15} /> {t('conv.managePersona')}
          </button>
        </div>
      </div>
    </div>
  );
}
