// Optional integration check: requires analyzer:prepare, but no Python or model.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import manifest from '../../app/lib/localAnalyzerManifest.json';
import { goldCases, safetyCases, probeCases, readingCases } from '../analysis-lab/engines/corpus';
import { scoreTokens, scoreReadings, schoolTokens, type RawToken, type SchoolToken } from '../analysis-lab/engines/school';
import { splitJapaneseText } from '../../app/utils/japaneseChunking';

async function main() {
  const binding = await import(pathToFileURL(resolve('public/local-analyzer/sudachi-0.7.0/sudachi.js')).href);
  const wasm = await binding.default({ module_or_path: await readFile('public/local-analyzer/sudachi-0.7.0/sudachi_bg.wasm') });
  const compressed = Buffer.concat(await Promise.all(manifest.chunks.map(c => readFile(`data/local-analyzer/${c.sha256}.deflate`))));
  const engine = new binding.SudachiTokenizer(inflateRawSync(compressed, { maxOutputLength: manifest.rawBytes }));
  const article = await readFile('tests/fixtures/four-seasons.txt', 'utf8');
  const inputs = [...goldCases, ...safetyCases, ...probeCases, ...readingCases, { id: 'four-seasons', text: article },
    { id: 'joined-quality', text: goldCases.map(c => c.text).join('\n') },
    ...splitJapaneseText(article).map((c, i) => ({ id: `chunk-${i}`, text: c.text }))];
  const flag = process.argv.indexOf('--native-reference');
  const reference = flag < 0 ? null : JSON.parse(await readFile(process.argv[flag + 1], 'utf8'))[0].samples as { id: string; raw: RawToken[] }[];
  const clean = (tokens: (RawToken & { expandedParts?: number })[]) => tokens.map(t => ({ word: t.word, pos: t.pos, reading: t.reading, lemma: t.lemma,
    unknown: t.unknown, expandedParts: t.expandedParts ?? 0 }));
  const converted = new Map<string, SchoolToken[]>();
  for (const { id, text } of inputs) {
    const raw: RawToken[] = engine.tokenize(text);
    const tokens = schoolTokens(text, raw);
    assert.equal(tokens.map(t => t.word).join(''), text, id);
    assert.deepEqual(clean(engine.tokenize(text)), clean(raw), `${id}: deterministic reuse`);
    if (reference) {
      const expected = reference.find(sample => sample.id === id);
      assert.ok(expected, `Missing native reference: ${id}`);
      assert.deepEqual(clean(raw), clean(expected.raw), `${id}: same-version native parity`);
    }
    converted.set(id, tokens);
  }
  const grammarExact = goldCases.filter(c => scoreTokens(converted.get(c.id)!, c.expected, c.readingAlternatives).exact).length;
  const readings = readingCases.flatMap(c => scoreReadings(c.text, converted.get(c.id)!, c.targets));
  assert.equal(grammarExact, 30);
  assert.equal(readings.filter(r => r.passed).length, 17);
  const report = { measuredAt: new Date().toISOString(), engine: manifest.id, cases: inputs.length, exactSourceCases: inputs.length,
    nativeReferenceCases: reference ? inputs.length : null, grammarExact, grammarTotal: goldCases.length,
    readingPassed: readings.filter(r => r.passed).length, readingTotal: readings.length,
    wasmLinearMemoryMiB: wasm.memory.buffer.byteLength / 2 ** 20, noModelCalls: true };
  await writeFile('scripts/analysis-lab/results/sudachi-wasm.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  engine.free();
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
