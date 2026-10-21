import assert from 'node:assert/strict';
import { DAILY_SENTENCES, getDayNumber, getJstDateKey, hasDailySentenceReadings, isCompleteDailySentence, isAttributedDailySentence, secondsUntilJstMidnight, type DailySentence } from '../app/utils/dailySentences';
import { createDailySentencePool, DAILY_DECK_KEY, LEGACY_DAILY_SENTENCE_KEY, DAILY_POOL_KEY, getLocalDailySentence } from '../app/services/dailySentenceClient';
import { LOCALES } from '../app/i18n';
import { bundledSentencePack } from '../app/utils/bundledSentencePack';

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
  assert.equal(isCompleteDailySentence(sentences[0], 'en'), false, 'An incomplete legacy cache cannot be displayed');
  assert.equal(hasDailySentenceReadings({ text: '本。', tokens: [{ word: '本', pos: '名詞', furigana: 'hon' }, { word: '。', pos: '記号' }] }), false);
  assert.equal(hasDailySentenceReadings({ text: '本。', tokens: [{ word: '本', pos: '名詞', furigana: 'ほん' }] }), false);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].translation['zh-TW'], '今天在圖書館看書。');
  assert.equal(sentences[0].source?.translations.en?.license, 'CC0 1.0');
  assert.equal(isAttributedDailySentence(sentences[0]), true);
  assert.equal(isAttributedDailySentence({ ...sentences[0], source: { ...sentences[0].source, id: -1 } }), false);
  assert.equal(isAttributedDailySentence({ ...sentences[0], translation: { en: 42 } }), false);
  for (const bad of [
    { ...sentences[0], source: { ...sentences[0].source, license: 'unknown' } },
    { ...sentences[0], translation: { en: '<b>text</b>' } },
    cachedSentence(1, '<script>alert(1)</script>'), cachedSentence(1, '今日は図書館です。明日は休みです。'),
    cachedSentence(1, 'これは https://example.com です。'), cachedSentence(1, '短い。'),
  ]) assert.equal(isAttributedDailySentence(bad), false);

  const poolValues = new Map<string, string>();
  const poolStorage = { getItem: (key: string) => poolValues.get(key) ?? null, setItem: (key: string, value: string) => { poolValues.set(key, value); } };
  const makePool = (store = poolStorage) => createDailySentencePool(store, () => .5);
  const pool = makePool();
  const initial = pool.take(date, 'zh-CN');
  pool.installPack(bundledSentencePack, date);
  assert.equal(pool.current(date, 'zh-CN')?.text, initial.text, 'Installing bundled presets keeps the current local choice');
  const selected = pool.take(date, 'zh-CN', initial.text);
  assert.ok(selected.source);
  assert.notEqual(selected.text, initial.text);
  assert.equal(makePool().current(date, 'zh-CN')?.text, selected.text, 'Current choice survives reload');
  const used = new Set([initial.text, selected.text]);
  for (let i = 0; i < 10; i++) {
    const next = pool.take(date, 'zh-CN', pool.current(date, 'zh-CN')!.text);
    assert.ok(!used.has(next.text), 'Candidate pool consumes each sentence once');
    used.add(next.text);
  }
  const blockedPool = createDailySentencePool(blocked, () => .5);
  const blockedInitial = blockedPool.take(date, 'zh-CN');
  blockedPool.installPack(bundledSentencePack, date);
  const inMemory = blockedPool.take(date, 'zh-CN', blockedInitial.text);
  assert.ok(inMemory.source, 'Unwritable storage still supports an in-memory preset pool');
  assert.notEqual(blockedPool.take(date, 'zh-CN', inMemory.text).text, inMemory.text);

  poolValues.clear();
  const legacy = { ...bundledSentencePack.sentences[0], tokens: [], date };
  poolValues.set(LEGACY_DAILY_SENTENCE_KEY, JSON.stringify({ sentence: legacy, history: [{ date, id: legacy.source!.id, text: legacy.text }] }));
  const migrated = makePool();
  assert.equal(migrated.current(date, 'en'), null, 'Incomplete legacy choices are not restored');
  migrated.installPack(bundledSentencePack, date);
  assert.equal(migrated.current(date, 'en')?.text, legacy.text, 'A bundled preset upgrades the legacy selection in place');
  assert.notEqual(migrated.take(date, 'en', legacy.text).text, legacy.text, 'Migration retains seen IDs and text');
  assert.ok(poolValues.has(DAILY_POOL_KEY));

  poolValues.clear();
  const aging = makePool();
  aging.installPack(bundledSentencePack, date);
  assert.ok(makePool().take('2026-10-02', 'zh-CN').source, 'Unused bundled presets remain usable beyond seven days');
  poolValues.set(DAILY_POOL_KEY, '{');
  assert.ok(makePool().take(date, 'en').text, 'Corrupt storage falls back safely');

  poolValues.clear();
  poolValues.set(DAILY_POOL_KEY, JSON.stringify({ current: cachedSentence(), candidates: sentences, history: [],
    packVersion: '2099-01-01-123456789abc', packSchemaVersion: 3, packIds: [123] }));
  const retired = makePool();
  retired.installPack(bundledSentencePack, date);
  assert.equal(retired.current(date, 'en'), null, 'Retired remote examples cannot override the shipped presets');
  const installed = JSON.parse(poolValues.get(DAILY_POOL_KEY)!);
  assert.equal(installed.packVersion, bundledSentencePack.version);
  assert.ok(installed.candidates.every((sentence: DailySentence) => bundledSentencePack.sentences.some(item => item.text === sentence.text)));
  console.log('Daily sentences passed: annotated presets, shuffle cycles, stable days, storage failures, attribution validation, history, migration and offline persistence.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
