import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import { parseArgs } from 'node:util';
import { goldCases, safetyCases, probeCases, readingCases } from './corpus';
import { schoolTokens, scoreTokens, scoreReadings, type RawToken, type SchoolToken } from './school';
import { splitJapaneseText } from '../../../app/utils/japaneseChunking';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../../..');
const cache = join(root, '.codex-dev/local-engines');
const engines = ['kuromoji-ipadic', 'lindera-ipadic', 'lindera-unidic', 'lindera-wasm-ipadic', 'lindera-wasm-unidic',
  'mecab-ipadic', 'mecab-unidic', 'sudachi-core-A', 'sudachi-core-B', 'sudachi-core-C', 'sudachi-small-A', 'vaporetto-kana', 'vaporetto-pron'];
interface Sample { id: string; raw?: RawToken[]; error?: string; }
interface WorkerResult {
  engine: string; version: string; runtime: string; dictionaryBytes: number; coldMs: number;
  rssBefore: number; rssAfterInit: number; rssAfterWarm: number; peakRss: number;
  times: number[]; stressTimes: number[]; samples: Sample[];
}
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function runWorker(engine: string, request: object): Promise<WorkerResult> {
  const node = /^(kuromoji|lindera)/u.test(engine);
  return new Promise((resolveWorker, reject) => {
    const child = spawn(node ? process.execPath : join(cache, 'venv/bin/python'), [join(directory, node ? 'worker.mjs' : 'worker.py')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    // Decode across pipe chunks; Buffer.toString per chunk corrupts split Japanese.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${engine}: worker deadline`)); }, 120_000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(`${engine}: ${error.slice(-1800)}`)); return; }
      try { resolveWorker(JSON.parse(output)); } catch { reject(new Error(`${engine}: invalid worker output`)); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ...request, engine, cache }));
  });
}

