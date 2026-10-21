import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import DailySentence from '../app/components/DailySentence';
import { LanguageProvider, useLanguage } from '../app/contexts/LanguageContext';
import { getJstDateKey } from '../app/utils/dailySentences';
import { DAILY_POOL_KEY } from '../app/services/dailySentenceClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function main() {
  const originalFetch = globalThis.fetch;
  const OriginalDate = Date;
  const originalTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const globals = new Map(['window', 'document', 'navigator', 'localStorage', 'React'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let now = OriginalDate.parse('2026-09-24T12:00:00Z');
  globalThis.Date = class extends OriginalDate {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  } as DateConstructor;
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; ms: number }>();
  globalThis.setTimeout = ((callback: () => void, ms: number) => { timers.set(++timerId, { callback, ms }); return timerId; }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  const values = new Map<string, string>();
  let writesBlocked = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (writesBlocked) throw Error('quota exceeded'); values.set(key, value); } };
  const resetValues = () => {
    values.clear();
  };
  const listeners = new Map<string, Set<() => void>>();
  const events = {
    addEventListener(name: string, callback: () => void) { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
    removeEventListener(name: string, callback: () => void) { listeners.get(name)?.delete(callback); },
  };
  const emit = async (name: string) => act(async () => { for (const callback of listeners.get(name) ?? []) callback(); await tick(); });
  const navigatorMock = { onLine: true };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { ...events, localStorage: storage } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { ...events, documentElement: {}, title: '', querySelector: () => null } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorMock });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw Error('Daily presets must never request an API'); };
  let renderer: ReactTestRenderer | undefined;
  let language!: ReturnType<typeof useLanguage>;
  let analyzed = '';
  function Harness() { language = useLanguage(); return <DailySentence onAnalyze={text => { analyzed = text; }} />; }
  const mount = async () => { await act(async () => { renderer = create(<LanguageProvider><Harness /></LanguageProvider>); }); };
  const unmount = async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; };
  const button = () => renderer!.root.findByProps({ className: 'daily-sentence' });
  const refresh = () => renderer!.root.findByProps({ className: 'daily-refresh' });
  const text = () => button().props['aria-label'] as string;
  try {
    navigatorMock.onLine = false;
    await mount();
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1, 'Fresh offline installs always have readings');
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-translation' }).length, 1, 'Fresh offline installs always have the current locale translation');
    const initial = text();
    const countBefore = JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length;
    await act(async () => { const click = refresh().props.onClick; click(); click(); });
    const manual = text();
    assert.notEqual(manual, initial, 'Refresh selects another preset immediately');
    assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length, countBefore - 1, 'Duplicate callbacks in one event consume exactly one sentence');
    assert.equal(refresh().props.disabled, false);
    assert.equal(analyzed, '', 'Refreshing never invokes analysis');
    await act(async () => { refresh().props.onClick(); });
    assert.notEqual(text(), manual, 'A subsequent click selects exactly one more preset');
    await act(async () => { button().props.onClick(); });
    assert.equal(analyzed, button().props['aria-label'].split('：').at(-1));
    const heading = renderer!.root.findByProps({ className: 'daily-label daily-analyze' });
    assert.equal(heading.findAllByProps({ className: 'daily-go' }).length, 1, 'The heading keeps its arrow animation');
    await act(async () => { language.setLocale('en'); });
    const savedEnglish = text();
    await unmount(); await mount();
    assert.equal(text(), savedEnglish, 'Restoring the saved locale happens before selection');
    const original = text().split('：').at(-1);
    for (const locale of ['zh-CN', 'zh-TW', 'ko', 'en'] as const) {
      await act(async () => { language.setLocale(locale); });
      assert.equal(text().split('：').at(-1), original, 'Locale changes keep the same four-language example');
      assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1);
      assert.equal(renderer!.root.findAllByProps({ className: 'daily-translation' }).length, 1);
      assert.equal(renderer!.root.findAllByType('a').length, 0, 'Preset cards have no source or license links');
    }
    assert.equal(JSON.stringify(renderer!.toJSON()).includes('项目补充译文'), false);
    navigatorMock.onLine = true;
    const beforeFocus = text();
    await emit('online'); await emit('focus'); await emit('visibilitychange');
    assert.equal(text(), beforeFocus, 'Reconnection and focus do not replace the current sentence');
    assert.equal(listeners.get('online')?.size ?? 0, 0, 'No online refill listener remains');
    assert.equal(fetchCalls, 0, 'Mounting, selecting, reloading and language/connectivity changes make no requests');

    const oldDate = getJstDateKey();
    now = OriginalDate.parse('2026-09-24T15:01:00Z');
    await emit('focus');
    assert.notEqual(getJstDateKey(), oldDate);
    assert.notEqual(text(), beforeFocus, 'Crossing Japanese midnight selects a new daily preset');
    const nextDay = text();
    await emit('focus');
    assert.equal(text(), nextDay, 'Repeated focus preserves the new day selection');
    await unmount(); await mount();
    assert.equal(text(), nextDay, 'The new day choice survives reload');
    now = OriginalDate.parse('2026-09-25T15:01:00Z');
    const midnight = [...timers.values()][0];
    await act(async () => { midnight.callback(); await tick(); });
    assert.notEqual(text(), nextDay, 'The midnight timer advances the sentence without a network request');
    await unmount();

    resetValues(); writesBlocked = true;
    await mount();
    const blockedInitial = text();
    await act(async () => { refresh().props.onClick(); });
    const blockedChoice = text();
    assert.notEqual(blockedChoice, blockedInitial);
    await act(async () => { language.setLocale('en'); });
    assert.equal(text().split('：').at(-1), blockedChoice.split('：').at(-1), 'Blocked persistence retains the in-memory current choice during locale changes');
    await act(async () => { refresh().props.onClick(); });
    assert.notEqual(text(), blockedChoice, 'Blocked persistence cannot reuse the consumed choice');
    writesBlocked = false;
    await act(async () => { refresh().props.onClick(); });
    const final = text();
    await unmount(); await mount();
    assert.equal(text().split('：').at(-1), final.split('：').at(-1), 'Restored writes persist the final choice');
    await unmount();
    assert.equal(fetchCalls, 0, 'Daily sentence behavior is entirely local');
    assert.equal(listeners.get('focus')?.size ?? 0, 0);
    assert.equal(listeners.get('visibilitychange')?.size ?? 0, 0);
    assert.equal(timers.size, 0);
    console.log('Daily sentence UI passed: zero requests, immediate refresh, duplicate clicks, four locales, persisted choices, midnight, blocked storage and cleanup.');

  } finally {
    await unmount();
    globalThis.fetch = originalFetch;
    globalThis.Date = OriginalDate;
    globalThis.setTimeout = originalTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
