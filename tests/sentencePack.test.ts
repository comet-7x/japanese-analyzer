import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { bundledSentencePack } from '../app/utils/bundledSentencePack';
import { parseSentencePack, sentencePackBatch, MAX_SENTENCE_PACK_BYTES, type SentencePack } from '../app/utils/sentencePack';
import { createSentencePackStore, verifySentencePack } from '../app/api/_utils/sentencePackStore';
import { buildSentencePack, digest } from '../scripts/daily-sentence/build';
import { createDailySentencePool, DAILY_POOL_KEY } from '../app/services/dailySentenceClient';
import { hasDailySentenceReadings, isCompleteDailySentence } from '../app/utils/dailySentences';
import { annotateSentence } from '../scripts/daily-sentence/readings';

function revision(date: string, sentences = bundledSentencePack.sentences): SentencePack {
  const sha256 = digest(JSON.stringify(sentences));
  return { ...bundledSentencePack, publishedAt: date, sentences, sha256, version: `${date}-${sha256.slice(0, 12)}` };
}

async function main() {
  const pack = verifySentencePack(bundledSentencePack);
  assert.equal(pack.sentences.length, 92);
  assert.ok(pack.sentences.every(sentence => hasDailySentenceReadings(sentence) && isCompleteDailySentence(sentence, 'en')));
  assert.equal(pack.sentences.find(sentence => sentence.source?.id === 187853)?.tokens.find(token => token.word === '何')?.furigana, 'なん');
  assert.equal(pack.sentences.find(sentence => sentence.source?.id === 234717)?.tokens.find(token => token.word === '空い')?.furigana, 'すい');
  assert.ok(pack.sentences.every(sentence => sentence.translation.en && sentence.source?.owner && sentence.source.translations.en?.owner));
  assert.throws(() => verifySentencePack({ ...pack, sentences: pack.sentences.slice(1) }), /checksum/);
  assert.throws(() => parseSentencePack({ ...pack, schemaVersion: 1 }), /metadata/);
  assert.throws(() => parseSentencePack({ ...pack, publishedAt: '2026-02-31' }));
  assert.throws(() => parseSentencePack(revision('2026-10-20', [pack.sentences[0], pack.sentences[0]])), /duplicate/);
  assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], text: '<script>' }])));

  const line = 'I like tea.\t私はお茶が好きです。\tCC-BY 2.0 (France) Attribution: tatoeba.org #111 (CK) & #222 (example)';
  const archive = zipSync({ 'jpn.txt': strToU8(line + '\n') });
  const lock = { schemaVersion: 1, date: '2026-10-20', url: 'https://www.manythings.org/anki/jpn-eng.zip',
    sha256: digest(archive), approved: [{ id: 222, sha256: digest(line) }] };
  assert.equal((await buildSentencePack(archive, lock)).sentences[0].source?.translations.en?.id, 111);
  await assert.rejects(buildSentencePack(new Uint8Array(), lock), /archive checksum/);
  await assert.rejects(buildSentencePack(archive, { ...lock, approved: [{ id: 222, sha256: 'changed' }] }), /changed/);
  await assert.rejects(buildSentencePack(archive, { ...lock, approved: [{ id: 333, sha256: digest(line) }] }), /Missing/);
  assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], tokens: [] }])), /Invalid/);
  assert.throws(() => parseSentencePack(revision('2026-10-20', [{ ...pack.sentences[0], translation: {} }])), /Invalid/);

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
  restored.addBatch(sentencePackBatch(newer, '2026-10-29'), '2026-10-29', 'en');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length, 1, 'A new snapshot removes retired entries');
  restored.installPack(pack, '2026-10-29');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).packVersion, newer.version, 'An older bundled pack cannot replace a cached update');

  values.clear();
  const legacy = { ...pack.sentences[0], tokens: [], date: '2026-10-19' };
  values.set(DAILY_POOL_KEY, JSON.stringify({ current: legacy, candidates: [{ ...pack.sentences[1], tokens: [], date: '2026-10-19' }],
    history: [{ date: '2026-10-19', id: legacy.source!.id, text: legacy.text }], packIds: pack.sentences.map(sentence => sentence.source!.id),
    packVersion: '2026-10-19-34262d4c8ba8', packPublishedAt: pack.publishedAt }));
  const upgraded = createDailySentencePool(storage, () => .5);
  assert.equal(upgraded.current('2026-10-19', 'en'), null, 'An incomplete saved choice is never restored');
  upgraded.installPack(pack, '2026-10-19');
  assert.equal(JSON.parse(values.get(DAILY_POOL_KEY)!).packVersion, pack.version, 'Schema 2 upgrades the same-day unannotated pack');
  const ready = upgraded.take('2026-10-19', 'en');
  assert.ok(ready.source && isCompleteDailySentence(ready, 'en'));
  assert.notEqual(ready.text, legacy.text, 'An annotation upgrade retains consumed history');
  assert.equal(upgraded.current('2026-10-19', 'zh-CN'), null, 'A saved English-only sentence cannot be restored in Chinese');
  const chinese = upgraded.take('2026-10-19', 'zh-CN');
  assert.ok(!chinese.source && isCompleteDailySentence(chinese, 'zh-CN'));
  assert.ok(JSON.parse(values.get(DAILY_POOL_KEY)!).candidates.length > 0, 'Missing locale translations do not consume English candidates');

  let clock = Date.parse('2026-10-21'); let calls = 0;
  let resolve!: (response: Response) => void;
  const warnings: unknown[] = [];
  const store = createSentencePackStore({ url: 'https://sentences.example/pack.json', now: () => clock,
    fetcher: async (_url, init) => {
      calls++; assert.equal(init?.redirect, 'error'); assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      return new Promise<Response>(done => { resolve = done; });
    }, warn: (...args) => warnings.push(args) });
  assert.equal(store.get().version, pack.version, 'Serving a pack never waits for a stalled update');
  store.get(); assert.equal(calls, 1, 'Background updates are coalesced');
  const update = store.refresh();
  const next = revision('2026-10-20');
  resolve(Response.json(next, { headers: { ETag: '"pack-2"' } }));
  await update;
  assert.equal(store.get().version, next.version);
  assert.equal(calls, 1, 'Successful snapshots check for updates at most once a day');
  clock += 86_400_000;
  const rejected = store.refresh(); resolve(Response.json({ ...next, sha256: '0'.repeat(64) })); await rejected;
  assert.equal(store.get().version, next.version, 'An invalid download preserves the last verified snapshot');
  assert.equal(calls, 2); assert.equal(warnings.length, 1);
  clock += 15 * 60_000;
  const unchanged = store.refresh(); resolve(new Response(null, { status: 304 })); await unchanged;
  assert.equal(store.get().version, next.version);
  assert.equal(warnings.length, 1, 'ETag 304 keeps the verified snapshot');

  let cancelled = false;
  const oversized = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(MAX_SENTENCE_PACK_BYTES + 1) } });
  const bounded = createSentencePackStore({ url: 'https://sentences.example/pack.json', fetcher: async () => oversized, warn() {} });
  await bounded.refresh(); assert.equal(cancelled, true); assert.equal(bounded.get().version, pack.version);
  for (const url of ['http://sentences.example/pack.json', 'https://127.0.0.1/pack.json', 'https://user:secret@sentences.example/pack.json']) {
    let fetched = false;
    const protectedStore = createSentencePackStore({ url, fetcher: async () => { fetched = true; return Response.json(next); }, warn() {} });
    await protectedStore.refresh(); assert.equal(fetched, false); assert.equal(protectedStore.get().version, pack.version);
  }
  console.log('Sentence packs passed: pinned source, approved rows, checksums, offline selection, persistent versions, retired entries, non-blocking updates, ETags, bounds and retry fallback.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
