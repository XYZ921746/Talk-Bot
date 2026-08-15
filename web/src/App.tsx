import { useCallback, useEffect, useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { fetchBootstrap } from './api';
import { loadSettings, saveSettings, loadDisabledPlugins, saveDisabledPlugins } from './settings';
import { loadUiLang, saveUiLang, makeT } from './i18n';
import type { UiLang } from './i18n';
import type { BootstrapData, ChatMsg, SessionConfig } from './types';
import { createConversation, loadConversations, removeConversation, saveConversations } from './conversations';
import type { Conversation } from './conversations';
import { ConvList } from './components/ConvList';
import { NewChatPanel } from './components/NewChatPanel';
import { ChatView } from './components/ChatView';
import { SettingsDrawer } from './components/SettingsDrawer';
import { NavRail } from './components/NavRail';
import type { TabId } from './components/SettingsDrawer';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [settings, setSettings] = useState<SessionConfig>(() => loadSettings());
  const [disabledPlugins, setDisabledPlugins] = useState<string[]>(() => loadDisabledPlugins());
  const [uiLang, setUiLang] = useState<UiLang>(() => loadUiLang());
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('ava.theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  const t = makeT(uiLang);
  const isDesktop = useIsDesktop();

  // 深度思考快捷开关（独立存储，connect 时覆盖 reasoningEffort）
  const [deepThink, setDeepThink] = useState<'on' | 'off'>(() => {
    try {
      return localStorage.getItem('ava.deepthink') === 'on' ? 'on' : 'off';
    } catch {
      return 'off';
    }
  });
  const toggleDeepThink = useCallback(() => {
    setDeepThink((prev) => {
      const next = prev === 'on' ? 'off' : 'on';
      try {
        localStorage.setItem('ava.deepthink', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // 主题应用到 <html data-theme> + meta theme-color
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#eef1f5');
    try {
      localStorage.setItem('ava.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const [convs, setConvs] = useState<Conversation[]>(() => loadConversations());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<TabId>('general');
  const [activeNav, setActiveNav] = useState<'chat' | 'contacts'>('chat');

  // 导航栏「联系人」= 打开人设列表（新建聊天面板）
  const handleNav = useCallback(
    (nav: 'chat' | 'contacts') => {
      setActiveNav(nav);
      if (nav === 'contacts') setNewChatOpen(true);
      else setNewChatOpen(false);
    },
    [],
  );

  useEffect(() => {
    saveConversations(convs);
  }, [convs]);

  // ===== 初始化 =====
  useEffect(() => {
    void fetchBootstrap().then(setBootstrap).catch(() => {});
  }, []);

  // ===== 会话操作 =====
  const openChat = useCallback((id: string) => {
    setActiveId(id);
    setMobileView('chat');
  }, []);

  const handleNewPick = useCallback(
    (personaId: string) => {
      const conv = createConversation(personaId);
      setConvs((prev) => [conv, ...prev]);
      openChat(conv.id);
      setNewChatOpen(false);
    },
    [openChat],
  );

  const handleDelete = useCallback((id: string) => {
    setConvs((prev) => removeConversation(prev, id));
    setActiveId((prev) => (prev === id ? null : prev));
    setMobileView('list');
  }, []);

  const updateMessages = useCallback((convId: string, msgs: ChatMsg[]) => {
    setConvs((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: msgs, updatedAt: Date.now() } : c)),
    );
  }, []);

  const openSettings = useCallback((tab: TabId) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const refreshBootstrap = useCallback(() => {
    void fetchBootstrap().then(setBootstrap).catch(() => {});
  }, []);

  const activeConv = convs.find((c) => c.id === activeId) ?? null;
  const activePersona = bootstrap?.personas.find((p) => p.id === activeConv?.personaId) ?? null;
  const personas = bootstrap?.personas ?? [];

  const chatView = activeConv ? (
    <ChatView
      key={activeConv.id}
      conv={activeConv}
      persona={activePersona}
      settings={settings}
      disabledPlugins={disabledPlugins}
      deepThink={deepThink}
      onToggleDeepThink={toggleDeepThink}
      onMessagesChange={updateMessages}
      onBack={isDesktop ? undefined : () => setMobileView('list')}
      onDelete={() => handleDelete(activeConv.id)}
      t={t}
    />
  ) : null;

  return (
    <div className="app qq">
      {isDesktop ? (
        <>
          <NavRail
            activeNav={activeNav}
            onNav={handleNav}
            onOpenSettings={() => openSettings('general')}
            theme={theme}
            onToggleTheme={toggleTheme}
            t={t}
          />
          <ConvList
            convs={convs}
            personas={personas}
            activeId={activeId}
            onSelect={openChat}
            onNew={() => setNewChatOpen(true)}
            onDelete={handleDelete}
            onOpenSettings={() => openSettings('general')}
            theme={theme}
            onToggleTheme={toggleTheme}
            rail
            t={t}
          />
          {chatView ?? (
            <section className="chat-panel chat-empty">
              <MessageSquarePlus size={44} className="empty-icon" />
              <p>{t('conv.placeholder')}</p>
              <button className="btn primary" onClick={() => setNewChatOpen(true)}>
                <MessageSquarePlus size={15} /> {t('conv.new')}
              </button>
            </section>
          )}
        </>
      ) : mobileView === 'list' ? (
        <ConvList
          convs={convs}
          personas={personas}
          activeId={activeId}
          onSelect={openChat}
          onNew={() => setNewChatOpen(true)}
          onDelete={handleDelete}
          onOpenSettings={() => openSettings('general')}
          theme={theme}
          onToggleTheme={toggleTheme}
          t={t}
        />
      ) : (
        chatView
      )}

      {newChatOpen && (
        <NewChatPanel
          personas={personas}
          onPick={handleNewPick}
          onManagePersonas={() => {
            setNewChatOpen(false);
            openSettings('persona');
          }}
          onClose={() => setNewChatOpen(false)}
          t={t}
        />
      )}

      <SettingsDrawer
        open={settingsOpen}
        initialTab={settingsTab}
        onClose={() => setSettingsOpen(false)}
        initial={settings}
        llmKinds={bootstrap?.llmKinds ?? ['openai', 'anthropic']}
        sttKinds={bootstrap?.sttKinds ?? ['openai', 'azure', 'none']}
        ttsKinds={bootstrap?.ttsKinds ?? ['edge', 'openai', 'azure', 'none']}
        personas={personas}
        onPersonasChanged={refreshBootstrap}
        plugins={bootstrap?.plugins ?? []}
        disabledPlugins={disabledPlugins}
        onDisabledPluginsChange={(list) => {
          setDisabledPlugins(list);
          saveDisabledPlugins(list);
        }}
        uiLang={uiLang}
        onUiLangChange={(l) => {
          setUiLang(l);
          saveUiLang(l);
        }}
        t={t}
        onSave={(s) => {
          setSettings(s);
          saveSettings(s);
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
