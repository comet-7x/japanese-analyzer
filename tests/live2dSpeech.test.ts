import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beginAudioSpeech,
  beginSystemSpeech,
  endSpeechPlayback,
  getSpeechPlaybackSnapshot,
  setSpeechPlaybackStatus,
  setSystemSpeechBoundary,
  subscribeSpeechPlayback,
} from '../app/lib/speechPlaybackStore';
import { createSpeechEnvelope, sampleSpeechEnvelope } from '../app/plugins/live2d/audioEnvelope';
import { alignSpeechBoundaries, estimateSpeechCues, speechCueAtTime, speechCueProgress, speechRangeProgress, speechPages, speechGraphemes, tokenAtSpeechSpan } from '../app/lib/speechReading';
import { getSpeechReadingSnapshot, getSpeechReadingFrame, subscribeSpeechReading, subscribeSpeechReadingFrame } from '../app/lib/speechReadingStore';
import { setSpeechSweep } from '../app/lib/speechSweep';

test('speech store publishes the current session and ignores stale cleanup', () => {
  const seen: Array<number | null> = [];
  const unsubscribe = subscribeSpeechPlayback(() => seen.push(getSpeechPlaybackSnapshot()?.id ?? null));
  const audio = {} as HTMLAudioElement;
  const blob = new Blob(['audio']);
  const first = beginAudioSpeech(audio, blob, 'こんにちは');
  assert.deepEqual(getSpeechPlaybackSnapshot(), { id: first, source: 'audio', audio, blob, text: 'こんにちは', status: 'playing' });
  setSpeechPlaybackStatus(first, 'paused');
  assert.equal(getSpeechPlaybackSnapshot()?.status, 'paused');

  const second = beginSystemSpeech('さようなら');
  endSpeechPlayback(first);
  setSpeechPlaybackStatus(first, 'playing');
  assert.equal(getSpeechPlaybackSnapshot()?.id, second);
  assert.equal(getSpeechPlaybackSnapshot()?.source, 'system');
  endSpeechPlayback(second);
  assert.equal(getSpeechPlaybackSnapshot(), null);
  unsubscribe();
  assert.deepEqual(seen, [first, first, second, null]);
});

test('PCM envelope opens on speech, closes after silence, and samples by playback time', () => {
  // Four 20 ms windows: silence, voiced, voiced, silence.
  const pcm = new Float32Array(80);
  pcm.fill(0.15, 20, 60);
  const envelope = createSpeechEnvelope([pcm], 1000);
  assert.equal(envelope.samples.length, 4);
  assert.equal(sampleSpeechEnvelope(envelope, 0), 0);
  assert.ok(sampleSpeechEnvelope(envelope, 0.02) > 0.5);
  assert.ok(sampleSpeechEnvelope(envelope, 0.06) < sampleSpeechEnvelope(envelope, 0.04));
  assert.equal(sampleSpeechEnvelope(envelope, 0.08), 0);
  assert.equal(sampleSpeechEnvelope(envelope, -1), 0);
  assert.ok(sampleSpeechEnvelope(envelope, 0.02, 0.5) < sampleSpeechEnvelope(envelope, 0.02));
});

test('sentence pages preserve the source, close quotes and bound unpunctuated multilingual text', () => {
  const samples = ['今日は晴れです。明日は雨です！「散歩しよう。」', '長い文章'.repeat(500), '👨‍👩‍👧‍👦か\u3099'.repeat(100), 'One short sentence. Another sentence!', 'a\n\nb\n', ''];
  for (const text of samples) {
    const pages = speechPages(text);
    assert.equal(pages.map(page => text.slice(page.start, page.end)).join(''), text, 'no text may be dropped or repeated');
    for (const page of pages) {
      assert.ok(page.end > page.start);
      assert.ok(Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text.slice(page.start, page.end).trim())).length <= 46);
    }
  }
  const text = '「散歩しよう。」次の文です。';
  assert.deepEqual(speechPages(text).map(page => text.slice(page.start, page.end)), ['「散歩しよう。」', '次の文です。']);
  const fullPage = '日'.repeat(42) + '。\n\n次の文です。';
  assert.deepEqual(speechPages(fullPage).map(page => fullPage.slice(page.start, page.end).trim()), ['日'.repeat(42) + '。', '次の文です。']);
});

