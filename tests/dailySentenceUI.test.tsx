import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import DailySentence from '../app/components/DailySentence';
import { LanguageProvider, useLanguage } from '../app/contexts/LanguageContext';
import { getJstDateKey } from '../app/utils/dailySentences';
import { DAILY_POOL_KEY } from '../app/services/dailySentenceClient';
import { bundledSentencePack } from '../app/utils/bundledSentencePack';
import { parseDailySentenceCandidates } from '../app/api/_utils/dailySentence';
import { DAILY_SENTENCE_CLIENT_TIMEOUT_MS, DAILY_SENTENCE_PACK_TIMEOUT_MS } from '../app/utils/dailySentencePolicy';

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
    values.set(DAILY_POOL_KEY, JSON.stringify({ packVersion: bundledSentencePack.version, packPublishedAt: bundledSentencePack.publishedAt, candidates: [], packIds: [], history: [] }));
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
  const pending: { signal: AbortSignal; resolve: (r: Response) => void; reject: (e: Error) => void }[] = [];
  let ignoreAbort = false;
  globalThis.fetch = async (_input, init) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    pending.push({ signal, resolve, reject });
    if (!ignoreAbort) signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const onlineBatch = (date: string, id = 100, text = '今日は図書館で本を読みます。') => ({ date, sentences: parseDailySentenceCandidates({ data: [{
    id, text, lang: 'jpn', license: 'CC BY 2.0 FR', is_unapproved: false,
    translations: [{ id: 200, text: '今天在图书馆看书。', lang: 'cmn', script: 'Hans', license: 'CC BY 2.0 FR', is_direct: true, is_unapproved: false }],
  }] }, date).map(sentence => ({ ...sentence, tokens: [{ word: text, pos: '名詞', furigana: {
    '今日は図書館で本を読みます。': 'きょうはとしょかんでほんをよみます',
    '明日は友達と公園に行きます。': 'あしたはともだちとこうえんにいきます',
    '週末は家族と映画を見ます。': 'しゅうまつはかぞくとえいがをみます',
    '駅まで歩いて十分かかります。': 'えきまであるいてじゅっぷんかかります',
    '毎日少しずつ日本語を勉強しています。': 'まいにちすこしずつにほんごをべんきょうしています',
  }[text] }] })) });
  let renderer: ReactTestRenderer | undefined;
  let language!: ReturnType<typeof useLanguage>;
  let analyzed = '';
  function Harness() { language = useLanguage(); return <DailySentence onAnalyze={text => { analyzed = text; }} />; }
  const mount = async () => { await act(async () => { renderer = create(<LanguageProvider><Harness /></LanguageProvider>); }); };
  const unmount = async () => { await act(async () => { renderer?.unmount(); }); renderer = undefined; };
  const button = () => renderer!.root.findByProps({ className: 'daily-sentence' });
  const refresh = () => renderer!.root.findByProps({ className: 'daily-refresh' });
  const text = () => button().props['aria-label'] as string;
  const reply = async (index: number, value: unknown) => act(async () => { pending[index].resolve(Response.json(value)); await tick(); });
  try {
    assert.ok(DAILY_SENTENCE_CLIENT_TIMEOUT_MS > DAILY_SENTENCE_PACK_TIMEOUT_MS);
    navigatorMock.onLine = false;
    await mount();
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1, 'Fresh offline installs always have readings');
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-translation' }).length, 1, 'Fresh offline installs always have the current locale translation');
    assert.equal(pending.length, 0);
    await act(async () => { language.setLocale('en'); });
    await act(async () => { refresh().props.onClick(); });
    assert.equal(renderer!.root.findAllByType('a').length, 4, 'English users can select the annotated Tatoeba pack offline');
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1);
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-translation' }).length, 1);
    const savedEnglish = text();
    await unmount(); await mount();
    assert.equal(text(), savedEnglish, 'Restoring the saved locale happens before selection, preserving the English sentence');
    await act(async () => { language.setLocale('zh-CN'); });
    assert.equal(text().split('：').at(-1), savedEnglish.split('：').at(-1), 'Locale changes keep the same four-language example');
    assert.equal(renderer!.root.findAllByType('a').length, 3, 'Project translations do not invent a Tatoeba translation link');
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-source' })[0].findAllByType('span').some(node => node.children.includes('项目补充译文')), true);
    await unmount(); resetValues(); navigatorMock.onLine = true;
    await mount();
    const initial = text();
    assert.ok(initial.length > 6);
    assert.equal(pending.length, 1);
    assert.equal(refresh().props.disabled, false);
    const firstRequest = pending[0];
    await act(async () => { const click = refresh().props.onClick; click(); click(); });
    const manualLocal = text();
    assert.notEqual(manualLocal, initial, 'Refresh is immediate even while the first network request is stalled');
    assert.equal(pending.length, 1, 'Clicks join the existing background refill rather than creating requests');
    assert.equal(firstRequest.signal.aborted, false, 'Selecting locally does not cancel a useful background refill');
    assert.equal(refresh().props.disabled, false);
    assert.equal(analyzed, '', 'Refreshing never invokes analysis');
    const date = getJstDateKey();
    const pack = { date, sentences: [
      ...onlineBatch(date, 101).sentences,
      ...onlineBatch(date, 102, '明日は友達と公園に行きます。').sentences,
      ...onlineBatch(date, 103, '週末は家族と映画を見ます。').sentences,
      ...onlineBatch(date, 104, '駅まで歩いて十分かかります。').sentences,
      ...onlineBatch(date, 105, '毎日少しずつ日本語を勉強しています。').sentences,
    ] };
    await reply(0, pack);
    assert.equal(text(), manualLocal, 'Background completion never replaces the current sentence');
    assert.ok(values.has(DAILY_POOL_KEY));
    await act(async () => { refresh().props.onClick(); });
    const online = text();
    assert.notEqual(online, manualLocal);
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1);
    assert.equal(renderer!.root.findAllByType('a').length, 4, 'Online selections retain original and translation attribution');
    assert.equal(pending.length, 1, 'Stored candidates are consumed without another network request');
    await act(async () => { button().props.onClick(); });
    assert.equal(analyzed, button().props['aria-label'].split('：').at(-1));
    const heading = renderer!.root.findByProps({ className: 'daily-label daily-analyze' });
    assert.equal(heading.findAllByProps({ className: 'daily-go' }).length, 1);
    await unmount(); await mount();
    assert.equal(text(), online, 'Reload preserves the currently selected online sentence');
    assert.equal(pending.length, 1, 'A fresh pool suppresses fetch after reload');
    navigatorMock.onLine = false;
    await act(async () => { refresh().props.onClick(); });
    const offlineOnline = text();
    assert.notEqual(offlineOnline, online, 'Previously downloaded candidates also work offline');
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1);
    assert.equal(pending.length, 1);
    await act(async () => { language.setLocale('ko'); });
    assert.ok(!text().endsWith(offlineOnline.split('：').at(-1)!));
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-translation' }).length, 1, 'A missing locale translation triggers a complete local fallback');
    await unmount();

    // Blocked writes retain the pool and its consumed history in memory across language changes.
    resetValues(); navigatorMock.onLine = true; writesBlocked = true;
    await mount(); const blockedStart = pending.length - 1; const blockedLocal = text();
    await reply(blockedStart, pack);
    assert.equal(text(), blockedLocal);
    await act(async () => { refresh().props.onClick(); });
    const blockedOnline = text();
    assert.notEqual(blockedOnline, blockedLocal);
    await act(async () => { language.setLocale('en'); });
    assert.ok(!text().endsWith(blockedOnline.split('：').at(-1)!));
    await act(async () => { refresh().props.onClick(); });
    assert.notEqual(text(), blockedOnline, 'Unwritable storage cannot reuse the consumed online choice');
    writesBlocked = false;
    navigatorMock.onLine = false;
    for (let i = 0; i < 6; i++) await act(async () => { refresh().props.onClick(); });
    const exhaustedLocal = text();
    assert.equal(renderer!.root.findAllByProps({ className: 'daily-tokens' }).length, 1);
    await unmount(); await mount();
    assert.equal(text().split('：').at(-1), exhaustedLocal.split('：').at(-1), 'Exhausted pool persists the final local choice');
    await unmount();

    // Failures and timeouts affect only background sync, with persisted cooldown.
    resetValues(); navigatorMock.onLine = true;
    await mount(); const failureIndex = pending.length - 1; const beforeFailure = text();
    await act(async () => { pending[failureIndex].reject(Error('offline')); await tick(); });
    assert.equal(text(), beforeFailure);
    const failureCalls = pending.length;
    for (let i = 0; i < 5; i++) await act(async () => { refresh().props.onClick(); });
    assert.equal(pending.length, failureCalls, 'Repeated clicks during failure backoff never hammer the upstream');
    const chosenDuringBackoff = text();
    await emit('online'); await emit('focus');
    assert.equal(pending.length, failureCalls, 'Connectivity and focus respect the cooldown');
    await unmount(); await mount();
    assert.equal(text(), chosenDuringBackoff);
    assert.equal(pending.length, failureCalls, 'Reload cannot bypass the persisted retry delay');
    now += 15 * 60_000;
    await emit('focus');
    assert.equal(pending.length, failureCalls + 1, 'Expired backoff permits one refill');
    await reply(pending.length - 1, pack);
    assert.equal(text(), chosenDuringBackoff, 'Retry success also leaves the displayed sentence untouched');
    await unmount();

    resetValues(); await mount();
    const timed = pending.at(-1)!;
    await act(async () => { refresh().props.onClick(); });
    const beforeTimeout = text();
    const timeout = [...timers.values()].find(timer => timer.ms === DAILY_SENTENCE_CLIENT_TIMEOUT_MS)!;
    await act(async () => { timeout.callback(); await tick(); });
    assert.equal(timed.signal.aborted, true);
    assert.equal(text(), beforeTimeout, 'Background timeout cannot cause a second visible change');
    assert.equal(refresh().props.disabled, false);
    await unmount();

    // Superseded date/locale and unmounted results cannot populate the pool or change the display.
    resetValues(); ignoreAbort = true;
    await mount(); const oldIndex = pending.length - 1; const oldDate = getJstDateKey();
    now = OriginalDate.parse('2026-09-24T15:01:00Z');
    await emit('focus');
    assert.equal(pending[oldIndex].signal.aborted, true);
    const newIndex = pending.length - 1; const newLocal = text();
    assert.ok(newIndex > oldIndex);
    const savedBeforeLate = values.get(DAILY_POOL_KEY);
    await reply(oldIndex, onlineBatch(oldDate));
    assert.equal(text(), newLocal);
    assert.equal(values.get(DAILY_POOL_KEY), savedBeforeLate);
    await reply(newIndex, onlineBatch(getJstDateKey(), 700));
    assert.equal(text(), newLocal, 'A new-day batch waits for the next selection');
    await act(async () => { refresh().props.onClick(); });
    assert.match(text(), /今日は図書館で本を読みます/);
    await act(async () => { language.setLocale('ko'); });
    const localeIndex = pending.length - 1;
    await unmount();
    const savedAtUnmount = values.get(DAILY_POOL_KEY);
    await reply(localeIndex, onlineBatch(getJstDateKey(), 701));
    assert.equal(values.get(DAILY_POOL_KEY), savedAtUnmount);
    assert.equal(listeners.get('online')?.size ?? 0, 0);
    assert.equal(listeners.get('focus')?.size ?? 0, 0);
    assert.equal(timers.size, 0);
    console.log('Daily sentence UI passed: immediate selection, background-only refill, persisted pool, attribution, offline use, blocked storage, retry backoff, timeout, dates, locale changes and unmount.');

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
