import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSelectionTools } from '../app/hooks/useSelectionTools';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function main() {
  const originalFetch = globalThis.fetch;
  let renderer: ReactTestRenderer | undefined;
  let tools!: ReturnType<typeof useSelectionTools>;
  const pending: Array<{ body: Record<string, unknown>; signal: AbortSignal; resolve: (response: Response) => void }> = [];
  function Harness({ identity = 'local:1:0:0' }: { identity?: string }) {
    tools = useSelectionTools({ identity, word: '食べた', pos: '動詞', furigana: 'たべた', sentence: '魚を食べた。', kind: 'word', locale: 'zh-CN', model: { endpoint: { baseUrl: 'https://model.example/v1', model: 'test' }, apiKey: 'key' } });
    return null;
  }
  try {
    globalThis.fetch = async (_input, init) => new Promise<Response>(resolve => pending.push({ body: JSON.parse(String(init?.body)), signal: init!.signal!, resolve }));
    await act(async () => { renderer = create(<Harness />); });
    assert.equal(pending.length, 0, 'Selecting text must not start model or dictionary work');
    await act(async () => { void tools.loadTranslation(); });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].body.task, 'translate');
    await act(async () => { pending[0].resolve(Response.json({ translation: '吃了' })); await tick(); });
    assert.equal(tools.translation, '吃了');
    assert.equal(tools.analysis, null);

    await act(async () => { void tools.loadAnalysis(); });
    assert.equal(pending.length, 2);
    assert.equal(pending[1].body.task, 'analyze');
    await act(async () => { renderer!.update(<Harness identity="local:2:0:0" />); });
    assert.equal(pending[1].signal.aborted, true, 'Changing selection or analysis revision cancels each pending tool');
    await act(async () => { pending[1].resolve(Response.json({ dictionaryForm: '食べる', explanation: '过去形。', example: '', exampleTranslation: '', pos: '', furigana: '' })); await tick(); });
    assert.equal(tools.analysis, null, 'A stale response cannot enter the next selection');
    console.log('Selection tools passed: zero eager requests, independent lazy tasks and stale-response isolation.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
