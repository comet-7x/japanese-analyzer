import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSentenceTranslation } from '../app/hooks/useSentenceTranslation';
import type { TranslationServiceSettings } from '../app/lib/translationServices';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const settings: TranslationServiceSettings = {
  preferredProvider: 'google', google: { apiKey: 'google-key' }, baidu: { appId: '', secret: '' },
};
const reviewEndpoint = { baseUrl: 'https://model.example/v1', model: 'reviewer' };

async function main() {
  const originalFetch = globalThis.fetch;
  const pending: Array<{ url: string; body: Record<string, unknown>; headers: Headers; resolve: (response: Response) => void }> = [];
  let renderer: ReactTestRenderer | undefined;
  let translation!: ReturnType<typeof useSentenceTranslation>;
  function Harness() {
    translation = useSentenceTranslation({
      text: '猫が寝る。', endpoint: reviewEndpoint, apiKey: 'model-key',
      locale: 'zh-TW', useStream: false, provider: 'google', settings,
    });
    return null;
  }
  try {
    globalThis.fetch = async (input, init) => new Promise<Response>(resolve => pending.push({
      url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), resolve,
    }));
    await act(async () => { renderer = create(<Harness />); });
    assert.equal(pending.length, 0, 'Machine translation stays user-triggered');
    await act(async () => { void translation.translate(); });
    assert.equal(pending[0].url, '/api/machine-translate');
    assert.equal(pending[0].headers.get('X-App-Locale'), 'zh-TW');
    assert.equal(pending[0].headers.get('X-Translation-Api-Key'), 'google-key');
    await act(async () => { pending[0].resolve(Response.json({ provider: 'google', translation: '貓睡著。' })); await tick(); });
    assert.equal(translation.translation, '貓睡著。');
    assert.equal(translation.displayedTranslation, '貓睡著。');

    await act(async () => { void translation.reviewTranslation(); });
    assert.equal(pending[1].url, '/api/translate/review');
    assert.equal(pending[1].headers.get('Authorization'), 'Bearer model-key');
    assert.equal(pending[1].body.draft, '貓睡著。');
    await act(async () => { pending[1].resolve(Response.json({ translation: '貓在睡覺。', summary: '修正時態。' })); await tick(); });
    assert.equal(translation.translation, '貓睡著。', 'Model review must not overwrite the machine translation');
    assert.equal(translation.displayedTranslation, '貓在睡覺。');
    await act(async () => { translation.setShowReview(false); });
    assert.equal(translation.displayedTranslation, '貓睡著。');
    console.log('Translation flow passed: machine translation is explicit and raw/reviewed versions remain independently selectable.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
