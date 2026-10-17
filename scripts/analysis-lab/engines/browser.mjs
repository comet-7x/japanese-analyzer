// Real headless Chrome smoke/performance check. No user profile or application tab.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../../..');
const cache = join(root, '.codex-dev/local-engines');
const input = JSON.parse(await readFile(join(cache, 'browser-input.json'), 'utf8'));
const permitted = new Set(['metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals', 'dict.wordsidx', 'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin']);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const [, namespace, name, file] = pathname.split('/');
    let path;
    if (namespace === 'wasm' && ['lindera_wasm.js', 'lindera_wasm_bg.wasm'].includes(name)) path = join(directory, 'node_modules/lindera-wasm', name);
    if (namespace === 'dict' && ['ipadic', 'unidic'].includes(name) && permitted.has(file)) path = join(cache, `lindera-${name}-6.2.0`, `lindera-${name}`, file);
    if (namespace === 'kuromoji' && name === 'kuromoji.js') path = join(root, 'node_modules/kuromoji/build/kuromoji.js');
    if (namespace === 'kuromoji' && name === 'dict' && /^[a-z_]+\.dat\.gz$/u.test(file)) path = join(root, 'node_modules/kuromoji/dict', file);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', path?.endsWith('.wasm') ? 'application/wasm' : path?.endsWith('.js') ? 'text/javascript' : path ? 'application/octet-stream' : 'text/html');
    response.end(path ? await readFile(path) : '<!doctype html><title>Local engine verification</title>');
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { measuredAt: new Date().toISOString(), browser: '', note: 'Local HTTP, fresh headless Chrome per run; download time on a real connection is not measured. WASM linear memory is not process RSS.', results: [] };
try {
  for (const engine of ['kuromoji-ipadic', 'lindera-wasm-ipadic', 'lindera-wasm-unidic']) {
    for (let run = 1; run <= 3; run++) {
      const browser = await chromium.launch({ executablePath: process.env.ENGINE_LAB_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
      const deadline = setTimeout(() => { void browser.close(); }, 120_000);
      try {
        report.browser = browser.version();
        const page = await browser.newPage();
        page.on('pageerror', error => console.error(`${engine}: ${error.message}`));
        await page.goto(base);
        const value = await page.evaluate(async ({ engine, input, base }) => {
          const started = performance.now();
          let tokenize, wasm;
          if (engine === 'kuromoji-ipadic') {
            await new Promise((resolveScript, reject) => {
              const script = document.createElement('script'); script.src = base + '/kuromoji/kuromoji.js';
              script.onload = resolveScript; script.onerror = reject; document.head.append(script);
            });
            const tokenizer = await new Promise((resolveTokenizer, reject) => globalThis.kuromoji.builder({ dicPath: '/kuromoji/dict' }).build((error, value) => error ? reject(error) : resolveTokenizer(value)));
            tokenize = text => tokenizer.tokenize(text).map(t => ({ word: t.surface_form, pos: [t.pos, t.pos_detail_1, t.pos_detail_2, t.pos_detail_3], reading: t.reading ?? '', lemma: t.basic_form, unknown: t.word_type === 'UNKNOWN' }));
          } else {
            const engineModule = await import(base + '/wasm/lindera_wasm.js');
            wasm = await engineModule.default();
            const kind = engine.endsWith('unidic') ? 'unidic' : 'ipadic';
            const names = ['metadata.json', 'dict.trie', 'dict.valsidx', 'dict.vals', 'dict.wordsidx', 'dict.words', 'matrix.mtx', 'char_def.bin', 'unk.bin'];
            const files = await Promise.all(names.map(async name => new Uint8Array(await (await fetch(`${base}/dict/${kind}/${name}`)).arrayBuffer())));
            const dictionary = engineModule.loadDictionaryFromBytes(...files);
            const builder = new engineModule.TokenizerBuilder(); builder.setDictionaryInstance(dictionary); builder.setMode('normal');
            const tokenizer = builder.build();
            tokenize = text => tokenizer.tokenize(text).map(t => ({ word: t.surface, pos: t.details.slice(0, 4), reading: t.details[kind === 'unidic' ? 9 : 7] ?? '',
              readingKind: kind === 'unidic' ? 'pronunciation' : 'kana', lemma: t.details[kind === 'unidic' ? 7 : 6], unknown: t.isUnknown }));
          }
          const coldMs = performance.now() - started;
          const samples = input.texts.map(({ id, text }) => {
            try { return { id, raw: tokenize(text) }; } catch (error) { return { id, error: error.message }; }
          });
          const times = [];
          for (let i = 0; i < 50; i++) { const start = performance.now(); tokenize(input.performanceText); times.push(performance.now() - start); }
          return { coldMs, times, wasmLinearMiB: wasm ? wasm.memory.buffer.byteLength / 2 ** 20 : null, samples };
        }, { engine, input, base });
        const reference = JSON.parse(await readFile(join(cache, `${engine}.raw.json`), 'utf8'))[0].samples;
        const differences = reference.filter((sample, index) => JSON.stringify(sample) !== JSON.stringify(value.samples[index])).map(sample => sample.id);
        report.results.push({ engine, run, coldMs: value.coldMs, times: value.times, wasmLinearMiB: value.wasmLinearMiB, matchesNode: differences.length === 0, differences });
        console.log(`${engine} Chrome run ${run}: ${value.coldMs.toFixed(1)} ms init; ${differences.length} sample differences`);
      } finally { clearTimeout(deadline); await browser.close(); }
    }
  }
  await writeFile(join(root, 'scripts/analysis-lab/results/engines-browser.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.results.some(row => !row.matchesNode)) process.exitCode = 1;
} finally { await new Promise(resolveClose => server.close(resolveClose)); }