export async function compareEngines(selected: string[], runs: number) {
  const long = await readFile(join(root, 'tests/fixtures/four-seasons.txt'), 'utf8');
  const chunks = splitJapaneseText(long);
  const joined = goldCases.map(c => c.text).join('\n');
  const texts = [...goldCases, ...safetyCases, ...probeCases, ...readingCases, { id: 'four-seasons', text: long }, { id: 'joined-quality', text: joined },
    ...chunks.map((chunk, i) => ({ id: `chunk-${i}`, text: chunk.text }))].map(({ id, text }) => ({ id, text }));
  await writeFile(join(cache, 'browser-input.json'), JSON.stringify({ texts, performanceText: long }));
  const report = {
    measuredAt: new Date().toISOString(), platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, node: process.version,
    runs, warmIterations: 50, stressIterations: 10, inputChars: long.length, stressChars: long.length * 20,
    corpusHash: digest({ goldCases, safetyCases, probeCases, readingCases }), goldCases: goldCases.length, safetyCases: safetyCases.length,
    methodology: 'Serial fresh processes; OS file cache not flushed. Initialization includes engine import and dictionary loading. Warm timings include native tokenization plus raw-field projection; shared school adapter measured separately. Python/Node RSS include their runtimes. Small hand-authored corpus; no general-accuracy claim. Ambiguous probes excluded from gold. No model calls.',
    engines: [] as object[], agreement: [] as object[], failures: [] as { engine: string; error: string }[],
  };
  const canonical = new Map<string, Map<string, SchoolToken[]>>();
  for (const engine of selected) {
    process.stderr.write(`Comparing ${engine}\n`);
    try {
      const workers: WorkerResult[] = [];
      for (let run = 0; run < runs; run++) workers.push(await runWorker(engine, { texts, performanceText: long, iterations: 50 }));
      // Raw samples remain in the ignored cache, never in the default metrics report.
      await writeFile(join(cache, `${engine}.raw.json`), JSON.stringify(workers));
      const normalized = new Map<string, SchoolToken[]>();
      const sourceFailures: string[] = [];
      const adaptationTimes: number[] = [];
      for (const sample of workers[0].samples) {
        try {
          if (!sample.raw || sample.error) throw new Error('engine_error');
          const text = texts.find(t => t.id === sample.id)!.text;
          normalized.set(sample.id, schoolTokens(text, sample.raw));
          if (sample.id === 'four-seasons') for (let i = 0; i < 50; i++) { const start = performance.now(); schoolTokens(text, sample.raw); adaptationTimes.push(performance.now() - start); }
        } catch { sourceFailures.push(sample.id); }
      }
      canonical.set(engine, normalized);
      const scores = goldCases.map(test => ({ id: test.id, group: test.group,
        canonicalExact: scoreTokens(normalized.get(test.id) ?? [], test.expected).exact,
        ...scoreTokens(normalized.get(test.id) ?? [], test.expected, test.readingAlternatives) }));
      const sums = scores.reduce((sum, s) => ({ expected: sum.expected + s.expected, actual: sum.actual + s.actual,
        spans: sum.spans + s.spansCorrect, pos: sum.pos + s.posCorrect, reading: sum.reading + s.readingCorrect, complete: sum.complete + s.complete }),
      { expected: 0, actual: 0, spans: 0, pos: 0, reading: 0, complete: 0 });
      let chunkOffset = 0;
      const chunkTokens = chunks.flatMap((_chunk, i) => {
        const offset = chunkOffset; chunkOffset += chunks[i].text.length;
        return (normalized.get(`chunk-${i}`) ?? []).map(t => ({ ...t, start: t.start + offset, end: t.end + offset }));
      });
      const stability = workers.every(worker => digest(worker.samples) === digest(workers[0].samples));
      // Compare each sentence in isolation against its span within a joined input.
      let offset = 0;
      const joinedTokens = normalized.get('joined-quality') ?? [];
      const contextChanged: string[] = [];
      for (const test of goldCases) {
        const start = offset; const end = start + test.text.length;
        const found = joinedTokens.filter(t => t.start >= start && t.end <= end).map(t => ({ ...t, start: t.start - start, end: t.end - start }));
        if (digest(found) !== digest(normalized.get(test.id))) contextChanged.push(test.id);
        offset = end + 1;
      }
      const quality = { casesPassed: scores.filter(s => s.exact).length, canonicalCasesPassed: scores.filter(s => s.canonicalExact).length, casesTotal: scores.length,
        spanF1: rounded(2 * sums.spans / (sums.expected + sums.actual)),
        posOnGoldSpans: rounded(sums.pos / sums.expected), readingOnGoldSpans: rounded(sums.reading / sums.expected),
        completeOnGoldSpans: rounded(sums.complete / sums.expected),
        failedIds: scores.filter(s => !s.exact).map(s => s.id), cases: scores };
      const readingScores = readingCases.map(test => ({ id: test.id, targets: scoreReadings(test.text, normalized.get(test.id) ?? [], test.targets) }));
      const readingTargets = readingScores.flatMap(test => test.targets);
      const readingQuality = { passed: readingTargets.filter(t => t.passed).length, total: readingTargets.length,
        failedIds: readingScores.filter(test => test.targets.some(t => !t.passed)).map(test => test.id), cases: readingScores };
      report.engines.push({ engine, version: workers[0].version, runtime: workers[0].runtime, dictionaryBytes: workers[0].dictionaryBytes,
        coldMsMedian: rounded(median(workers.map(w => w.coldMs))), coldMsRuns: workers.map(w => rounded(w.coldMs)),
        warmMsMedian: rounded(median(workers.flatMap(w => w.times))), warmMsP95: rounded([...workers.flatMap(w => w.times)].sort((a, b) => a - b)[Math.ceil(runs * 50 * .95) - 1]),
        stressMsMedian: rounded(median(workers.flatMap(w => w.stressTimes))), adapterMsMedian: rounded(median(adaptationTimes)),
        rssInitDeltaMiB: rounded(median(workers.map(w => (w.rssAfterInit - w.rssBefore) / 2 ** 20))),
        rssWarmMiB: rounded(median(workers.map(w => w.rssAfterWarm / 2 ** 20))), peakRssMiB: rounded(median(workers.map(w => w.peakRss / 2 ** 20))),
        sourceCasesTotal: texts.length, sourceFailures, sourcePasses: texts.length - sourceFailures.length, stableAcrossFreshProcesses: stability,
        chunkMatchesWhole: digest(chunkTokens) === digest(normalized.get('four-seasons')), contextChanged, quality, readingQuality,
      });
    } catch (error) { report.failures.push({ engine, error: String(error instanceof Error ? error.message : error) }); }
  }
  for (const [left, samples] of canonical) for (const [right, other] of canonical) {
    if (left >= right) continue;
    const ids = goldCases.map(c => c.id);
    const agree = ids.filter(id => samples.has(id) && other.has(id) && digest(samples.get(id)) === digest(other.get(id)));
    report.agreement.push({ left, right, exactGoldAgreement: agree.length, total: ids.length,
      disagreeIds: ids.filter(id => !agree.includes(id)),
      longExactAgreement: samples.has('four-seasons') && other.has('four-seasons') && digest(samples.get('four-seasons')) === digest(other.get('four-seasons')) });
  }
  return report;
}

async function main() {
  const { values } = parseArgs({ options: { engines: { type: 'string' }, runs: { type: 'string', default: '3' }, output: { type: 'string', default: 'scripts/analysis-lab/results/engines.json' } } });
  const runs = Number(values.runs);
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10) throw new Error('runs must be 1..10');
  const selected = values.engines?.split(',') ?? engines;
  if (selected.some(e => !engines.includes(e))) throw new Error('Unknown engine');
  await mkdir(cache, { recursive: true });
  const report = await compareEngines(selected, runs);
  await writeFile(resolve(root, values.output!), JSON.stringify(report, null, 2) + '\n');
  console.table(report.engines.map(value => {
    const row = value as { engine: string; coldMsMedian: number; warmMsMedian: number; rssWarmMiB: number; quality: { casesPassed: number; casesTotal: number }; sourcePasses: number; sourceCasesTotal: number };
    return { engine: row.engine, coldMs: row.coldMsMedian, warmMs: row.warmMsMedian, RSSMiB: row.rssWarmMiB, quality: `${row.quality.casesPassed}/${row.quality.casesTotal}`, source: `${row.sourcePasses}/${row.sourceCasesTotal}` };
  }));
  for (const failure of report.failures) process.stderr.write(failure.error + '\n');
  if (report.failures.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => { console.error(error); process.exitCode = 1; });
}
