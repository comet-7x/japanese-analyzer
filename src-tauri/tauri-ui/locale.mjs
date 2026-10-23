// Shared by the packaged launcher and the React application.
const supported = ['zh-CN', 'zh-TW', 'en', 'ko'];
export const normalizeLauncherLocale = value => supported.includes(value) ? value : 'zh-CN';
export const normalizeLanguagePreference = value => supported.includes(value) ? value : 'system';

export function matchSystemLocale(languages = []) {
  for (const raw of languages) {
    if (typeof raw !== 'string') continue;
    const [language, ...parts] = raw.replaceAll('_', '-').toLowerCase().split('-');
    if (language === 'en' || language === 'ko') return language;
    if (language !== 'zh') continue;
    // Script tag (Hans/Hant) takes precedence over region (e.g. zh-Hans-HK maps to zh-CN).
    if (parts.includes('hant')) return 'zh-TW';
    if (parts.includes('hans')) return 'zh-CN';
    return parts.some(part => ['tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN';
  }
  return 'zh-CN';
}

export function resolveLanguagePreference(preference, languages = []) {
  const saved = normalizeLanguagePreference(preference);
  return saved === 'system' ? matchSystemLocale(languages) : saved;
}

export async function readLauncherLocale({ readNative, readStored, languages = [] }) {
  if (readNative) {
    try {
      const value = await readNative();
      if (supported.includes(value)) return value;
    } catch { /* Native lookup failure must not prevent startup. */ }
  }
  try { return resolveLanguagePreference(readStored(), languages); }
  catch { return matchSystemLocale(languages); }
}
