import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider, useLanguage } from '../app/contexts/LanguageContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const globals = new Map(['React', 'window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const values = new Map<string, string>();
const cookies = new Map<string, string>();
let blocked = false;
const storage = { getItem: (key: string) => { if (blocked) throw Error('blocked'); return values.get(key) ?? null; }, setItem: (key: string, value: string) => { if (blocked) throw Error('blocked'); values.set(key, value); } };
const navigator = { languages: ['en-US'], language: 'en-US' };
const listeners = new Map<string, Set<(event: unknown) => void>>();
const documentMock = {
  documentElement: { lang: 'zh-CN' }, title: '', querySelector: () => null,
  get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
  set cookie(value: string) { const [name, content] = value.split(';')[0].split('='); cookies.set(name, content); },
};
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { navigator, localStorage: storage,
  addEventListener: (name: string, callback: (event: unknown) => void) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
  removeEventListener: (name: string, callback: (event: unknown) => void) => { listeners.get(name)?.delete(callback); },
} });
let language!: ReturnType<typeof useLanguage>;
let renderer: ReactTestRenderer | undefined;
function Harness() { language = useLanguage(); return null; }
async function mount() { await act(async () => { renderer = create(<LanguageProvider><Harness /></LanguageProvider>); }); }
async function unmount() { await act(async () => { renderer?.unmount(); }); renderer = undefined; }
async function emit(name: string, event = {}) { await act(async () => { for (const callback of listeners.get(name) ?? []) callback(event); }); }
async function main() {
  try {
    await mount();
    assert.equal(language.locale, 'en');
    assert.equal(language.preference, 'system');
    assert.equal(documentMock.documentElement.lang, 'en');
    assert.equal(cookies.get('ja_ui_language'), 'system', 'automatic matching must never become a manual choice');
    assert.equal(values.has('language'), false);
    await act(async () => { language.setLocale('zh-TW'); });
    assert.equal(values.get('language'), 'zh-TW');
    navigator.languages = ['ko-KR'];
    await emit('languagechange');
    assert.equal(language.locale, 'zh-TW', 'OS changes do not overwrite a manual language');
    assert.equal(language.systemLocale, 'ko');
    await act(async () => { language.setLocale('system'); });
    assert.equal(language.locale, 'ko');
    assert.equal(values.get('language'), 'system');
    navigator.languages = ['en-GB'];
    await emit('languagechange');
    assert.equal(language.locale, 'en');
    await unmount();

    cookies.set('ja_system_language', 'zh-TW');
    await mount();
    assert.equal(language.locale, 'zh-TW', 'desktop homepage uses the native OS result shared by the launcher');
    await unmount();
    values.set('language', 'ko');
    await mount();
    assert.equal(language.locale, 'ko', 'legacy saved language remains manual');
    await emit('storage', { key: 'language', newValue: 'system' });
    assert.equal(language.locale, 'zh-TW', 'system mode syncs across tabs');
    await emit('storage', { key: null, newValue: null });
    assert.equal(language.preference, 'system');
    await unmount();

    cookies.clear(); blocked = true;
    await mount();
    assert.equal(language.locale, 'en', 'blocked storage falls back to the OS/browser languages');
    await act(async () => { language.setLocale('zh-CN'); });
    assert.equal(language.locale, 'zh-CN', 'manual selection works for the current session when storage is blocked');
    assert.equal(language.localeReady, true);
    await unmount();
    assert.equal([...listeners.values()].reduce((count, callbacks) => count + callbacks.size, 0), 0);
    console.log('System language, manual override, legacy migration, native handoff and storage failure passed');
  } finally {
    await unmount();
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
}
void main();
