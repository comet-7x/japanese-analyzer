'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createTranslator, formatUserFacingError, DEFAULT_LOCALE, LANGUAGE_STORAGE_KEY, normalizeLocale, type Locale, type Translator } from '../i18n';

import { matchSystemLocale, normalizeLanguagePreference } from '../../src-tauri/tauri-ui/locale.mjs';

type LanguagePreference = Locale | 'system';

function browserSystemLocale(): Locale {
  const browser = typeof window !== 'undefined' ? window.navigator : undefined;
  return normalizeLocale(matchSystemLocale(browser?.languages?.length ? [...browser.languages] : browser?.language ? [browser.language] : []));
}

function initialSystemLocale(): Locale {
  // The desktop launcher writes its native OS result before entering this origin.
  const native = typeof document !== 'undefined' ? /(?:^|;\s*)ja_system_language=([^;]*)/.exec(document.cookie ?? '')?.[1] : undefined;
  return native && ['zh-CN', 'zh-TW', 'en', 'ko'].includes(native) ? normalizeLocale(native) : browserSystemLocale();
}

const LanguageContext = createContext<{ locale: Locale; localeReady: boolean; preference: LanguagePreference; systemLocale: Locale; setLocale: (locale: LanguagePreference) => void; t: Translator; errorText: (message: string, fallback?: string) => string } | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [localeReady, setLocaleReady] = useState(false);
  const [preference, updatePreference] = useState<LanguagePreference>('system');
  const [systemLocale, updateSystemLocale] = useState<Locale>(DEFAULT_LOCALE);
  const preferenceRef = useRef<LanguagePreference>('system');
  const systemRef = useRef<Locale>(DEFAULT_LOCALE);
  const applyLocale = useCallback((value: Locale) => {
    document.documentElement.lang = value;
    const t = createTranslator(value);
    document.title = t('日本語文章解析器 - AI驱动');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('AI驱动・深入理解日语句子结构与词义'));
    updateLocale(value);
  }, []);

  const applyPreference = useCallback((value: LanguagePreference) => {
    preferenceRef.current = value;
    updatePreference(value);
    // Persist the choice (including system mode), never its resolved language.
    try { document.cookie = `ja_ui_language=${value}; Path=/; Max-Age=31536000; SameSite=Lax`; } catch {}
    applyLocale(value === 'system' ? systemRef.current : value);
  }, [applyLocale]);

  useEffect(() => {
    systemRef.current = initialSystemLocale();
    updateSystemLocale(systemRef.current);
    try { applyPreference(normalizeLanguagePreference(localStorage.getItem(LANGUAGE_STORAGE_KEY)) as LanguagePreference); }
    catch { applyPreference('system'); }
    setLocaleReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) applyPreference(normalizeLanguagePreference(event.newValue) as LanguagePreference);
    };
    const onLanguageChange = () => {
      systemRef.current = browserSystemLocale();
      updateSystemLocale(systemRef.current);
      if (preferenceRef.current === 'system') applyLocale(systemRef.current);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('languagechange', onLanguageChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('languagechange', onLanguageChange);
    };
  }, [applyLocale, applyPreference]);

  const setLocale = useCallback((value: LanguagePreference) => {
    const next = normalizeLanguagePreference(value) as LanguagePreference;
    applyPreference(next);
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Session-only preference when storage is unavailable. */ }
  }, [applyPreference]);
  const value = useMemo(() => ({ locale, localeReady, preference, systemLocale, setLocale, t: createTranslator(locale), errorText: (message: string, fallback?: string) => formatUserFacingError(message, locale, fallback) }), [locale, localeReady, preference, systemLocale, setLocale]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
