import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { parseSentencePack, type SentencePack } from '../../app/utils/sentencePack';
import { annotateSentence } from './readings';

export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
interface SourceLock { schemaVersion: number; date: string; url: string; sha256: string; approved: { id: number; sha256: string }[]; }

/** Only explicitly selected, fingerprinted sentence pairs enter a release pack. */
export async function buildSentencePack(archive: Uint8Array, lock: SourceLock): Promise<SentencePack> {
  if (lock.schemaVersion !== 1 || digest(archive) !== lock.sha256) throw new Error('Source archive checksum mismatch');
  const files = unzipSync(archive);
  if (!files['jpn.txt'] || files['jpn.txt'].length > 40_000_000) throw new Error('Expected Japanese sentence export');
  return buildSentencePackFromRows(strFromU8(files['jpn.txt']), lock);
}

export async function buildSentencePackFromRows(text: string, lock: SourceLock): Promise<SentencePack> {
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(lock.sha256)) throw new Error('Invalid source lock');
  const approved = new Map(lock.approved.map(row => [row.id, row.sha256]));
  if (!approved.size || approved.size !== lock.approved.length) throw new Error('Invalid selection');
  const sentences: SentencePack['sentences'] = [];
  for (const line of text.split('\n')) {
    const [en, ja, credit] = line.split('\t');
    const attribution = credit && /^CC-BY 2\.0 \(France\) Attribution: tatoeba\.org #(\d+) \(([^)]+)\) & #(\d+) \(([^)]+)\)$/.exec(credit);
    if (!attribution || !approved.has(Number(attribution[3]))) continue;
    const id = Number(attribution[3]);
    if (digest(line) !== approved.get(id)) throw new Error(`Selected sentence ${id} changed; review it before updating`);
    sentences.push({ text: ja, tokens: await annotateSentence(ja), translation: { en }, source: {
      provider: 'tatoeba', id, owner: attribution[4], license: 'CC BY 2.0 FR',
      translations: { en: { id: Number(attribution[1]), owner: attribution[2], license: 'CC BY 2.0 FR' } },
    } });
    approved.delete(id);
  }
  if (approved.size) throw new Error(`Missing selected sentences: ${[...approved.keys()].join(', ')}`);
  sentences.sort((a, b) => a.source!.id - b.source!.id);
  const sha256 = digest(JSON.stringify(sentences));
  return parseSentencePack({ schemaVersion: 2, version: `${lock.date}-${sha256.slice(0, 12)}`, publishedAt: lock.date,
    sha256, source: { url: lock.url, sha256: lock.sha256, license: 'CC BY 2.0 FR' }, sentences });
}

async function main() {
  const lock = JSON.parse(await readFile('scripts/daily-sentence/source.lock.json', 'utf8')) as SourceLock;
  if (process.argv.includes('--check')) {
    const pack = parseSentencePack(JSON.parse(await readFile('app/data/daily-sentences.json', 'utf8')));
    if (digest(JSON.stringify(pack.sentences)) !== pack.sha256 || pack.source.sha256 !== lock.sha256
      || pack.source.url !== lock.url || pack.publishedAt !== lock.date
      || pack.sentences.length !== lock.approved.length || pack.sentences.some(sentence => !lock.approved.some(row => row.id === sentence.source!.id))) {
      throw new Error('Bundled sentence pack does not match the source lock');
    }
    for (const sentence of pack.sentences) {
      const original = sentence.source!; const translation = original.translations.en;
      const row = `${sentence.translation.en}\t${sentence.text}\tCC-BY 2.0 (France) Attribution: tatoeba.org #${translation?.id} (${translation?.owner}) & #${original.id} (${original.owner})`;
      if (digest(row) !== lock.approved.find(approved => approved.id === original.id)?.sha256) throw new Error(`Packed sentence ${original.id} differs from the reviewed source row`);
    }
    const expected = await buildSentencePackFromRows(await readFile('scripts/daily-sentence/approved.tsv', 'utf8'), lock);
    if (JSON.stringify(expected) !== JSON.stringify(pack)) throw new Error('Bundled sentence pack is not reproducible from the selected row snapshot');
    console.log(`Sentence pack verified: ${pack.sentences.length} pairs (${pack.version})`);
    return;
  }
  const archiveIndex = process.argv.indexOf('--archive');
  let archive: Uint8Array;
  if (process.argv.includes('--download')) {
    if (lock.url !== 'https://www.manythings.org/anki/jpn-eng.zip') throw new Error('Unexpected corpus download URL');
    const response = await fetch(lock.url, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Corpus download HTTP ${response.status}`);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 15_000_000) { await reader.cancel(); throw new Error('Corpus archive exceeds size limit'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    archive = Buffer.concat(chunks);
  } else {
    if (archiveIndex >= 0 && !process.argv[archiveIndex + 1]) throw new Error('--archive requires a path');
    archive = archiveIndex >= 0 ? await readFile(process.argv[archiveIndex + 1]) : new Uint8Array();
  }
  const pack = await (process.argv.includes('--download') || archiveIndex >= 0 ? buildSentencePack(archive, lock)
    : buildSentencePackFromRows(await readFile('scripts/daily-sentence/approved.tsv', 'utf8'), lock));
  await mkdir('app/data', { recursive: true });
  await writeFile('app/data/daily-sentences.json', JSON.stringify(pack, null, 2) + '\n');
  console.log(`Built ${pack.sentences.length} pairs (${pack.version})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
