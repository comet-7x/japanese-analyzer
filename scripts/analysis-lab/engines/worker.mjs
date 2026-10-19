// Isolated process: module loading and dictionary initialization are timed together.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const { engine, cache, texts, performanceText, iterations } = request;
const baseline = process.memoryUsage().rss;
const started = performance.now();
const filesSize = path => statSync(path).isDirectory() ? readdirSync(path).reduce((sum, file) => sum + filesSize(join(path, file)), 0) : statSync(path).size;
const dictRoot = kind => {
  const base = join(cache, `lindera-${kind}-6.2.0`);
  return statSync(join(base, 'metadata.json'), { throwIfNoEntry: false }) ? base : join(base, readdirSync(base).find(file => statSync(join(base, file)).isDirectory()));
};
let tokenize, dictionaryBytes, version;
if (engine === 'kuromoji-ipadic') {
  const kuromoji = require('kuromoji');
  const path = join(require.resolve('kuromoji/package.json'), '..', 'dict');
  const tokenizer = await new Promise((resolve, reject) => kuromoji.builder({ dicPath: path }).build((error, tokenizer) => error ? reject(error) : resolve(tokenizer)));
  version = 'kuromoji@0.1.2 / bundled IPADIC 2.7.0-20070801';
  dictionaryBytes = filesSize(path);
  tokenize = text => tokenizer.tokenize(text).map(t => ({ word: t.surface_form,
    pos: [t.pos, t.pos_detail_1, t.pos_detail_2, t.pos_detail_3], reading: t.reading ?? '', lemma: t.basic_form, unknown: t.word_type === 'UNKNOWN' }));
} else {
  const kind = engine.includes('unidic') ? 'unidic' : 'ipadic';
  const path = dictRoot(kind);
  dictionaryBytes = filesSize(path);
  let tokenizer;
  if (engine.includes('wasm')) {
    const wasm = await import('lindera-wasm');
    const wasmPath = new URL('./node_modules/lindera-wasm/lindera_wasm_bg.wasm', import.meta.url);
    await wasm.default({ module_or_path: readFileSync(wasmPath) });
    const names = ['metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals', 'dict.wordsidx', 'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin'];
    const dictionary = wasm.loadDictionaryFromBytes(...names.map(name => readFileSync(join(path, name))));
    const builder = new wasm.TokenizerBuilder();
    builder.setDictionaryInstance(dictionary);
    builder.setMode('normal');
    tokenizer = builder.build();
  } else {
    const { loadDictionary, Tokenizer } = require('lindera');
    tokenizer = new Tokenizer(loadDictionary(path), 'normal');
  }
  version = `lindera${engine.includes('wasm') ? '-wasm' : ''}@6.2.0 / ${kind} release 6.2.0`;
  // Release 6.2.0 UniDic has 17 feature columns: index 9 is surface pronunciation,
  // index 6 is the LEMMA reading. Do not pretend it has modern UniDic's kana[17].
  tokenize = text => tokenizer.tokenize(text).map(t => ({ word: t.surface, pos: t.details.slice(0, 4),
    reading: t.details[kind === 'unidic' ? 9 : 7] ?? '', readingKind: kind === 'unidic' ? 'pronunciation' : 'kana',
    lemma: t.details[kind === 'unidic' ? 7 : 6], unknown: t.isUnknown }));
}
const coldMs = performance.now() - started;
const rssAfterInit = process.memoryUsage().rss;
const samples = texts.map(({ id, text }) => {
  try { return { id, raw: tokenize(text) }; }
  catch (error) { return { id, error: String(error.message) }; }
});
const times = [];
for (let i = 0; i < iterations; i++) {
  const start = performance.now(); tokenize(performanceText); times.push(performance.now() - start);
}
const stressed = performanceText.repeat(20);
const stressTimes = [];
for (let i = 0; i < 10; i++) {
  const start = performance.now(); tokenize(stressed); stressTimes.push(performance.now() - start);
}
process.stdout.write(JSON.stringify({ engine, version, runtime: process.version, dictionaryBytes, coldMs, rssBefore: baseline, rssAfterInit,
  rssAfterWarm: process.memoryUsage().rss, peakRss: process.resourceUsage().maxRSS * 1024, times, stressTimes, samples }));