test('word boundaries align repeated words monotonically and do not anticipate speech', () => {
  const cues = alignSpeechBoundaries('猫、猫。犬。', [
    { word: '猫', startTime: 0.2, endTime: 0.6 },
    { word: '猫', startTime: 1, endTime: 1.4 },
    { word: '犬', startTime: 2, endTime: 2.5 },
    { word: '犬', startTime: NaN, endTime: 3 },
  ]);
  assert.deepEqual(cues.map(cue => cue.start), [0, 2, 4]);
  assert.equal(speechCueAtTime(cues, 0.1), null);
  assert.equal(speechCueAtTime(cues, 0.99)?.start, 0, 'keep preceding word during a silence');
  assert.equal(speechCueAtTime(cues, 1)?.start, 2);
  assert.equal(speechCueAtTime(cues, 0.3)?.start, 0, 'seeking backwards must use the media time');
  assert.equal(speechCueAtTime(cues, NaN), null);
  const tokens = [{ word: '猫', pos: '名詞' }, { word: '、', pos: '記号' }, { word: '猫', pos: '名詞' }];
  assert.equal(tokenAtSpeechSpan('猫、猫', tokens, cues[1]), 2);
  assert.equal(tokenAtSpeechSpan('犬、犬', tokens, cues[1]), null, 'never highlight a different source');
});

test('stable bubble fragments highlight the exact boundary without swallowing a neighbouring particle', () => {
  const text = '寄りかかっていいよ。👨‍👩‍👧‍👦か\u3099';
  const fragments = speechGraphemes(text);
  assert.equal(fragments.map(span => text.slice(span.start, span.end)).join(''), text);
  for (const [start, end, expected] of [[2, 5, 'かかっ'], [5, 6, 'て']] as const) {
    const highlighted = fragments.filter(span => span.start < end && span.end > start).map(span => text.slice(span.start, span.end)).join('');
    assert.equal(highlighted, expected);
  }
  assert.ok(fragments.some(span => text.slice(span.start, span.end) === '👨‍👩‍👧‍👦'));
  assert.ok(fragments.some(span => text.slice(span.start, span.end) === 'か\u3099'));
});

test('fallback timelines retain readings only when the captured tokens match the spoken source', () => {
  const tokens = [{ word: '今日', furigana: 'きょう', pos: '名詞' }, { word: 'です', pos: '助動詞' }];
  const cues = estimateSpeechCues('今日です', 3, { tokens });
  assert.deepEqual(cues.map(cue => [cue.start, cue.end]), [[0, 2], [2, 4]]);
  assert.equal(cues.at(-1)?.endTime, 3);
  assert.deepEqual(estimateSpeechCues('今日です', NaN), []);
  const different = estimateSpeechCues('明日です', 3, { tokens });
  assert.equal(different.at(-1)?.end, 4);
});

test('continuous sweep follows media time, clamps silence and covers exact range endpoints', () => {
  const cue = { start: 2, end: 6, startTime: 1, endTime: 3 };
  assert.equal(speechCueProgress(cue, 0.5), 0);
  assert.equal(speechCueProgress(cue, 1.5), 0.25);
  assert.equal(speechCueProgress(cue, 2), 0.5);
  assert.equal(speechCueProgress(cue, 4), 1);
  assert.equal(speechCueProgress({ ...cue, endTime: 1 }, 1), 0);
  const frame = { ...cue, progress: 0.375 };
  assert.equal(speechRangeProgress(frame, { start: 2, end: 3 }), 1);
  assert.equal(speechRangeProgress(frame, { start: 3, end: 4 }), 0.5);
  assert.equal(speechRangeProgress(frame, { start: 4, end: 5 }), 0);
  const values = new Map<string, string>(); let writes = 0;
  const element = { style: { getPropertyValue: (key: string) => values.get(key) ?? '',
    setProperty: (key: string, value: string) => { writes++; values.set(key, value); } } } as unknown as HTMLElement;
  setSpeechSweep(element, 0, 4);
  assert.equal(values.get('--speech-reveal'), 'calc(0% + -4px)', 'zero progress leaves the full soft edge outside the glyph');
  setSpeechSweep(element, 1, 4);
  assert.equal(values.get('--speech-reveal'), 'calc(100% + 4px)', 'completion reveals the entire glyph');
  const count = writes;
  setSpeechSweep(element, 1, 4);
  assert.equal(writes, count, 'paused/unchanged frames must not rewrite DOM styles');
  setSpeechSweep(element, NaN, 4);
  assert.equal(values.get('--speech-progress'), '0');
});

