import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { bundledSentencePack } from '../app/utils/bundledSentencePack';
import { parseSentencePack, type SentencePack } from '../app/utils/sentencePack';
import { buildSentencePack, digest } from '../scripts/daily-sentence/build';
import { createDailySentencePool, DAILY_POOL_KEY } from '../app/services/dailySentenceClient';
import { DAILY_SENTENCES, hasDailySentenceReadings, isCompleteDailySentence } from '../app/utils/dailySentences';
import { LOCALES } from '../app/i18n';
import { annotateSentence } from '../scripts/daily-sentence/readings';

function revision(date: string, sentences = bundledSentencePack.sentences): SentencePack {
  const sha256 = digest(JSON.stringify(sentences));
  return { ...bundledSentencePack, publishedAt: date, sentences, sha256, version: `${date}-${sha256.slice(0, 12)}` };
}

async function main() {
  const pack = parseSentencePack(bundledSentencePack);
  assert.equal(digest(JSON.stringify(pack.sentences)), pack.sha256);
  assert.equal(pack.sentences.length, 92);
  assert.ok(pack.sentences.every(sentence => hasDailySentenceReadings(sentence) && LOCALES.every(locale => isCompleteDailySentence(sentence, locale))));
  const all = [...DAILY_SENTENCES, ...pack.sentences];
  const expectedTexts = all.map(sentence => sentence.text).sort();
  assert.equal(new Set(expectedTexts).size, 152);
  for (const locale of LOCALES) {
    assert.deepEqual(all.filter(sentence => isCompleteDailySentence(sentence, locale)).map(sentence => sentence.text).sort(), expectedTexts, `${locale}: exactly the same 152 complete examples`);
    const isolated = new Map<string, string>();
    const deck = createDailySentencePool({ getItem: key => isolated.get(key) ?? null, setItem: (key, value) => { isolated.set(key, value); } }, () => .5);
    deck.installPack(pack, '2026-10-19');
    const seen = new Set<string>(); let previous = '';
    for (let i = 0; i < 152; i++) {
      const selected = deck.take('2026-10-19', locale, previous);
      assert.ok(isCompleteDailySentence(selected, locale));
      assert.ok(!seen.has(selected.text), `${locale}: no repeat before exhausting all examples`);
      seen.add(selected.text); previous = selected.text;
    }
    assert.deepEqual([...seen].sort(), expectedTexts, `${locale}: all examples are actually selectable offline`);
  }
  assert.equal(pack.sentences.find(sentence => sentence.source?.id === 187853)?.tokens.find(token => token.word === '何')?.furigana, 'なん');
  assert.equal(pack.sentences.find(sentence => sentence.source?.id === 234717)?.tokens.find(token => token.word === '空い')?.furigana, 'すい');
  assert.ok(pack.sentences.every(sentence => sentence.translation.en && sentence.source?.owner && sentence.source.translations.en?.owner));
  assert.throws(() => parseSentencePack({ ...pack, schemaVersion: 1 }), /metadata/);
  assert.throws(() => parseSentencePack({ ...pack, schemaVersion: 2 }), /metadata/);
  assert.throws(() => parseSentencePack({ ...pack, publishedAt: '2026-02-31' }));
  assert.throws(() => parseSentencePack(revision('2026-10-20', [pack.sentences[0], pack.sentences[0]])), /duplicate/);
  assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], text: '<script>' }])));

  const line = 'I like tea.\t私はお茶が好きです。\tCC-BY 2.0 (France) Attribution: tatoeba.org #111 (CK) & #222 (example)';
  const archive = zipSync({ 'jpn.txt': strToU8(line + '\n') });
  const localized = '222\t我喜欢喝茶。\t我喜歡喝茶。\t나는 차를 좋아해요.\n';
  const lock = { schemaVersion: 1, date: '2026-10-20', url: 'https://www.manythings.org/anki/jpn-eng.zip',
    sha256: digest(archive), translationsSha256: digest(localized), approved: [{ id: 222, sha256: digest(line) }] };
  assert.equal((await buildSentencePack(archive, lock, localized)).sentences[0].source?.translations.en?.id, 111);
  await assert.rejects(buildSentencePack(new Uint8Array(), lock, localized), /archive checksum/);
  await assert.rejects(buildSentencePack(archive, { ...lock, approved: [{ id: 222, sha256: 'changed' }] }, localized), /changed/);
  await assert.rejects(buildSentencePack(archive, { ...lock, approved: [{ id: 333, sha256: digest(line) }] }, localized), /Missing/);
  await assert.rejects(buildSentencePack(archive, lock, localized.replace('喝茶', '喝水')), /translation checksum/);
  for (const invalid of [localized.replace('222', '223'), localized + localized, localized.replace('나는 차를 좋아해요.', '')]) {
    await assert.rejects(buildSentencePack(archive, { ...lock, translationsSha256: digest(invalid) }, invalid));
  }
  assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], tokens: [] }])), /Invalid/);
  assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], translation: {} }])), /Invalid/);
  for (const locale of LOCALES) {
    const translation = { ...pack.sentences[0].translation }; delete translation[locale];
    assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], translation }])), /Invalid/, `A release missing ${locale} must fail`);
  }

  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const pool = createDailySentencePool(storage, () => .5);
  pool.installPack(pack, '2026-10-19');
  const selected = pool.take('2026-10-19', 'en');
  pool.installPack(pack, '2026-10-19');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length, 91, 'Installing the same pack never refills consumed entries');
  const restored = createDailySentencePool(storage, () => .5);
  restored.installPack(pack, '2026-10-28');
  assert.notEqual(restored.take('2026-10-28', 'en').text, selected.text);
  assert.ok(JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length > 0, 'Bundled snapshot candidates remain usable beyond a week offline');
  const nextText = '今日は友達と図書館に行きます。';
  const newer = revision('2026-10-29', [{ ...pack.sentences[0], text: nextText, tokens: await annotateSentence(nextText), source: { ...pack.sentences[0].source!, id: 999_999 } }]);
  restored.installPack(newer, '2026-10-29');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length, 1, 'A new snapshot removes retired entries');
  restored.installPack(pack, '2026-10-29');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).packVersion, pack.version, 'The installed application replaces retired remote snapshots with its bundled pack');

  values.clear();
  const legacy = { ...pack.sentences[0], tokens: [], date: '2026-10-19' };
  values.set(DAILY_POOL_KEY, JSON.stringify({ current: legacy, candidates: [{ ...pack.sentences[1], tokens: [], date: '2026-10-19' }],
    history: [{ date: '2026-10-19', id: legacy.source!.id, text: legacy.text }], packIds: pack.sentences.map(sentence => sentence.source!.id),
    packVersion: '2026-10-19-34262d4c8ba8', packPublishedAt: pack.publishedAt }));
  const upgraded = createDailySentencePool(storage, () => .5);
  assert.equal(upgraded.current('2026-10-19', 'en'), null, 'An incomplete saved choice is never restored');
  upgraded.installPack(pack, '2026-10-19');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).packVersion, pack.version, 'The current schema upgrades the same-day legacy pack');
  for (const locale of LOCALES) assert.equal(upgraded.current('2026-10-19', locale)?.text, legacy.text, 'An upgrade fills the current example in place for every language');
  const ready = upgraded.take('2026-10-19', 'en');
  assert.ok(ready.source && isCompleteDailySentence(ready, 'en'));
  assert.notEqual(ready.text, legacy.text, 'An annotation upgrade retains consumed history');
  assert.equal(upgraded.current('2026-10-19', 'zh-CN')?.text, ready.text, 'All locales can restore the same complete example');
  const chinese = upgraded.take('2026-10-19', 'zh-CN');
  assert.ok(chinese.source && isCompleteDailySentence(chinese, 'zh-CN'));

  values.clear();
  values.set(DAILY_POOL_KEY, JSON.stringify({ candidates: [], history: [], packIds: [], packVersion: '2026-10-20-123456789abc', packPublishedAt: '2026-10-20', packSchemaVersion: 2 }));
  const bilingual = createDailySentencePool(storage, () => .5);
  bilingual.installPack(pack, '2026-10-20');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).packVersion, pack.version, 'A four-language schema upgrade replaces a newer-date bilingual cache');

  console.log('Sentence packs passed: pinned source, approved rows, checksums, four-language offline selection, persistent versions, retired entries and annotation upgrades.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
