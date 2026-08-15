import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { Persona, PluginInfo, SessionConfig } from '../types';
import { createPersona, deletePersona, fetchModels, reloadPlugins, testConnection, updatePersona } from '../api';
import { cloneSettings, DEFAULT_SETTINGS, resetSettings } from '../settings';
import type { Translate, UiLang } from '../i18n';

/** 语言 → 该语言常用的 Edge TTS 音色（选择语言时自动填入） */
const LANG_VOICES: Record<string, string> = {
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'en-US': 'en-US-AriaNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
  'it-IT': 'it-IT-ElsaNeural',
  'pt-BR': 'pt-BR-FranciscaNeural',
};

const LANG_OPTIONS = Object.keys(LANG_VOICES);

/** 自定义 HTTP TTS 常用模板（一键填入） */
const CUSTOM_TTS_TEMPLATES = [
  {
    id: 'sbv2-ling',
    label: 'SBV2-API · Ling 音色（3000 端口）',
    url: 'http://127.0.0.1:3000/synthesize',
    method: 'POST' as const,
    body: '{"text":"{text}","ident":"Ling v2"}',
  },
  {
    id: 'sbv2-fusetsu',
    label: 'SBV2-API · Fusetsu 音色（3000 端口）',
    url: 'http://127.0.0.1:3000/synthesize',
    method: 'POST' as const,
    body: '{"text":"{text}","ident":"Fusetsu_v1.5"}',
  },
  {
    id: 'gpt-sovits',
    label: 'GPT-SoVITS（v2 接口示例）',
    url: 'http://127.0.0.1:9880/tts',
    method: 'POST' as const,
    body: '{"text":"{text}","text_lang":"zh","ref_audio_path":"ref.wav","prompt_text":"","prompt_lang":"zh"}',
  },
];

/** token 数格式化：1234567 → 1.2M，500000 → 500K */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  return `${(n / 1000).toFixed(0)}K`;
}

/** RMS 能量 → 分贝（dBFS）：20*log10(rms) */
function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 0.0001));
}

/** 分贝 → RMS 能量 */
function dbToRms(db: number): number {
  return Math.pow(10, db / 20);
}

type TabId = 'general' | 'llm' | 'stt' | 'tts' | 'vad' | 'persona' | 'plugins';
export type { TabId };

interface Props {
  open: boolean;
  onClose(): void;
  initialTab?: TabId;
  initial: SessionConfig;
  llmKinds: string[];
  sttKinds: string[];
  ttsKinds: string[];
  personas: Persona[];
  onPersonasChanged(): void;
  plugins: PluginInfo[];
  disabledPlugins: string[];
  onDisabledPluginsChange(list: string[]): void;
  onSave(s: SessionConfig): void;
  uiLang: UiLang;
  onUiLangChange(l: UiLang): void;
  t: Translate;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">{title}</div>
      {hint && <div className="section-hint">{hint}</div>}
      <div className="section-body">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function TInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="t-input" {...props} />;
}

function TSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="t-input" {...props} />;
}

