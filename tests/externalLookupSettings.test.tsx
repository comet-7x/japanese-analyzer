import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import { ExternalLookupProvider } from '../app/contexts/ExternalLookupContext';
import ExternalDictionaryLookup from '../app/components/ExternalDictionaryLookup';
import DictionarySettings from '../app/components/DictionarySettings';
import {
  BUILTIN_DICTIONARY, EXTERNAL_SERVICES_KEY, ICHI_OPTIONS_KEY, DEFAULT_EXTERNAL_SERVICES,
  readExternalServicesSettings, isMultiWordLookup,
} from '../app/lib/dictionary';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const textOf = (node: ReactTestInstance | string): string => typeof node === 'string' ? node : node.children.map(textOf).join('');

async function main() {
  assert.equal(isMultiWordLookup('駅の前'), true);
  assert.equal(isMultiWordLookup('駅'), false);
  assert.equal(isMultiWordLookup('食べた', { kind: 'word', tokenCount: 1 }), false, 'Known selections override segmentation heuristics');
  assert.equal(isMultiWordLookup('駅の前', { kind: 'phrase', tokenCount: 3 }), true);
  const invalid = readExternalServicesSettings('{');
  invalid.enabled.ichi = false;
  assert.equal(DEFAULT_EXTERNAL_SERVICES.enabled.ichi, true, 'Malformed storage cannot expose mutable defaults');

  const descriptors = new Map(['window', 'document', 'localStorage', 'React'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalFetch = globalThis.fetch;
  const listeners = new Set<(event: StorageEvent) => void>();
  const values = new Map<string, string>([
    [EXTERNAL_SERVICES_KEY, '{"enabled":{"google":false}}'],
    [ICHI_OPTIONS_KEY, '{"r":"kana"}'],
  ]);
  let blocked = false;
  const storage = {
    getItem(key: string) { if (blocked) throw new Error('SecurityError'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error('QuotaExceededError'); values.set(key, value); },
  };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { if (blocked) throw new Error('SecurityError'); return storage; } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    get localStorage() { if (blocked) throw new Error('SecurityError'); return storage; },
    addEventListener(type: string, listener: (event: StorageEvent) => void) { if (type === 'storage') listeners.add(listener); },
    removeEventListener(type: string, listener: (event: StorageEvent) => void) { if (type === 'storage') listeners.delete(listener); },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  globalThis.fetch = async () => new Promise<Response>(() => {});
  let renderer: ReactTestRenderer | undefined;
  const view = (cardKey = 'first') => <LanguageProvider><ExternalLookupProvider>
    <DictionarySettings value={{ providers: [BUILTIN_DICTIONARY], activeId: 'builtin' }} onChange={() => {}} />
    <ExternalDictionaryLookup key={cardKey} word="駅の前" multiWord />
    <ExternalDictionaryLookup key="second" word="猫がいる" multiWord />
  </ExternalLookupProvider></LanguageProvider>;
  const settings = () => renderer!.root.findByType(DictionarySettings);
  const cards = () => renderer!.root.findAllByType(ExternalDictionaryLookup);
  const hasGoogle = (node: ReactTestInstance) => node.findAllByType('a').some(link => link.props.href.includes('translate.google.com'));
  const serviceCheckbox = (name: string) => settings().findAllByType('label').find(label => textOf(label) === name)!.findByType('input');
  const romanization = (node: ReactTestInstance) => node.findByProps({ 'aria-label': '罗马字格式' });
  const ichiUrl = (node: ReactTestInstance) => node.findAllByType('a').find(link => link.props.href.includes('ichi.moe'))!.props.href as string;
  const emitStorage = async (key: string | null, newValue: string | null) => {
    await act(async () => { for (const listener of listeners) listener({ key, newValue } as StorageEvent); });
  };
  try {
    await act(async () => { renderer = create(view()); });
    assert.ok(cards().every(card => !hasGoogle(card)), 'Persisted service settings load');
    assert.ok(cards().every(card => ichiUrl(card).includes('r=kana')), 'Persisted options load');
    assert.ok(cards().every(card => !new URL(ichiUrl(card)).searchParams.has('noseg')), 'Default links retain segmented dictionary definitions');

    await act(async () => { serviceCheckbox('Google 翻译').props.onChange({ target: { checked: true } }); });
    assert.ok(cards().every(hasGoogle), 'Settings update already mounted cards in the same tab');
    assert.equal(JSON.parse(values.get(EXTERNAL_SERVICES_KEY)!).enabled.google, true);
    await act(async () => { romanization(cards()[0]).props.onChange({ target: { value: 'hm' } }); });
    assert.equal(romanization(settings()).props.value, 'hm', 'Card changes update the open settings panel');
    assert.ok(cards().every(card => ichiUrl(card).includes('r=hm')), 'Card changes update sibling cards');
    assert.equal(JSON.parse(values.get(ICHI_OPTIONS_KEY)!).r, 'hm');
    await act(async () => { settings().findAllByType('label').find(label => textOf(label) === '片假名转平假名')!.findByType('input').props.onChange({ target: { checked: true } }); });
    assert.ok(cards().every(card => ichiUrl(card).includes('hira=true')), 'Shared controls preserve and apply options');

    for (const name of ['ichi.moe', 'Google 翻译', '百度翻译', 'Wiktionary', 'Jisho', 'Weblio']) {
      await act(async () => { serviceCheckbox(name).props.onChange({ target: { checked: false } }); });
    }
    assert.ok(cards().every(card => card.findAllByType('a').length === 0), 'Disabling all services hides external links');
    await act(async () => { serviceCheckbox('ichi.moe').props.onChange({ target: { checked: true } }); });
    assert.ok(cards().every(card => card.findAllByType('a').length === 1), 'Hidden cards recover without remounting');

    await emitStorage(ICHI_OPTIONS_KEY, '{"r":"ks","noseg":true}');
    assert.equal(romanization(settings()).props.value, 'ks');
    assert.ok(cards().every(card => ichiUrl(card).includes('noseg=true')), 'Cross-tab options update all consumers');
    await act(async () => { settings().findAllByType('label').find(label => textOf(label) === '不分词（仅假名）')!.findByType('input').props.onChange({ target: { checked: false } }); });
    assert.ok(cards().every(card => !new URL(ichiUrl(card)).searchParams.has('noseg')), 'Unchecking no segmentation removes the parameter on every link');
    await emitStorage(EXTERNAL_SERVICES_KEY, '{"enabled":{"google":false}}');
    assert.equal(serviceCheckbox('Google 翻译').props.checked, false, 'Cross-tab services update settings too');
    await emitStorage(null, null);
    assert.ok(cards().every(hasGoogle), 'Cross-tab clear restores default services');
    assert.equal(romanization(settings()).props.value, 'htr', 'Cross-tab clear restores default options');
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    assert.equal(listeners.size, 0, 'Subscriptions are removed on unmount');

    blocked = true;
    await act(async () => { renderer = create(view()); });
    assert.ok(cards().every(hasGoogle), 'Blocked storage renders with defaults');
    await act(async () => { serviceCheckbox('Google 翻译').props.onChange({ target: { checked: false } }); });
    await act(async () => { romanization(cards()[0]).props.onChange({ target: { value: 'text' } }); });
    await act(async () => { renderer!.update(view('remounted')); });
    assert.ok(cards().every(card => !hasGoogle(card) && ichiUrl(card).includes('r=text')), 'Session settings survive card remounts when storage is blocked');
    console.log('External lookup settings passed: persistence, same-tab sync, cross-tab updates/clear, blocked storage and remounts.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
