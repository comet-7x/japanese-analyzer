import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import SpeechServices from '../app/components/SpeechServices';
import SelectionDetailPanel from '../app/components/SelectionDetailPanel';
import { loadSpeechSettings } from '../app/lib/speechServices';
import SpeechReadingHighlight from '../app/components/SpeechReadingHighlight';
import { beginSystemSpeech, endSpeechPlayback, setSystemSpeechBoundary } from '../app/lib/speechPlaybackStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function main() {
  const originalFetch = globalThis.fetch;
  const createUrl = URL.createObjectURL;
  const revokeUrl = URL.revokeObjectURL;
  const globals = new Map(['window', 'document', 'localStorage', 'React', 'Audio', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map([['ttsGender', 'male'], ['ttsRate', '25']]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'http://localhost/' }, umami: { track() {} }, localStorage: storage, addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  const audio = { pause() {}, load() {}, removeAttribute() {}, play: async () => {} };
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: class { pause = audio.pause; play = audio.play; load = audio.load; removeAttribute = audio.removeAttribute; } });
  const revoked: string[] = []; let urlId = 0;
  URL.createObjectURL = () => `blob:test-${++urlId}`;
  URL.revokeObjectURL = url => { revoked.push(url); };
  const pending: Array<{ signal: AbortSignal; resolve: (response: Response) => void; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (_input, init) => new Promise<Response>(resolve => {
    pending.push({ signal: init!.signal!, resolve, body: JSON.parse(String(init?.body)) });
  });
  const respond = (index: number) => pending[index].resolve(Response.json({ audio: 'SUQz', mimeType: 'audio/mpeg' }));
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => {
      renderer = create(<LanguageProvider><SpeechServices settings={loadSpeechSettings(storage)} onChange={() => {}} /></LanguageProvider>, {
        createNodeMock: element => element.type === 'audio' ? audio : null,
      });
    });
    const previews = () => renderer!.root.findAllByType('button').filter(button => button.children.join('') === '试听' || button.children.join('') === '停止');
    await act(async () => { void previews()[0].props.onClick(); });
    await act(async () => { void previews()[1].props.onClick(); });
    assert.equal(pending[0].signal.aborted, true, 'A new preview cancels the previous request');
    await act(async () => { respond(1); await tick(); });
    const currentUrl = renderer!.root.findByType('audio').props.src;
    assert.ok(currentUrl);
    await act(async () => { respond(0); await tick(); });
    assert.equal(renderer!.root.findByType('audio').props.src, currentUrl, 'Late audio cannot replace the current preview');
    assert.ok(!revoked.includes(currentUrl), 'Late responses cannot revoke playing audio');
    await act(async () => { void previews()[1].props.onClick(); });
    assert.equal(renderer!.root.findByType('audio').props.src, undefined);
    assert.ok(revoked.includes(currentUrl), 'Stopping releases the playing URL');
    await act(async () => { void previews()[0].props.onClick(); });
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    assert.equal(pending[2].signal.aborted, true, 'Unmounting cancels pending previews');
    await act(async () => { respond(2); await tick(); });

    await act(async () => { renderer = create(<LanguageProvider><SelectionDetailPanel
      selectedText="猫" pos="名詞" reading="ねこ" context="猫。" tokens={[{ word: '猫', pos: '名詞' }]}
      selectionKind="word" identity="cat" model={{ apiKey: '', endpoint: { baseUrl: '', model: '' } }}
      onClose={() => {}} onEdit={() => {}} canEdit={false} canGroup={false}
    /></LanguageProvider>); });
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '朗读发音' }).props.onClick(); });
    assert.equal(pending[3].body.gender, 'male');
    assert.equal(pending[3].body.rate, 25);
    await act(async () => { respond(3); await tick(); });
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    assert.equal(revoked.length, urlId, 'Every allocated audio URL is eventually released');
    // Word changes must update only the small subscriber, preserving the sentence tree.
    const documentEvents = new EventTarget();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: Object.assign(documentEvents, { hidden: false }) });
    const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; } });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => frames.delete(id) });
    const node = (start: number, end: number) => {
      const attributes = new Map<string, string>();
      const styles = new Map<string, string>();
      return { dataset: { tokenIndex: String(start), tokenEnd: String(end) }, attributes,
        style: { getPropertyValue: (key: string) => styles.get(key) ?? '', setProperty: (key: string, value: string) => styles.set(key, value) },
        setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) };
    };
    const combined = node(0, 1), last = node(2, 2);
    const root = { querySelectorAll: () => [combined, last] } as unknown as HTMLDivElement;
    const containerRef = { current: root };
    const tokens = [{ word: '猫', pos: '名詞' }, { word: 'です', pos: '助動詞' }, { word: '犬', pos: '名詞' }];
    let sentenceRenders = 0;
    function Sentence() {
      sentenceRenders++;
      return <article><p>猫です犬</p><SpeechReadingHighlight containerRef={containerRef} tokens={tokens} layoutKey="combined" /></article>;
    }
    await act(async () => { renderer = create(<Sentence />); });
    let speechId = 0;
    await act(async () => { speechId = beginSystemSpeech('猫です犬'); setSystemSpeechBoundary(speechId, 1); });
    assert.equal(combined.attributes.get('data-reading-current'), 'true', 'a word inside a combined reading unit highlights that unit');
    await act(async () => { setSystemSpeechBoundary(speechId, 3); });
    assert.equal(combined.attributes.has('data-reading-current'), false);
    assert.equal(last.attributes.get('data-reading-current'), 'true');
    assert.equal(last.style.getPropertyValue('--speech-progress'), '1', 'native boundaries without duration use a complete word rather than invented timing');
    assert.equal(sentenceRenders, 1, 'following speech must not rerender the whole sentence or page');
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    assert.equal(last.attributes.has('data-reading-current'), false, 'unmount removes owned highlights');
    assert.equal(frames.size, 0, 'unmount releases the shared polling frame');
    endSpeechPlayback(speechId);
    console.log('Speech UI passed: overlapping previews, stop/unmount cleanup and saved selection voice/rate.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch; URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
