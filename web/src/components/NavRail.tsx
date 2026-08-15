import { MessageSquare, Moon, Settings, Sun, Users } from 'lucide-react';
import type { Translate } from '../i18n';

interface Props {
  activeNav: 'chat' | 'contacts';
  onNav(nav: 'chat' | 'contacts'): void;
  onOpenSettings(): void;
  theme: 'light' | 'dark';
  onToggleTheme(): void;
  t: Translate;
}

/** 电脑 QQ 式左侧图标导航栏 */
export function NavRail({ activeNav, onNav, onOpenSettings, theme, onToggleTheme, t }: Props) {
  return (
    <nav className="nav-rail">
      <div className="nav-avatar" title={t('nav.me')}>
        <span>{t('nav.me')}</span>
      </div>

      <div className="nav-icons">
        <button
          className={`nav-icon ${activeNav === 'chat' ? 'active' : ''}`}
          onClick={() => onNav('chat')}
          title={t('conv.title')}
        >
          <MessageSquare size={22} />
        </button>
        <button
          className={`nav-icon ${activeNav === 'contacts' ? 'active' : ''}`}
          onClick={() => onNav('contacts')}
          title={t('nav.contacts')}
        >
          <Users size={22} />
        </button>
      </div>

      <div className="nav-bottom">
        <button
          className="nav-icon"
          onClick={onToggleTheme}
          title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        >
          {theme === 'dark' ? <Sun size={21} /> : <Moon size={21} />}
        </button>
        <button className="nav-icon" onClick={onOpenSettings} title={t('settings')}>
          <Settings size={21} />
        </button>
      </div>
    </nav>
  );
}
