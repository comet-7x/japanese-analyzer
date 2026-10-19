import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import TranslationSection from '../app/components/TranslationSection';
import type { TranslationProviderId } from '../app/lib/translationServices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function main() {
  const globals = new Map(['React', 'window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true, addListener() {}, removeListener() {} }) } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  const endpoint = { baseUrl: 'https://translation-ui.example/v1', model: 'test-model' };
  const pending: Array<{ url: string; body: Record<string, unknown>; resolve: (response: Response) => void }> = [];
  globalThis.fetch = async (input, init) => new Promise<Response>(resolve => pending.push({ url: String(input), body: JSON.parse(String(init?.body)), resolve }));
  let renderer: ReactTestRenderer | undefined;
  const view = (provider: TranslationProviderId = 'mymemory', analysisReady = false) => <LanguageProvider><TranslationSection
    japaneseText="猫が寝ています。" endpoint={endpoint} userApiKey="test" useStream={false} trigger={1} analysisReady={analysisReady}
    settings={{ preferredProvider: provider, activeId: 'mm-custom', services: [{ id: 'mm-custom', name: 'MyMemory', provider: 'mymemory' }] }} onProviderChange={() => {}}
  /></LanguageProvider>;
  const reply = async (index: number, value: unknown) => act(async () => { pending[index].resolve(Response.json(value)); await tick(); });
  const reviewButton = () => renderer!.root.findByProps({ className: 'nd-ghost-btn translation-review-button' });
  try {
    await act(async () => { renderer = create(view('mm-custom')); });
    assert.equal(pending[0].url, '/api/machine-translate', 'Machine translation starts while analysis is still pending, including custom service IDs');
    await reply(0, { provider: 'mymemory', translation: '猫正在睡觉。' });
    assert.equal(reviewButton().props['data-review-state'], 'initial');
    const initialIcon = JSON.stringify(reviewButton().findByType('svg').props.children);
    await act(async () => { void reviewButton().props.onClick(); });
    assert.equal(pending[1].url, '/api/translate/review');
    assert.equal(reviewButton().props.disabled, true);
    assert.equal(reviewButton().props['aria-busy'], true);
    assert.equal(reviewButton().props['data-review-state'], 'loading');
    assert.equal(reviewButton().findAll(node => typeof node.props.className === 'string' && node.props.className.includes('batch-sparkle ')).length, 3);
    assert.equal(renderer!.root.findByProps({ id: 'fullTranslationCard' }).props['data-reviewing'], true, 'Review actions remain visible during generation');
    await reply(1, { translation: '猫咪正在睡觉。', summary: '表达更自然。' });
    assert.equal(reviewButton().props['data-review-state'], 'retry');
    assert.equal(reviewButton().props['aria-busy'], false);
    assert.notEqual(JSON.stringify(reviewButton().findByType('svg').props.children), initialIcon, 'First review and re-review have distinct symbols');
    await act(async () => { void reviewButton().props.onClick(); });
    assert.equal(pending.length, 3, 'Re-review generates a fresh result');
    assert.equal(reviewButton().props['data-review-state'], 'loading');
    await reply(2, { translation: '猫咪睡得很香。', summary: '第二版。' });
    await act(async () => { renderer!.update(view('mm-custom', true)); });
    assert.equal(pending.length, 3, 'Completing analysis cannot issue the machine translation again');
    await act(async () => { renderer!.update(view('model')); });
    assert.equal(pending.length, 3, 'Current-model translation still waits for completed analysis');
    await act(async () => { renderer!.update(view('model', true)); });
    assert.equal(pending[3].url, '/api/translate');
    await reply(3, { choices: [{ finish_reason: 'stop', message: { content: '模型译文。' } }] });
    console.log('Translation UI passed: parallel machine translation, model readiness, distinct review/re-review icons and busy animation.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of globals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