export function SettingsDrawer({
  open,
  onClose,
  initialTab = 'general',
  initial,
  llmKinds,
  sttKinds,
  ttsKinds,
  personas,
  onPersonasChanged,
  plugins,
  disabledPlugins,
  onDisabledPluginsChange,
  onSave,
  uiLang,
  onUiLangChange,
  t,
}: Props) {
  const [s, setS] = useState<SessionConfig>(() => cloneSettings(initial));
  const [tab, setTab] = useState<TabId>('general');
  const [testing, setTesting] = useState<null | 'llm' | 'tts' | 'stt'>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsMsg, setModelsMsg] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [reloadingPlugins, setReloadingPlugins] = useState(false);
  const [pluginReloadMsg, setPluginReloadMsg] = useState<string | null>(null);

  // 人设管理状态
  const [personaList, setPersonaList] = useState<Persona[]>(personas);
  const [editId, setEditId] = useState<string>('');
  const [form, setForm] = useState<Partial<Persona>>({});
  const [isNew, setIsNew] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);
  const [personaMsg, setPersonaMsg] = useState<string | null>(null);

  // 人设列表随服务端数据同步
  useEffect(() => {
    setPersonaList(personas);
  }, [personas]);

  // 选中的人设变化时加载表单（新建模式下不干扰）
  useEffect(() => {
    if (isNew || !personas.length) return;
    const cur = personas.find((p) => p.id === editId);
    if (cur) {
      setForm(cur);
      return;
    }
    setEditId(personas[0].id);
    setForm(personas[0]);
  }, [personas, editId, isNew]);

  // 打开时切到指定分栏（如从「新建聊天」直达人设管理）
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // 内容区左右滑动切换分栏（touch 手势）
  const touchX = useRef<number | null>(null);
  const touchY = useRef<number | null>(null);
  const onBodyTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0].clientX;
    touchY.current = e.touches[0].clientY;
  };
  const onBodyTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current === null || touchY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    const dy = e.changedTouches[0].clientY - touchY.current;
    touchX.current = null;
    touchY.current = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return; // 水平位移不足或竖向滚动
    const order = tabs.map((tb) => tb.id);
    const idx = order.indexOf(tab);
    const next = dx < 0 ? Math.min(idx + 1, order.length - 1) : Math.max(idx - 1, 0);
    if (next !== idx) setTab(order[next]);
  };

  if (!open) return null;

  const set = <K extends keyof SessionConfig>(key: K, patch: Partial<SessionConfig[K]>) => {
    setS((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const runTest = async (kind: 'llm' | 'tts' | 'stt') => {
    setTesting(kind);
    setTestResult(null);
    const r = await testConnection(kind, s);
    setTestResult(r);
    setTesting(null);
  };

  const runFetchModels = async () => {
    setFetchingModels(true);
    setModelsMsg(null);
    const r = await fetchModels(s);
    if (r.ok && r.models?.length) {
      setModels(r.models);
      setModelsMsg(t('llm.modelsFetched', { n: r.models.length }));
    } else if (r.ok) {
      setModels([]);
      setModelsMsg(t('llm.modelsEmpty'));
    } else {
      setModelsMsg(`❌ ${r.message ?? '获取失败'}`);
    }
    setFetchingModels(false);
  };

  // ===== 人设 CRUD =====
  const startNewPersona = () => {
    setIsNew(true);
    setEditId('');
    setForm({ id: `p_${Date.now().toString(36)}`, name: '', description: '', systemPrompt: '', temperature: 0.7, voice: '', language: 'zh-CN', greeting: '' });
    setPersonaMsg(null);
  };

  const savePersona = async () => {
    if (!form.name?.trim() || !form.systemPrompt?.trim()) {
      setPersonaMsg(t('persona.needName'));
      return;
    }
    setSavingPersona(true);
    setPersonaMsg(null);
    try {
      let saved: Persona;
      if (isNew) {
        saved = await createPersona(form);
      } else {
        saved = await updatePersona(editId, form);
      }
      setEditId(saved.id);
      setIsNew(false);
      setPersonaList((prev) => {
        const rest = prev.filter((p) => p.id !== saved.id);
        return [...rest, saved].sort((a, b) => (a.id === 'assistant' ? -1 : b.id === 'assistant' ? 1 : 0));
      });
      setPersonaMsg(t('persona.saved'));
      onPersonasChanged();
    } catch (err) {
      setPersonaMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingPersona(false);
    }
  };

  const removePersona = async () => {
    if (editId === 'assistant' || !editId) return;
    if (!window.confirm(t('persona.deleteConfirm'))) return;
    try {
      await deletePersona(editId);
      setPersonaList((prev) => prev.filter((p) => p.id !== editId));
      setIsNew(false);
      setEditId('');
      setPersonaMsg(null);
      onPersonasChanged();
    } catch (err) {
      setPersonaMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: t('tab.general') },
    { id: 'llm', label: t('tab.llm') },
    { id: 'stt', label: t('tab.stt') },
    { id: 'tts', label: t('tab.tts') },
    { id: 'vad', label: t('tab.vad') },
    { id: 'persona', label: t('tab.persona') },
    { id: 'plugins', label: t('tab.plugins') },
  ];

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">{t('drawer.title')}</div>
            <div className="drawer-sub">{t('drawer.sub')}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="drawer-tabs">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              className={`tab-btn ${tab === tb.id ? 'active' : ''}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="drawer-body" onTouchStart={onBodyTouchStart} onTouchEnd={onBodyTouchEnd}>
          {tab === 'general' && (
            <>
              <Section title={t('gen.language')} hint={t('gen.languageHint')}>
                <Field label={t('gen.language')}>
                  <TSelect value={uiLang} onChange={(e) => onUiLangChange(e.target.value as UiLang)}>
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </TSelect>
                </Field>
              </Section>

              <Section title={t('gen.test')}>
                <div className="test-row">
                  <button className="btn" disabled={testing !== null} onClick={() => void runTest('llm')}>
                    {testing === 'llm' ? <Loader2 size={14} className="spin" /> : null} {t('gen.testLlm')}
                  </button>
                  <button className="btn" disabled={testing !== null} onClick={() => void runTest('stt')}>
                    {testing === 'stt' ? <Loader2 size={14} className="spin" /> : null} {t('gen.testStt')}
                  </button>
                  <button className="btn" disabled={testing !== null} onClick={() => void runTest('tts')}>
                    {testing === 'tts' ? <Loader2 size={14} className="spin" /> : null} {t('gen.testTts')}
                  </button>
                </div>
                {testResult && (
                  <div className={`test-result ${testResult.ok ? 'ok' : 'fail'}`}>
                    {testResult.ok ? '✅ ' : '❌ '}
                    {testResult.message}
                  </div>
                )}
              </Section>
            </>
          )}

          {tab === 'llm' && (
            <Section title={t('llm.title')} hint={t('llm.hint')}>
              <Field label={t('llm.format')}>
                <TSelect value={s.llm.type} onChange={(e) => set('llm', { type: e.target.value as SessionConfig['llm']['type'] })}>
                  {llmKinds.map((k) => (
                    <option key={k} value={k}>
                      {k === 'openai' ? 'OpenAI 兼容格式' : 'Anthropic 格式'}
                    </option>
                  ))}
                </TSelect>
              </Field>
              <Field label={t('llm.baseUrl')}>
                <TInput
                  value={s.llm.baseUrl}
                  placeholder={s.llm.type === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
                  onChange={(e) => set('llm', { baseUrl: e.target.value })}
                />
              </Field>
              <Field label={t('llm.apiKey')}>
                <TInput
                  type="password"
                  value={s.llm.apiKey}
                  placeholder="sk-…（留空则用服务端 .env 的默认值）"
                  onChange={(e) => set('llm', { apiKey: e.target.value })}
                />
              </Field>
              <Field label={t('llm.model')}>
                <TInput
                  value={s.llm.model}
                  placeholder="gpt-4o-mini / claude-3-5-haiku-latest"
                  onChange={(e) => set('llm', { model: e.target.value })}
                />
                {models.length > 0 && (
                  <TSelect
                    value={models.includes(s.llm.model) ? s.llm.model : ''}
                    onChange={(e) => set('llm', { model: e.target.value })}
                  >
                    <option value="">{t('llm.chooseModel')}</option>
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </TSelect>
                )}
                <div className="test-row" style={{ marginTop: 2 }}>
                  <button className="btn" disabled={fetchingModels} onClick={() => void runFetchModels()}>
                    {fetchingModels ? <Loader2 size={14} className="spin" /> : <RotateCcw size={13} />} {t('llm.fetchModels')}
                  </button>
                </div>
                {modelsMsg && (
                  <div className={`test-result ${modelsMsg.startsWith('❌') ? 'fail' : 'ok'}`}>{modelsMsg}</div>
                )}
              </Field>
              <Field label={`${t('llm.temperature')} ${s.llm.temperature.toFixed(1)}`}>
                <input
                  className="t-range"
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.1}
                  value={s.llm.temperature}
                  onChange={(e) => set('llm', { temperature: Number(e.target.value) })}
                />
              </Field>
              <Field label={`${t('llm.reasoning')}（${t('llm.reasoningHint')}）`}>
                <TSelect
                  value={s.llm.reasoningEffort ?? 'auto'}
                  onChange={(e) => set('llm', { reasoningEffort: e.target.value as SessionConfig['llm']['reasoningEffort'] })}
                >
                  <option value="auto">{t('llm.reasoningAuto')}</option>
                  <option value="low">{t('llm.reasoningLow')}</option>
                  <option value="medium">{t('llm.reasoningMedium')}</option>
                  <option value="high">{t('llm.reasoningHigh')}</option>
                </TSelect>
              </Field>
              <Field label={`${t('llm.contextSize')}：${formatTokens(s.llm.contextTokens ?? 1_000_000)}`}>
                <input
                  className="t-range"
                  type="range"
                  min={100_000}
                  max={20_000_000}
                  step={100_000}
                  value={s.llm.contextTokens ?? 1_000_000}
                  onChange={(e) => set('llm', { contextTokens: Number(e.target.value) })}
                />
                <div className="range-labels">
                  <span>100K</span>
                  <span>20M</span>
                </div>
                <div className="section-hint" style={{ marginTop: 4 }}>
                  {t('llm.contextHint')}
                </div>
              </Field>
              <Field label={`${t('llm.maxTokens')}：${s.llm.maxTokens}`}>
                <input
                  className="t-range"
                  type="range"
                  min={128}
                  max={4096}
                  step={128}
                  value={s.llm.maxTokens}
                  onChange={(e) => set('llm', { maxTokens: Number(e.target.value) })}
                />
              </Field>

              {/* 日记 / 对话压缩 */}
              <div className="section-divider" />
              <Field label={t('diary.enabled')}>
                <label className={`toggle ${s.llm.diaryEnabled ? 'on' : 'off'}`}>
                  <input
                    type="checkbox"
                    checked={!!s.llm.diaryEnabled}
                    onChange={(e) => set('llm', { diaryEnabled: e.target.checked })}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-label">
                    {s.llm.diaryEnabled ? t('plugins.on') : t('plugins.off')}
                  </span>
                </label>
                <div className="section-hint">{t('diary.enabledHint')}</div>
              </Field>
              {s.llm.diaryEnabled && (
                <>
                  <Field label={t('diary.mode')}>
                    <TSelect value={s.llm.diaryMode ?? 'auto'} onChange={(e) => set('llm', { diaryMode: e.target.value as 'auto' | 'manual' })}>
                      <option value="auto">{t('diary.modeAuto')}</option>
                      <option value="manual">{t('diary.modeManual')}</option>
                    </TSelect>
                  </Field>
                  {s.llm.diaryMode === 'auto' && (
                    <Field label={`${t('diary.trigger')}：${s.llm.diaryTriggerMessages ?? 30} 条`}>
                      <input
                        className="t-range"
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={s.llm.diaryTriggerMessages ?? 30}
                        onChange={(e) => set('llm', { diaryTriggerMessages: Number(e.target.value) })}
                      />
                      <div className="range-labels">
                        <span>10</span>
                        <span>100 条</span>
                      </div>
                    </Field>
                  )}
                  <Field label={`${t('diary.pressureLabel')}：${t('diary.pressure.' + (s.llm.diaryPressure ?? 'medium'))}`}>
                    <TSelect value={s.llm.diaryPressure ?? 'medium'} onChange={(e) => set('llm', { diaryPressure: e.target.value as 'low' | 'medium' | 'high' })}>
                      <option value="high">{t('diary.pressure.high')}</option>
                      <option value="medium">{t('diary.pressure.medium')}</option>
                      <option value="low">{t('diary.pressure.low')}</option>
                    </TSelect>
                    <div className="section-hint">{t('diary.pressureHint')}</div>
                  </Field>
                  <Field label={t('diary.period')}>
                    <TSelect value={s.llm.diaryPeriod ?? 'daily'} onChange={(e) => set('llm', { diaryPeriod: e.target.value as 'daily' | 'weekly' })}>
                      <option value="daily">{t('diary.periodDaily')}</option>
                      <option value="weekly">{t('diary.periodWeekly')}</option>
                    </TSelect>
                    <div className="section-hint">{t('diary.periodHint')}</div>
                  </Field>
                  <Field label={t('diary.customPrompt')}>
                    <textarea
                      className="t-textarea"
                      rows={4}
                      value={s.llm.diaryPrompt ?? ''}
                      placeholder={t('diary.customPromptPlaceholder')}
                      onChange={(e) => set('llm', { diaryPrompt: e.target.value })}
                    />
                    <div className="section-hint">{t('diary.customPromptHint')}</div>
                  </Field>
                </>
              )}
            </Section>
          )}

          {tab === 'stt' && (
            <Section title={t('stt.title')} hint={t('stt.hint')}>
              <Field label={t('stt.type')}>
                <TSelect value={s.stt.type} onChange={(e) => set('stt', { type: e.target.value as SessionConfig['stt']['type'] })}>
                  {sttKinds.map((k) => (
                    <option key={k} value={k}>
                      {k === 'openai'
                        ? 'OpenAI 兼容 (Whisper)'
                        : k === 'azure'
                          ? 'Azure 语音识别'
                          : k === 'tencent'
                            ? '腾讯云 ASR'
                            : k === 'baidu'
                              ? '百度语音识别'
                              : k === 'xfyun'
                                ? '讯飞语音识别'
                                : '不使用（仅文字聊天）'}
                    </option>
                  ))}
                </TSelect>
              </Field>
              {s.stt.type === 'openai' && (
                <>
                  <Field label={t('stt.apiUrl')}>
                    <TInput value={s.stt.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => set('stt', { baseUrl: e.target.value })} />
                  </Field>
                  <Field label={t('stt.apiKey')}>
                    <TInput type="password" value={s.stt.apiKey} placeholder="sk-…" onChange={(e) => set('stt', { apiKey: e.target.value })} />
                  </Field>
                  <Field label={t('stt.model')}>
                    <TInput value={s.stt.model} placeholder="whisper-1" onChange={(e) => set('stt', { model: e.target.value })} />
                  </Field>
                </>
              )}
              {s.stt.type === 'azure' && (
                <>
                  <Field label={t('stt.region')}>
                    <TInput value={s.stt.region ?? ''} placeholder="eastasia" onChange={(e) => set('stt', { region: e.target.value })} />
                  </Field>
                  <Field label={t('stt.key')}>
                    <TInput type="password" value={s.stt.apiKey} placeholder="Azure Speech Key" onChange={(e) => set('stt', { apiKey: e.target.value })} />
                  </Field>
                </>
              )}
              {s.stt.type === 'tencent' && (
                <>
                  <Field label={t('stt.tencentSecretId')}>
                    <TInput type="password" value={s.stt.tencentSecretId ?? ''} placeholder="SecretId: AKID…" onChange={(e) => set('stt', { tencentSecretId: e.target.value })} />
                  </Field>
                  <Field label={t('stt.tencentSecretKey')}>
                    <TInput type="password" value={s.stt.tencentSecretKey ?? ''} placeholder="SecretKey" onChange={(e) => set('stt', { tencentSecretKey: e.target.value })} />
                  </Field>
                  <Field label={t('stt.tencentEngine')}>
                    <TInput value={s.stt.tencentEngine ?? '16k_zh'} placeholder="16k_zh / 16k_zh-PY / 16k_en" onChange={(e) => set('stt', { tencentEngine: e.target.value })} />
                  </Field>
                </>
              )}
              {s.stt.type === 'baidu' && (
                <>
                  <Field label={t('stt.baiduApiKey')}>
                    <TInput type="password" value={s.stt.baiduApiKey ?? ''} placeholder="API Key" onChange={(e) => set('stt', { baiduApiKey: e.target.value })} />
                  </Field>
                  <Field label={t('stt.baiduSecretKey')}>
                    <TInput type="password" value={s.stt.baiduSecretKey ?? ''} placeholder="Secret Key" onChange={(e) => set('stt', { baiduSecretKey: e.target.value })} />
                  </Field>
                </>
              )}
              {s.stt.type === 'xfyun' && (
                <>
                  <Field label={t('stt.xfyunAppId')}>
                    <TInput type="password" value={s.stt.xfyunAppId ?? ''} placeholder="APPID" onChange={(e) => set('stt', { xfyunAppId: e.target.value })} />
                  </Field>
                  <Field label={t('stt.xfyunApiKey')}>
                    <TInput type="password" value={s.stt.xfyunApiKey ?? ''} placeholder="APIKey" onChange={(e) => set('stt', { xfyunApiKey: e.target.value })} />
                  </Field>
                  <Field label={t('stt.xfyunApiSecret')}>
                    <TInput type="password" value={s.stt.xfyunApiSecret ?? ''} placeholder="APISecret" onChange={(e) => set('stt', { xfyunApiSecret: e.target.value })} />
                  </Field>
                  <Field label={t('stt.xfyunLanguage')}>
                    <TInput value={s.stt.xfyunLanguage ?? 'zh_cn'} placeholder="zh_cn / en_us" onChange={(e) => set('stt', { xfyunLanguage: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label={t('stt.language')}>
                <TInput value={s.stt.language} placeholder="zh / en / 留空" onChange={(e) => set('stt', { language: e.target.value })} />
              </Field>
            </Section>
          )}

          {tab === 'tts' && (
            <Section title={t('tts.title')} hint={t('tts.hint')}>
              <Field label={t('tts.type')}>
                <TSelect value={s.tts.type} onChange={(e) => set('tts', { type: e.target.value as SessionConfig['tts']['type'] })}>
                  {ttsKinds.map((k) => (
                    <option key={k} value={k}>
                      {k === 'edge'
                        ? 'Edge TTS（免费，无需密钥）'
                        : k === 'openai'
                          ? 'OpenAI 兼容 TTS'
                          : k === 'azure'
                            ? 'Azure 语音合成'
                            : k === 'custom'
                              ? '自定义 HTTP TTS（本地模型）'
                              : '不使用'}
                    </option>
                  ))}
                </TSelect>
              </Field>
              {s.tts.type === 'openai' && (
                <>
                  <Field label={t('stt.apiUrl')}>
                    <TInput value={s.tts.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => set('tts', { baseUrl: e.target.value })} />
                  </Field>
                  <Field label={t('stt.apiKey')}>
                    <TInput type="password" value={s.tts.apiKey} placeholder="sk-…" onChange={(e) => set('tts', { apiKey: e.target.value })} />
                  </Field>
                  <Field label={t('stt.model')}>
                    <TInput value={s.tts.model} placeholder="tts-1" onChange={(e) => set('tts', { model: e.target.value })} />
                  </Field>
                </>
              )}
              {s.tts.type === 'azure' && (
                <>
                  <Field label={t('stt.region')}>
                    <TInput value={s.tts.region ?? ''} placeholder="eastasia" onChange={(e) => set('tts', { region: e.target.value })} />
                  </Field>
                  <Field label={t('stt.key')}>
                    <TInput type="password" value={s.tts.apiKey} placeholder="Azure Speech Key" onChange={(e) => set('tts', { apiKey: e.target.value })} />
                  </Field>
                </>
              )}
              {s.tts.type === 'custom' && (
                <>
                  <div className="section-hint">{t('tts.customNote')}</div>
                  <Field label={`${t('tts.customTemplate')}（${t('tts.customTemplateHint')}）`}>
                    <TSelect
                      value=""
                      onChange={(e) => {
                        const tpl = CUSTOM_TTS_TEMPLATES.find((x) => x.id === e.target.value);
                        if (!tpl) return;
                        set('tts', { baseUrl: tpl.url, customMethod: tpl.method, customBody: tpl.body });
                      }}
                    >
                      <option value="">{t('tts.chooseModel')}</option>
                      {CUSTOM_TTS_TEMPLATES.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </TSelect>
                  </Field>
                  <Field label={t('tts.customUrl')}>
                    <TInput value={s.tts.baseUrl} placeholder="http://127.0.0.1:3000/synthesize" onChange={(e) => set('tts', { baseUrl: e.target.value })} />
                  </Field>
                  <Field label={t('tts.customMethod')}>
                    <TSelect value={s.tts.customMethod ?? 'POST'} onChange={(e) => set('tts', { customMethod: e.target.value as 'GET' | 'POST' })}>
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </TSelect>
                  </Field>
                  <Field label={t('tts.customBody')}>
                    <textarea
                      className="t-input t-textarea"
                      rows={3}
                      value={s.tts.customBody ?? ''}
                      placeholder={t('tts.customBodyExample')}
                      onChange={(e) => set('tts', { customBody: e.target.value })}
                    />
                  </Field>
                  <Field label={t('llm.apiKey')}>
                    <TInput type="password" value={s.tts.apiKey} placeholder={t('tts.customKeyHint')} onChange={(e) => set('tts', { apiKey: e.target.value })} />
                  </Field>
                </>
              )}
              <Field label={t('tts.language')}>
                <TSelect
                  value={LANG_OPTIONS.includes(s.tts.language) ? s.tts.language : 'zh-CN'}
                  onChange={(e) => {
                    const lang = e.target.value;
                    const oldDefault = LANG_VOICES[s.tts.language] ?? '';
                    // 仅当音色还是旧语言默认音色时，跟随语言切换默认音色
                    const newVoice = s.tts.voice === oldDefault || !oldDefault ? LANG_VOICES[lang] ?? s.tts.voice : s.tts.voice;
                    set('tts', { language: lang, voice: newVoice });
                  }}
                >
                  {LANG_OPTIONS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </TSelect>
              </Field>
              <Field label={t('tts.voice')}>
                <TInput
                  value={s.tts.voice}
                  placeholder="zh-CN-XiaoxiaoNeural / alloy / en-US-AriaNeural"
                  onChange={(e) => set('tts', { voice: e.target.value })}
                />
              </Field>
              <Field label={`${t('tts.rate')} ${s.tts.rate > 0 ? '+' : ''}${s.tts.rate}%`}>
                <input
                  className="t-range"
                  type="range"
                  min={-50}
                  max={50}
                  step={5}
                  value={s.tts.rate}
                  onChange={(e) => set('tts', { rate: Number(e.target.value) })}
                />
              </Field>
              <Field label={`${t('tts.readText')}（${t('tts.readTextHint')}）`}>
                <label className={`toggle ${s.tts.readText ? 'on' : 'off'}`}>
                  <input
                    type="checkbox"
                    checked={s.tts.readText}
                    onChange={(e) => set('tts', { readText: e.target.checked })}
                  />
                  <span className="toggle-track" />
                  <span className="toggle-label">{s.tts.readText ? t('plugins.on') : t('plugins.off')}</span>
                </label>
              </Field>
            </Section>
          )}

          {tab === 'vad' && (
            <Section title={t('vad.title')}>
              <Field label={`${t('vad.threshold')}：${rmsToDb(s.vad.threshold).toFixed(0)} dB`}>
                <input
                  className="t-range"
                  type="range"
                  min={-50}
                  max={-20}
                  step={1}
                  value={rmsToDb(s.vad.threshold)}
                  onChange={(e) => set('vad', { threshold: dbToRms(Number(e.target.value)) })}
                />
                <div className="range-labels">
                  <span>{t('vad.sensitive')}（-50dB）</span>
                  <span>{t('vad.strict')}（-20dB）</span>
                </div>
                <div className="section-hint" style={{ marginTop: 4 }}>
                  {t('vad.thresholdHint')}
                </div>
              </Field>
              <Field label={`${t('vad.silence')} ${s.vad.silenceMs}`}>
                <input
                  className="t-range"
                  type="range"
                  min={300}
                  max={1500}
                  step={50}
                  value={s.vad.silenceMs}
                  onChange={(e) => set('vad', { silenceMs: Number(e.target.value) })}
                />
              </Field>
              <Field label={`${t('vad.max')} ${s.vad.maxSpeechMs / 1000}`}>
                <input
                  className="t-range"
                  type="range"
                  min={5}
                  max={60}
                  step={1}
                  value={s.vad.maxSpeechMs / 1000}
                  onChange={(e) => set('vad', { maxSpeechMs: Number(e.target.value) * 1000 })}
                />
              </Field>
            </Section>
          )}

          {tab === 'persona' && (
            <Section title={t('tab.persona')} hint={t('persona.hint')}>
              <div className="persona-row">
                <TSelect
                  value={isNew ? '' : editId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
                    setIsNew(false);
                    setEditId(id);
                    const p = personaList.find((x) => x.id === id);
                    if (p) setForm(p);
                    setPersonaMsg(null);
                  }}
                >
                  {isNew && <option value="">{t('persona.new')}…</option>}
                  {personaList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === 'assistant' ? ` (${t('persona.builtin')})` : ''}
                    </option>
                  ))}
                </TSelect>
                <button className="btn" onClick={startNewPersona}>
                  <Plus size={14} /> {t('persona.new')}
                </button>
              </div>

              {personaList.length === 0 && !isNew ? (
                <div className="persona-empty">{t('persona.empty')}</div>
              ) : (
                <>
                  <Field label={t('persona.name')}>
                    <TInput value={form.name ?? ''} placeholder={t('persona.name')} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                  </Field>
                  <Field label={t('persona.desc')}>
                    <TInput value={form.description ?? ''} placeholder={t('persona.desc')} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                  </Field>
                  <Field label={t('persona.prompt')}>
                    <textarea
                      className="t-input t-textarea"
                      rows={6}
                      value={form.systemPrompt ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                    />
                  </Field>
                  <Field label={t('persona.language')}>
                    <TSelect
                      value={form.language ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, language: e.target.value || undefined }))}
                    >
                      <option value="">{t('persona.choose')}…</option>
                      {LANG_OPTIONS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </TSelect>
                  </Field>
                  <Field label={t('persona.voice')}>
                    <TInput value={form.voice ?? ''} placeholder="zh-CN-XiaoxiaoNeural" onChange={(e) => setForm((f) => ({ ...f, voice: e.target.value }))} />
                  </Field>
                  <Field label={`${t('persona.temperature')} ${(form.temperature ?? 0.7).toFixed(1)}`}>
                    <input
                      className="t-range"
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.1}
                      value={form.temperature ?? 0.7}
                      onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) }))}
                    />
                  </Field>
                  <Field label={t('persona.greeting')}>
                    <TInput value={form.greeting ?? ''} placeholder={t('persona.greeting')} onChange={(e) => setForm((f) => ({ ...f, greeting: e.target.value }))} />
                  </Field>

                  {personaMsg && <div className={`test-result ${personaMsg.startsWith('❌') ? 'fail' : 'ok'}`}>{personaMsg}</div>}

                  <div className="persona-actions">
                    <button className="btn primary" disabled={savingPersona} onClick={() => void savePersona()}>
                      {savingPersona ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t('persona.save')}
                    </button>
                    {!isNew && editId !== 'assistant' && (
                      <button className="btn danger" onClick={() => void removePersona()}>
                        <Trash2 size={14} /> {t('persona.delete')}
                      </button>
                    )}
                  </div>
                </>
              )}
            </Section>
          )}

          {tab === 'plugins' && (
            <Section title={t('tab.plugins')} hint={t('plugins.hint')}>
              <div className="test-row" style={{ marginBottom: 8 }}>
                <button
                  className="btn"
                  disabled={reloadingPlugins}
                  onClick={() => {
                    setReloadingPlugins(true);
                    setPluginReloadMsg(null);
                    void reloadPlugins().then((r) => {
                      setPluginReloadMsg(r.ok ? `✅ ${r.message ?? '重载成功'}` : `❌ ${r.message ?? '重载失败'}`);
                      setReloadingPlugins(false);
                      if (r.ok) onPersonasChanged();
                    });
                  }}
                >
                  {reloadingPlugins ? <Loader2 size={14} className="spin" /> : null} {t('plugins.reload')}
                </button>
              </div>
              {pluginReloadMsg && (
                <div className={`test-result ${pluginReloadMsg.startsWith('✅') ? 'ok' : 'fail'}`}>{pluginReloadMsg}</div>
              )}
              {plugins.length === 0 && <div className="persona-empty">{t('plugins.none')}</div>}
              {plugins.map((p) => {
                const disabled = disabledPlugins.includes(p.name);
                return (
                  <div key={p.name} className="plugin-item">
                    <div className="plugin-main">
                      <div className="plugin-name">
                        {p.name}
                        {p.version ? <span className="plugin-ver">v{p.version}</span> : null}
                      </div>
                      {p.description && <div className="plugin-desc">{p.description}</div>}
                      {p.tools && p.tools.length > 0 && (
                        <div className="plugin-tools">
                          <span className="plugin-tools-label">{t('plugins.tools')}:</span>
                          {p.tools.map((tool) => (
                            <span key={tool} className="tool-tag">
                              {tool}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <label className={`toggle ${disabled ? 'off' : 'on'}`}>
                      <input
                        type="checkbox"
                        checked={!disabled}
                        onChange={(e) => {
                          const on = e.target.checked;
                          onDisabledPluginsChange(
                            on
                              ? disabledPlugins.filter((n) => n !== p.name)
                              : [...disabledPlugins, p.name],
                          );
                        }}
                      />
                      <span className="toggle-track" />
                      <span className="toggle-label">{disabled ? t('plugins.off') : t('plugins.on')}</span>
                    </label>
                  </div>
                );
              })}
            </Section>
          )}
        </div>

        <div className="drawer-foot">
          <button
            className="btn ghost"
            onClick={() => {
              setS(cloneSettings(DEFAULT_SETTINGS));
              resetSettings();
            }}
          >
            <RotateCcw size={14} /> {t('footer.reset')}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              onSave(s);
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 2500);
            }}
          >
            <Save size={14} /> {t('footer.save')}
          </button>
          {savedFlash && <span className="saved-flash">{t('settingsSaved')}</span>}
        </div>
      </div>
    </div>
  );
}
