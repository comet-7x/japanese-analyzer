import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { buildDailySentenceUrl, fetchDailySentenceCandidates, parseDailySentenceCandidates } from '../app/api/_utils/dailySentence';
import { GET } from '../app/api/daily-sentence/route';
import { DAILY_SENTENCES, getDayNumber, getJstDateKey, isOnlineDailySentence, secondsUntilJstMidnight } from '../app/utils/dailySentences';
import { createDailySentencePool, DAILY_DECK_KEY, DAILY_ONLINE_KEY, DAILY_POOL_KEY, getLocalDailySentence } from '../app/services/dailySentenceClient';
import { LOCALES } from '../app/i18n';

const date = '2026-09-24';
const remoteRow = (id = 123, text = '今日は図書館で本を読みます。') => ({
  id, text, lang: 'jpn', license: 'CC BY 2.0 FR', is_unapproved: false,
  translations: [
    { id: id + 1000, text: '今天在图书馆看书。', lang: 'cmn', script: 'Hans', license: 'CC BY 2.0 FR', is_direct: true, is_unapproved: false },
    { id: id + 2000, text: '今天在圖書館看書。', lang: 'cmn', script: 'Hant', license: 'CC BY 2.0 FR', is_direct: true, is_unapproved: false },
    { id: id + 3000, text: 'I will read at the library today.', lang: 'eng', license: 'CC0 1.0', is_direct: true, is_unapproved: false },
  ],
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

  const sentences = parseDailySentenceCandidates({ data: [remoteRow(), remoteRow()] }, date);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].translation['zh-TW'], '今天在圖書館看書。');
  assert.equal(sentences[0].source?.translations.en?.license, 'CC0 1.0');
  assert.equal(isOnlineDailySentence(sentences[0]), true);
  assert.equal(isOnlineDailySentence({ ...sentences[0], source: { ...sentences[0].source, id: -1 } }), false);
  assert.equal(isOnlineDailySentence({ ...sentences[0], translation: { en: 42 } }), false);
  for (const bad of [
    { ...remoteRow(), lang: 'eng' }, { ...remoteRow(), is_unapproved: true }, { ...remoteRow(), id: -2 },
    { ...remoteRow(), license: 'unknown' }, remoteRow(1, '<script>alert(1)</script>'), remoteRow(1, '今日は図書館です。明日は休みです。'),
    remoteRow(1, 'これは https://example.com です。'), remoteRow(1, '短い。'),
  ]) assert.equal(parseDailySentenceCandidates({ data: [bad] }, date).length, 0);
  const unsafeTranslations = parseDailySentenceCandidates({ data: [{ ...remoteRow(), translations: [
    { ...remoteRow().translations[0], is_direct: false }, { ...remoteRow().translations[1], text: '<b>text</b>' },
    { ...remoteRow().translations[2], license: 'unknown' },
  ] }] }, date);
  assert.deepEqual(unsafeTranslations[0].translation, {});

  const poolValues = new Map<string, string>();
  const poolStorage = { getItem: (key: string) => poolValues.get(key) ?? null, setItem: (key: string, value: string) => { poolValues.set(key, value); } };
  let clock = Date.parse(`${date}T03:00:00Z`);
  const makePool = (store = poolStorage) => createDailySentencePool(store, () => .5, () => clock);
  const pool = makePool();
  assert.equal(pool.syncDelay(date, 'zh-CN'), 0);
  const initial = pool.take(date, 'zh-CN');
  const batch = { date, sentences: parseDailySentenceCandidates({ data: DAILY_SENTENCES.slice(0, 12).map((item, index) => remoteRow(index + 500, item.text)) }, date) };
  assert.equal(pool.addBatch(batch, date, 'zh-CN'), true);
  assert.equal(pool.current(date)?.text, initial.text, 'A fetched batch never selects or replaces the displayed sentence');
  assert.equal(pool.syncDelay(date, 'zh-CN'), 86_400_000, 'A sufficiently stocked pool checks for updates after a day');
  const online = pool.take(date, 'zh-CN', initial.text);
  assert.ok(online.source);
  assert.notEqual(online.text, initial.text);
  assert.equal(makePool().current(date)?.text, online.text, 'Current choice survives reload');
  const used = new Set([initial.text, online.text]);
  for (let i = 0; i < 10; i++) {
    const next = pool.take(date, 'zh-CN', pool.current(date)!.text);
    if (!next.source) break;
    assert.ok(!used.has(next.text), 'Candidate pool consumes each sentence once');
    used.add(next.text);
  }
  assert.ok(pool.syncDelay(date, 'zh-CN') <= 15 * 60_000, 'Low stock permits replenishment after a cooldown');
  const localChoice = pool.take(date, 'zh-CN', pool.current(date)!.text);
  assert.equal(makePool().current(date)?.text, localChoice.text);
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
  assert.equal(migrated.current(date)?.source?.id, 123, 'Existing v2 choice and history migrate');
  assert.equal(migrated.addBatch({ date, sentences }, date, 'en'), true);
  assert.equal(migrated.take(date, 'en', sentences[0].text).source, undefined, 'Migration retains seen IDs and text');
  assert.ok(poolValues.has(DAILY_POOL_KEY));
  assert.equal(makePool().current(date)?.source, undefined, 'A saved local choice takes priority over legacy online cache');
  poolValues.clear();
  const aging = makePool();
  aging.addBatch(batch, date, 'zh-CN');
  const nextDay = '2026-09-25';
  assert.ok(makePool().take(nextDay, 'zh-CN').source, 'Unseen candidates remain usable offline on subsequent days');
  assert.equal(makePool().take('2026-10-02', 'zh-CN').source, undefined, 'Candidate packs expire after seven days');
  poolValues.set(DAILY_POOL_KEY, '{');
  assert.ok(makePool().take(date, 'en').text, 'Corrupt storage falls back safely');

  const originalFetch = globalThis.fetch;
  const code = process.env.CODE;
  try {
    delete process.env.CODE;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.tatoeba.org');
      assert.equal(url.pathname, '/v1/sentences');
      assert.equal(url.searchParams.get('is_native'), 'yes');
      assert.equal(url.searchParams.get('trans:lang'), 'eng');
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      assert.ok(init?.signal);
      return Response.json({ data: [remoteRow()] });
    };
    const req = () => new NextRequest('http://localhost/api/daily-sentence?locale=en');
    const responses = await Promise.all([GET(req()), GET(req())]);
    assert.ok(responses.every(r => r.status === 200));
    assert.equal(calls, 1, 'Concurrent calls share one public API request');
    await GET(req()); assert.equal(calls, 1, 'Successful daily batch is reused');
    const refreshReq = () => new NextRequest('http://localhost/api/daily-sentence?locale=en&refresh=1');
    await GET(refreshReq()); assert.equal(calls, 1, 'Rapid refresh reuses the existing candidate pool');
    const originalNow = Date.now;
    try {
      const later = originalNow() + 11_000;
      Date.now = () => later;
      assert.equal((await GET(refreshReq())).status, 200);
      assert.equal(calls, 2, 'A later manual refresh can fetch a fresh random candidate pool');
    } finally { Date.now = originalNow; }
    globalThis.fetch = async () => { calls++; return new Response('', { status: 429 }); };
    const failing = () => new NextRequest('http://localhost/api/daily-sentence?locale=ko');
    assert.equal((await GET(failing())).status, 503);
    assert.equal((await GET(failing())).status, 503);
    assert.equal(calls, 4, 'Failures are not cached as a successful daily batch');
    await assert.rejects(fetchDailySentenceCandidates(date, 'en'));
    let resolveSlow!: (response: Response) => void;
    let slowCalls = 0;
    globalThis.fetch = async () => {
      slowCalls++;
      return new Promise<Response>(resolve => { resolveSlow = resolve; });
    };
    const slow = GET(new NextRequest('http://localhost/api/daily-sentence?locale=zh-TW'));
    try {
      Date.now = () => originalNow() + 11_000;
      const joined = GET(new NextRequest('http://localhost/api/daily-sentence?locale=zh-TW&refresh=1'));
      assert.equal(slowCalls, 1, 'A refresh after ten seconds still joins an in-flight request instead of starting another');
      resolveSlow(Response.json({ data: [remoteRow()] }));
      const slowResponses = await Promise.all([slow, joined]);
      assert.ok(slowResponses.every(response => response.status === 200));
    } finally { Date.now = originalNow; }
    process.env.CODE = 'secret';
    assert.equal((await GET(req())).status, 401);
    assert.equal(buildDailySentenceUrl('zh-CN').searchParams.get('trans:lang'), 'cmn');
  } finally {
    globalThis.fetch = originalFetch;
    if (code === undefined) delete process.env.CODE; else process.env.CODE = code;
  }
  console.log('Daily sentences passed: 60 annotated examples, shuffle cycles, stable days, storage failures, safe public data, translations, history, caching and authentication.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