test('one shared reading cursor handles pause, seeks, native boundaries and stale sessions', () => {
  const saved = new Map(['document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const documentMock = Object.assign(new EventTarget(), { hidden: false });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (id: number) => frames.delete(id) });
  const audio = Object.assign(new EventTarget(), { currentTime: 0.2, duration: 3 });
  let notifications = 0;
  const unsubscribe = subscribeSpeechReading(() => { notifications++; });
  const secondUnsubscribe = subscribeSpeechReading(() => {});
  let painted = 0;
  const unsubscribeFrames = subscribeSpeechReadingFrame(() => { painted++; });
  let id: number | null = null;
  try {
    id = beginAudioSpeech(audio as unknown as HTMLAudioElement, null, '猫。犬。', { boundaries: [
      { word: '猫', startTime: 0, endTime: 1 }, { word: '犬', startTime: 1.5, endTime: 2.5 },
    ] });
    assert.equal(frames.size, 1, 'page and bubble must share one polling clock');
    assert.equal(getSpeechReadingSnapshot()?.start, 0);
    assert.equal(getSpeechReadingSnapshot()?.approximate, false);
    const count = notifications;
    audio.dispatchEvent(new Event('timeupdate'));
    assert.equal(notifications, count, 'unchanged words must not rerender the page');
    const wordSnapshot = getSpeechReadingSnapshot();
    const priorPaints = painted;
    audio.currentTime = 0.6;
    audio.dispatchEvent(new Event('timeupdate'));
    assert.equal(getSpeechReadingFrame()?.progress, 0.6);
    assert.equal(getSpeechReadingSnapshot(), wordSnapshot, 'within-word progress must not publish another React snapshot');
    assert.ok(painted > priorPaints, 'the paint channel still receives continuous progress');
    audio.currentTime = 1.8;
    audio.dispatchEvent(new Event('seeking'));
    assert.equal(getSpeechReadingSnapshot()?.start, 2);
    setSpeechPlaybackStatus(id, 'paused');
    assert.equal(frames.size, 0);
    assert.equal(getSpeechReadingSnapshot()?.start, 2, 'pause retains the sentence and current word');
    audio.currentTime = 0.4;
    audio.dispatchEvent(new Event('seeked'));
    assert.equal(getSpeechReadingSnapshot()?.start, 0, 'paused seek updates immediately');
    setSpeechPlaybackStatus(id, 'playing');
    assert.equal(frames.size, 1);
    documentMock.hidden = true;
    documentMock.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size, 0);
    documentMock.hidden = false;
    documentMock.dispatchEvent(new Event('visibilitychange'));
    assert.equal(frames.size, 1);
    const old = id;
    id = beginSystemSpeech('猫。犬。');
    setSystemSpeechBoundary(id, 2);
    assert.equal(getSpeechReadingSnapshot()?.start, 2);
    assert.equal(getSpeechReadingSnapshot()?.approximate, false);
    setSystemSpeechBoundary(old, 0);
    endSpeechPlayback(old);
    assert.equal(getSpeechReadingSnapshot()?.id, id);
    audio.currentTime = 2;
    audio.dispatchEvent(new Event('timeupdate'));
    assert.equal(getSpeechReadingSnapshot()?.start, 2, 'old audio no longer drives the cursor');
    endSpeechPlayback(id); id = null;
    assert.equal(getSpeechReadingSnapshot(), null);
    assert.equal(frames.size, 0);
  } finally {
    if (id !== null) endSpeechPlayback(id);
    unsubscribe(); secondUnsubscribe(); unsubscribeFrames();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
