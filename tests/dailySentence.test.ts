import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from '../app/api/daily-sentence/route';
import { DAILY_SENTENCES, getDayNumber, getJstDateKey, hasDailySentenceReadings, isCompleteDailySentence, isOnlineDailySentence, secondsUntilJstMidnight, type DailySentence } from '../app/utils/dailySentences';
import { createDailySentencePool, DAILY_DECK_KEY, DAILY_ONLINE_KEY, DAILY_POOL_KEY, getLocalDailySentence } from '../app/services/dailySentenceClient';
import { LOCALES } from '../app/i18n';

const date = '2026-09-24';
const cachedSentence = (id = 123, text = '今日は図書館で本を読みます。'): DailySentence => ({
  date, text, tokens: [], translation: { 'zh-CN': '今天在图书馆看书。', 'zh-TW': '今天在圖書館看書。', en: 'I will read at the library today.' },
  source: { provider: 'tatoeba', id, license: 'CC BY 2.0 FR', translations: {
    'zh-CN': { id: id + 1000, license: 'CC BY 2.0 FR' }, 'zh-TW': { id: id + 2000, license: 'CC BY 2.0 FR' },
    en: { id: id + 3000, license: 'CC0 1.0' },
  } },
});

async function main() {
  assert.equal(getJstDateKey(new Date('2026-09-24T14:59:00Z')), date);
  assert.equal(getJstDateKey(new Date('2026-09-24T15:00:00Z')), '2026-09-25');
  assert.equal(secondsUntilJstMidnight(new Date('2026-09-24T14:00:00Z')), 3600);
  assert.equal(getDayNumber('2026-09-25') - getDayNumber(date), 1);
  assert.equal(DAILY_SENTENCES.length, 60);
  assert.equal(new Set(DAILY_SENTENCES.map(item => item.text)).size, 60);
  for (const sentence of DAILY_SENTENCES) {
    assert.equal(sentence.tokens.map(token => token.word).join(''), sentence.text);
    assert.ok(sentence.text.endsWith('。'));
    for (const locale of LOCALES) assert.ok(sentence.translation[locale]?.trim(), `${sentence.text}: ${locale}`);
    for (const token of sentence.tokens) if (/\p{Script=Han}/u.test(token.word)) assert.ok(token.furigana, token.word);
  }

  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const picked: string[] = [];
  for (let i = 0; i < 120; i++) {
    const day = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
    const sentence = getLocalDailySentence(day, storage, () => 0);
    assert.equal(getLocalDailySentence(day, storage, () => .99).text, sentence.text, 'Refresh keeps today’s choice');
    picked.push(sentence.text);
  }
  assert.equal(new Set(picked.slice(0, 60)).size, 60);
  assert.equal(new Set(picked.slice(60)).size, 60);
  assert.notEqual(picked[59], picked[60], 'No immediate repeat across a shuffle boundary');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(getLocalDailySentence(date, blocked).text, getLocalDailySentence(date, blocked).text);
  values.set(DAILY_DECK_KEY, JSON.stringify({ size: 60, index: -1, remaining: [0, 0], date }));
  assert.ok(getLocalDailySentence(date, storage).text);
  values.delete(DAILY_DECK_KEY);
  const refreshed: string[] = [];
  for (let i = 0; i < 60; i++) {
    const sentence = getLocalDailySentence(date, storage, () => .5, { refresh: true, exclude: refreshed.at(-1) });
    refreshed.push(sentence.text);
    assert.equal(getLocalDailySentence(date, storage).text, sentence.text, 'Manual choice survives a page reload');
  }
  assert.equal(new Set(refreshed).size, 60, 'Same-day refresh consumes the shuffled deck without repeating');
  assert.notEqual(getLocalDailySentence(date, blocked, () => 0, { refresh: true, exclude: refreshed[0] }).text, refreshed[0]);

  const sentences = [cachedSentence()];
  assert.equal(isCompleteDailySentence(sentences[0], 'en'), false, 'A raw API result remains a candidate until annotated');
  assert.equal(hasDailySentenceReadings({ text: '本。', tokens: [{ word: '本', pos: '名詞', furigana: 'hon' }, { word: '。', pos: '記号' }] }), false);
  assert.equal(hasDailySentenceReadings({ text: '本。', tokens: [{ word: '本', pos: '名詞', furigana: 'ほん' }] }), false);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].translation['zh-TW'], '今天在圖書館看書。');
  assert.equal(sentences[0].source?.translations.en?.license, 'CC0 1.0');
  assert.equal(isOnlineDailySentence(sentences[0]), true);
  assert.equal(isOnlineDailySentence({ ...sentences[0], source: { ...sentences[0].source, id: -1 } }), false);
  assert.equal(isOnlineDailySentence({ ...sentences[0], translation: { en: 42 } }), false);
  for (const bad of [
    { ...sentences[0], source: { ...sentences[0].source, license: 'unknown' } },
    { ...sentences[0], translation: { en: '<b>text</b>' } },
    cachedSentence(1, '<script>alert(1)</script>'), cachedSentence(1, '今日は図書館です。明日は休みです。'),
    cachedSentence(1, 'これは https://example.com です。'), cachedSentence(1, '短い。'),
  ]) assert.equal(isOnlineDailySentence(bad), false);

  const poolValues = new Map<string, string>();
  const poolStorage = { getItem: (key: string) => poolValues.get(key) ?? null, setItem: (key: string, value: string) => { poolValues.set(key, value); } };
  let clock = Date.parse(`${date}T03:00:00Z`);
  const makePool = (store = poolStorage) => createDailySentencePool(store, () => .5, () => clock);
  const pool = makePool();
  assert.equal(pool.syncDelay(date, 'zh-CN'), 0);
  const initial = pool.take(date, 'zh-CN');
  const batch = { date, sentences: DAILY_SENTENCES.slice(0, 12).map((item, index) => ({ ...cachedSentence(index + 500, item.text), tokens: item.tokens })) };
  assert.equal(pool.addBatch(batch, date, 'zh-CN'), true);
  assert.equal(pool.current(date, 'zh-CN')?.text, initial.text, 'A fetched batch never selects or replaces the displayed sentence');
  assert.equal(pool.syncDelay(date, 'zh-CN'), 86_400_000, 'A sufficiently stocked pool checks for updates after a day');
  const online = pool.take(date, 'zh-CN', initial.text);
  assert.ok(online.source);
  assert.notEqual(online.text, initial.text);
  assert.equal(makePool().current(date, 'zh-CN')?.text, online.text, 'Current choice survives reload');
  const used = new Set([initial.text, online.text]);
  for (let i = 0; i < 10; i++) {
    const next = pool.take(date, 'zh-CN', pool.current(date, 'zh-CN')!.text);
    if (!next.source) break;
    assert.ok(!used.has(next.text), 'Candidate pool consumes each sentence once');
    used.add(next.text);
  }
  assert.ok(pool.syncDelay(date, 'zh-CN') <= 15 * 60_000, 'Low stock permits replenishment after a cooldown');
  const localChoice = pool.take(date, 'zh-CN', pool.current(date, 'zh-CN')!.text);
  assert.equal(makePool().current(date, 'zh-CN')?.text, localChoice.text);
  pool.failed('en');
  assert.equal(makePool().syncDelay(date, 'en'), 15 * 60_000, 'Failure backoff persists across page reloads');
  clock += 15 * 60_000;
  assert.equal(makePool().syncDelay(date, 'en'), 0);
  pool.failed('en');
  assert.equal(pool.syncDelay(date, 'en'), 30 * 60_000, 'Repeated failures increase the retry interval');
  assert.equal(pool.addBatch({ date: '2026-09-23', sentences: batch.sentences }, date, 'en'), false);
  assert.equal(pool.addBatch({ date, sentences: [{ text: '<script>' }] }, date, 'en'), false);
  const blockedPool = createDailySentencePool(blocked, () => .5, () => clock);
  const blockedInitial = blockedPool.take(date, 'zh-CN');
  assert.equal(blockedPool.addBatch(batch, date, 'zh-CN'), true);
  const inMemory = blockedPool.take(date, 'zh-CN', blockedInitial.text);
  assert.ok(inMemory.source, 'Unwritable storage still supports an in-memory online candidate pool');
  assert.notEqual(blockedPool.take(date, 'zh-CN', inMemory.text).text, inMemory.text);
  poolValues.clear();
  poolValues.set(DAILY_ONLINE_KEY, JSON.stringify({ sentence: sentences[0], history: [{ date, id: 123, text: sentences[0].text }] }));
  const migrated = makePool();
  assert.equal(migrated.current(date, 'en'), null, 'Incomplete legacy choices are not restored');
  assert.equal(migrated.addBatch({ date, sentences }, date, 'en'), true);
  assert.equal(migrated.take(date, 'en', sentences[0].text).source, undefined, 'Migration retains seen IDs and text');
  assert.ok(poolValues.has(DAILY_POOL_KEY));
  assert.equal(makePool().current(date, 'en')?.source, undefined, 'A saved local choice takes priority over legacy online cache');
  poolValues.clear();
  const aging = makePool();
  aging.addBatch(batch, date, 'zh-CN');
  const nextDay = '2026-09-25';
  assert.ok(makePool().take(nextDay, 'zh-CN').source, 'Unseen candidates remain usable offline on subsequent days');
  assert.equal(makePool().take('2026-10-02', 'zh-CN').source, undefined, 'Candidate packs expire after seven days');
  poolValues.set(DAILY_POOL_KEY, '{');
  assert.ok(makePool().take(date, 'en').text, 'Corrupt storage falls back safely');

  poolValues.clear();
  const incomplete = makePool();
  assert.equal(incomplete.addBatch({ date, sentences }, date, 'en'), true);
  assert.equal(incomplete.take(date, 'en').source, undefined, 'Raw API candidates without readings cannot be displayed');
  const noTranslation = { ...batch.sentences[0], translation: {} };
  assert.equal(incomplete.addBatch({ date, sentences: [noTranslation] }, date, 'ko'), true);
  assert.ok(isCompleteDailySentence(incomplete.take(date, 'ko'), 'ko'), 'Missing locale translations fall back to complete local examples');

  const originalFetch = globalThis.fetch;
  const code = process.env.CODE;
  try {
    delete process.env.CODE;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('No external calls expected'); };
    const req = () => new NextRequest('http://localhost/api/daily-sentence?locale=en');
    const responses = await Promise.all([GET(req()), GET(req()), GET(new NextRequest('http://localhost/api/daily-sentence?locale=zh-CN&refresh=1'))]);
    assert.ok(responses.every(response => response.status === 200));
    const body = await responses[0].json();
    assert.equal(body.sentences.length, 92);
    assert.ok(body.sentences.every(isOnlineDailySentence));
    assert.equal(calls, 0, 'Serving and refreshing bundled snapshots never depends on a public upstream');
    process.env.CODE = 'secret';
    assert.equal((await GET(req())).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    if (code === undefined) delete process.env.CODE; else process.env.CODE = code;
  }
  console.log('Daily sentences passed: 60 annotated examples, shuffle cycles, stable days, storage failures, safe public data, translations, history, caching and authentication.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
