import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import InputSection, { type SentenceReaderHandle, type SentenceReaderState } from '../app/components/InputSection';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import { SPEECH_PRESETS } from '../app/lib/speechServices';
import { beginAudioSpeech, endSpeechPlayback, getSpeechPlaybackSnapshot } from '../app/lib/speechPlaybackStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function main() {
  const globals = new Map(['React', 'window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalFetch = globalThis.fetch;
  const originalCreateUrl = URL.createObjectURL;
  const originalRevokeUrl = URL.revokeObjectURL;
  const storage = { getItem: () => null, setItem() {} };
  Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    umami: { track() {} }, location: { href: 'http://localhost/' }, localStorage: storage, addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }),
    speechSynthesis: { cancel() {}, pause() {}, resume() {} },
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, querySelector: () => null, title: '' } });
  let objectId = 0;
  const revoked: string[] = [];
  URL.createObjectURL = () => `blob:reader-${++objectId}`;
  URL.revokeObjectURL = url => { revoked.push(url); };
  const pending: Array<{ body: Record<string, unknown>; signal: AbortSignal; resolve: (response: Response) => void }> = [];
  globalThis.fetch = async (_url, init) => new Promise<Response>(resolve => {
    pending.push({ body: JSON.parse(String(init?.body)), signal: init!.signal!, resolve });
  });
  const reader = React.createRef<SentenceReaderHandle>();
  let state: SentenceReaderState = { preparing: false, error: '' };
  const onState = (next: SentenceReaderState) => { state = next; };
  let plays = 0; let pauses = 0;
  const audio = { paused: false, ended: false, currentTime: 0,
    pause() { pauses++; this.paused = true; }, async play() { plays++; this.paused = false; } };
  const service = SPEECH_PRESETS.find(item => item.provider === 'openai')!;
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(<LanguageProvider><InputSection
      draft="未提交的修改" originalText="猫がいる。" tokens={[{ word: '猫', pos: '名詞' }]}
      sentenceReaderRef={reader} onSentenceReaderStateChange={onState}
      onDraftChange={() => {}} history={{ entries: [], storageUnavailable: false, record() {}, clear() {} }}
      onAnalyze={() => {}} onCancelAnalyze={() => {}} activeService={null} endpoint={{ baseUrl: '', model: '' }}
      speechService={service} speechServices={[service]} onSpeechServiceChange={() => {}}
    /></LanguageProvider>, { createNodeMock: element => element.type === 'audio' ? audio : null }); });
    await act(async () => { reader.current!.toggle(); });
    assert.equal(pending[0].body.text, '猫がいる。', 'The companion reads the committed sentence, not the editing draft');
    assert.equal(state.preparing, true);
    await act(async () => { reader.current!.toggle(); });
    assert.equal(pending[0].signal.aborted, true, 'Clicking while preparing cancels the same synthesis request');
    assert.equal(state.preparing, false);
    await act(async () => { reader.current!.toggle(); });
    await act(async () => { pending[1].resolve(Response.json({ audio: 'SUQz', mimeType: 'audio/mpeg' })); });
    const player = renderer!.root.findByType('audio');
    const currentUrl = player.props.src;
    await act(async () => { player.props.onPlay({ currentTarget: audio }); });
    assert.equal(getSpeechPlaybackSnapshot()?.text, '猫がいる。');
    await act(async () => { reader.current!.toggle(); });
    assert.equal(pauses, 1, 'The companion pauses the existing player');
    await act(async () => { reader.current!.toggle(); });
    assert.equal(plays, 1, 'The companion resumes the existing player');
    assert.equal(pending.length, 2, 'Pause/resume never regenerates audio');
    await act(async () => { pending[0].resolve(Response.json({ audio: 'SUQz', mimeType: 'audio/mpeg' })); });
    assert.equal(renderer!.root.findByType('audio').props.src, currentUrl, 'A cancelled response cannot replace the current reading');
    const foreign = { ...audio, paused: false };
    const foreignId = beginAudioSpeech(foreign as unknown as HTMLAudioElement, null, '猫がいる。');
    await act(async () => { reader.current!.toggle(); });
    assert.equal(foreign.paused, true, 'An already-playing copy of the same sentence from another host is reused');
    assert.equal(pending.length, 2);
    await act(async () => { renderer!.unmount(); }); renderer = undefined;
    assert.equal(reader.current, null);
    assert.equal(getSpeechPlaybackSnapshot()?.id, foreignId, 'The input host cannot clear another host’s session on unmount');
    endSpeechPlayback(foreignId);
    assert.equal(getSpeechPlaybackSnapshot(), null);
    assert.ok(revoked.includes(currentUrl), 'The shared host releases its audio URL');
    console.log('Companion reading passed: committed source, cancellation, shared playback, stale response and cleanup.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    globalThis.fetch = originalFetch; URL.createObjectURL = originalCreateUrl; URL.revokeObjectURL = originalRevokeUrl;
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
