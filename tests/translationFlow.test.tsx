import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSentenceTranslation } from '../app/hooks/useSentenceTranslation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const reviewEndpoint = { baseUrl: 'https://model.example/v1', model: 'reviewer' };

async function main() {
  const originalFetch = globalThis.fetch;
  const pending: Array<{ url: string; body: Record<string, unknown>; headers: Headers; signal: AbortSignal; resolve: (response: Response) => void }> = [];
  let renderer: ReactTestRenderer | undefined;
  let translation!: ReturnType<typeof useSentenceTranslation>;
  const currentReview = () => translation.review;
  function Harness({ active }: { active?: boolean } = {}) {
    translation = useSentenceTranslation({
      text: '猫が寝る。', endpoint: reviewEndpoint, apiKey: 'model-key',
      locale: 'zh-TW', useStream: false, provider: 'mymemory', active,
    });
    return null;
  }
  try {
    globalThis.fetch = async (input, init) => new Promise<Response>(resolve => pending.push({
      url: String(input), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers), signal: init!.signal!, resolve,
    }));
    await act(async () => { renderer = create(<Harness />); });
    assert.equal(pending.length, 0, 'No analysis trigger means no automatic translation');
    await act(async () => { void translation.translate(); });
    assert.equal(pending[0].url, '/api/machine-translate');
    assert.equal(pending[0].headers.get('X-App-Locale'), 'zh-TW');
    assert.equal(pending[0].headers.get('X-Translation-Api-Key'), null);
    await act(async () => { pending[0].resolve(Response.json({ provider: 'mymemory', translation: '貓睡著。' })); await tick(); });
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

    // Switch to model provider and then switch back to MyMemory
    function HarnessModel() {
      translation = useSentenceTranslation({
        text: '猫が寝る。', endpoint: reviewEndpoint, apiKey: 'model-key',
        locale: 'zh-TW', useStream: false, provider: 'model',
      });
      return null;
    }
    await act(async () => { renderer!.update(<HarnessModel />); });
    assert.equal(translation.translation, '', 'Model translation is empty until translated');
    assert.equal(translation.review, null);

    // Switch back to MyMemory: both machine translation and model review should be restored from cache
    await act(async () => { renderer!.update(<Harness />); });
    assert.equal(translation.translation, '貓睡著。', 'Machine translation restored from cache');
    assert.ok(translation.review, 'Model review restored from cache');
    assert.equal(currentReview()?.translation, '貓在睡覺。');
    assert.equal(translation.displayedTranslation, '貓在睡覺。', 'Displayed translation defaults to restored review');
    assert.equal(translation.fromCache, true, 'Restored review is marked as fromCache');

    // Re-review translation with force=true should trigger API request and bypass cache
    await act(async () => { void translation.reviewTranslation(true); });
    assert.equal(pending.length, 3, 'Re-review forces new network request bypassing cache');
    assert.equal(pending[2].url, '/api/translate/review');
    await act(async () => { pending[2].resolve(Response.json({ translation: '貓正在熟睡。', summary: '重新潤色。' })); await tick(); });
    assert.equal(currentReview()?.translation, '貓正在熟睡。');
    assert.equal(translation.displayedTranslation, '貓正在熟睡。');
    assert.equal(translation.fromCache, false, 'Freshly generated review is NOT fromCache');

    // User switches to dictionary tab (active: false) and returns to sentence analysis (active: true)
    await act(async () => { renderer!.update(<Harness active={false} />); });
    await act(async () => { renderer!.update(<Harness active={true} />); });
    assert.equal(translation.fromCache, false, 'Tab visibility does not change the origin of a fresh review');

    function AutomaticHarness({ active, trigger = 1, text = '自動翻訳の確認文。' }: { active: boolean; trigger?: number; text?: string }) {
      translation = useSentenceTranslation({ text, endpoint: reviewEndpoint, locale: 'en', useStream: false, provider: 'mymemory', active, trigger });
      return null;
    }
    const beforeAuto = pending.length;
    await act(async () => { renderer!.update(<AutomaticHarness active={true} trigger={0} />); });
    assert.equal(pending.length, beforeAuto, 'Local analysis with a zero trigger never sends text');
    await act(async () => { renderer!.update(<AutomaticHarness active={false} />); });
    assert.equal(pending.length, beforeAuto, 'Hidden tabs defer automatic work');
    await act(async () => { renderer!.update(<AutomaticHarness active={true} />); });
    assert.equal(pending.length, beforeAuto + 1);
    await act(async () => { pending[beforeAuto].resolve(Response.json({ provider: 'mymemory', translation: 'Automatic translation' })); await tick(); });
    assert.equal(translation.fromCache, false);
    await act(async () => { renderer!.update(<AutomaticHarness active={false} />); });
    await act(async () => { renderer!.update(<AutomaticHarness active={true} />); });
    assert.equal(translation.fromCache, false, 'An already-consumed trigger does not reload cache on tab return');
    assert.equal(pending.length, beforeAuto + 1);

    const strictStart = pending.length;
    await act(async () => { renderer!.update(<React.StrictMode><AutomaticHarness active={true} text="厳密モードの確認。" /></React.StrictMode>); });
    assert.equal(pending.length, strictStart + 1, 'StrictMode cleanup/restart shares one machine request');
    assert.equal(pending[strictStart].signal.aborted, false);
    await act(async () => {
      pending[strictStart].resolve(Response.json({ translation: 'Strict translation' }));
      await tick();
    });
    assert.equal(translation.translation, 'Strict translation');

    console.log('Translation flow passed: automatic triggers, StrictMode deduplication and independently selectable raw/reviewed versions.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
