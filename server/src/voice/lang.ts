/** 语言检测与匹配工具：用于“输出语言不符合人设/TTS 要求时自动翻译” */

/** 粗粒度检测文本主语言，返回语言族代码：zh / en / ja / ko / 其他 */
export function detectLanguage(text: string): string {
  if (!text) return 'en';
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) ?? []).length;
  const hangul = (text.match(/[\uac00-\ud7af]/g) ?? []).length;
  const meaningful = text.replace(/\s/g, '').length || 1;
  if (kana / meaningful > 0.25) return 'ja';
  if (hangul / meaningful > 0.25) return 'ko';
  if (cjk / meaningful > 0.3) return 'zh';
  return 'en';
}

/** 两个语言代码是否属于同一语言族（如 zh-CN 与 zh-TW 视为相同） */
export function isSameLanguage(a: string, b: string): boolean {
  return a.split('-')[0].toLowerCase() === b.split('-')[0].toLowerCase();
}

/** 语言代码 → 人类可读名称（用于翻译提示词） */
export function languageDisplayName(lang: string): string {
  const map: Record<string, string> = {
    zh: '简体中文',
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
    en: 'English',
    'en-US': 'English (US)',
    'en-GB': 'English (UK)',
    ja: '日本語',
    'ja-JP': '日本語',
    ko: '한국어',
    'ko-KR': '한국어',
    fr: 'français',
    de: 'Deutsch',
    es: 'español',
    ru: 'русский',
    it: 'italiano',
    pt: 'português',
    ar: 'العربية',
    th: 'ไทย',
    vi: 'Tiếng Việt',
    id: 'Bahasa Indonesia',
  };
  return map[lang] ?? lang;
}
