import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createAnalysisSession, readOpenAIContentStream, type AnalysisDiagnosticEvent, type EndpointPayload, type TokenData } from '../../app/services/api';
import { buildCompletionPayload } from '../../app/api/_utils/providerConfig';
import { normalizeEndpointUrl, type ProviderCaps } from '../../app/lib/aiModels';
import { getResponseLanguageInstruction } from '../../app/lib/languagePrompts';
import { splitJapaneseText } from '../../app/utils/japaneseChunking';
import { toHiragana } from '../../app/utils/romaji';
import { qualityCases } from '../../tests/fixtures/analysisQuality';
import { loadLocalTokenizer, localDraft, correctionInstruction, correctionSchema, applyCorrections, type LocalDraft } from './local';

interface ExperimentConfig { endpoint: EndpointPayload; apiKey: string; }
interface Metrics {
  profile: string; caseId: string; run: number; firstTokenMs: number | null; durationMs: number;
  initialSuccess: boolean; recoveredSuccess: boolean; requests: number; outputChars: number;
  sourcePreserved: boolean; modelVerified: boolean; qualityAccuracy?: number; qualityCasesPassed?: number;
  errorCodes: string[];
}
const rounded = (value: number) => Math.round(value * 100) / 100;
const qualitySource = qualityCases.map(test => test.text).join('\n');

export function qualityScore(tokens: TokenData[]) {
  const expected = qualityCases.flatMap((test, index) => [
    ...test.expected.map(([word, pos, reading]) => ({ word, pos, reading, id: test.id })),
    ...(index < qualityCases.length - 1 ? [{ word: '\n', pos: '改行', reading: '', id: test.id }] : []),
  ]);
  const actual = new Map<string, { pos: string; reading: string }>();
  let offset = 0;
  for (const token of tokens) {
    const reading = token.pos === '記号' || token.pos === '改行' ? '' : toHiragana(token.furigana || token.word);
    actual.set(`${offset}:${offset + token.word.length}`, { pos: token.pos, reading });
    offset += token.word.length;
  }
  let cursor = 0;
  let matched = 0;
  const failed = new Set<string>();
  for (const item of expected) {
    const found = actual.get(`${cursor}:${cursor + item.word.length}`);
    if (found?.pos === item.pos && found.reading === item.reading) matched++;
    else failed.add(item.id);
    cursor += item.word.length;
  }
  return { qualityAccuracy: rounded(matched / expected.length), qualityCasesPassed: qualityCases.length - failed.size };
}

export function experimentConfig(env: Record<string, string | undefined>): ExperimentConfig {
  for (const name of ['ANALYSIS_LAB_BASE_URL', 'ANALYSIS_LAB_MODEL', 'ANALYSIS_LAB_API_KEY', 'ANALYSIS_LAB_CAPS']) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}`);
  }
  let caps: ProviderCaps;
  try {
    caps = JSON.parse(env.ANALYSIS_LAB_CAPS!);
    if (!caps || typeof caps !== 'object' || Array.isArray(caps)
      || typeof caps.thinking !== 'boolean' || !['json_schema', 'json_object'].includes(String(caps.structuredOutput))) throw new Error();
  } catch { throw new Error('ANALYSIS_LAB_CAPS must explicitly declare boolean thinking and structuredOutput'); }
  const baseUrl = env.ANALYSIS_LAB_BASE_URL!.trim();
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid experiment endpoint');
  return { endpoint: { baseUrl, model: env.ANALYSIS_LAB_MODEL!.trim(), caps }, apiKey: env.ANALYSIS_LAB_API_KEY! };
}

export async function runExperiments(args: { mode: string; text: string; runs: number; config?: ExperimentConfig }) {
  const originalFetch = globalThis.fetch;
  const config = args.config;
  const rows: Metrics[] = [];
  let tokenizer: Awaited<ReturnType<typeof loadLocalTokenizer>> | undefined;
  const coldStarted = performance.now();
  const memoryBefore = process.memoryUsage().rss;
  if (args.mode !== 'model') tokenizer = await loadLocalTokenizer();
  const localInitialization = tokenizer ? { coldLoadMs: rounded(performance.now() - coldStarted),
    rssIncreaseBytes: Math.max(0, process.memoryUsage().rss - memoryBefore) } : null;

  // Use the production scheduler/validator, adapting only its same-origin transport
  // in this isolated CLI process. No browser storage or application state is read.
  if (config) globalThis.fetch = async (url, init) => {
    if (url !== '/api/analyze') throw new Error('Unexpected experiment request');
    const body = JSON.parse(String(init?.body));
    const payload = buildCompletionPayload(config.endpoint.caps ?? {}, {
      model: config.endpoint.model, max_tokens: 8192, stream: body.stream,
      messages: [{ role: 'system', content: getResponseLanguageInstruction('zh-CN') }, { role: 'user', content: body.prompt }],
    }, { structuredOutput: 'analysisTokens', enableThinking: false });
    return originalFetch(normalizeEndpointUrl(config.endpoint.baseUrl), {
      method: 'POST', signal: init?.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(payload),
    });
  };

  const pureModel = async (profile: string, text: string, caseId: string, run: number) => {
    const started = performance.now();
    let first: number | null = null;
    const diagnostics: AnalysisDiagnosticEvent[] = [];
    const session = createAnalysisSession(text, config!.apiKey, config!.endpoint, {
      compactJson: profile !== 'current',
      chunking: profile === 'small-compact' ? { targetChars: 160, maxChars: 240, minChars: 100 } : undefined,
      onDiagnostics: event => diagnostics.push(event),
      onProgress: progress => { if (first === null && progress.tokens.length) first = rounded(performance.now() - started); },
    });
    const result = await session.run();
    const tokens = result.confirmedTokens;
    rows.push({ profile, caseId, run, firstTokenMs: first, durationMs: rounded(performance.now() - started),
      initialSuccess: result.initialSuccess && result.status === 'complete', recoveredSuccess: result.status === 'complete',
      requests: diagnostics.filter(event => event.stage === 'start').length,
      outputChars: diagnostics.filter(event => ['complete', 'error', 'cancel'].includes(event.stage)).reduce((n, event) => n + event.outputChars, 0),
      sourcePreserved: tokens.map(t => t.word).join('') === text, modelVerified: result.status === 'complete',
      errorCodes: diagnostics.flatMap(event => event.errorCode ? [event.errorCode] : []),
      ...(caseId === 'school-grammar' ? qualityScore(tokens) : {}),
    });
  };

  const local = async (text: string, caseId: string, run: number, hybrid: boolean) => {
    const started = performance.now();
    const chunks = splitJapaneseText(text);
    const drafts = chunks.map(chunk => localDraft(chunk.text, tokenizer!));
    const first = rounded(performance.now() - started);
    const tokens: TokenData[] = [];
    let outputChars = 0;
    let requests = 0;
    let verified = hybrid;
    const errorCodes: string[] = [];
    const processDraft = async (draft: LocalDraft): Promise<TokenData[]> => {
      if (!hybrid) return draft.tokens;
      requests++;
      const timeout = AbortSignal.timeout(120_000);
      try {
        const base = buildCompletionPayload(config!.endpoint.caps ?? {}, {
          model: config!.endpoint.model, max_tokens: 8192, stream: true,
          messages: [{ role: 'system', content: getResponseLanguageInstruction('zh-CN') }, { role: 'user', content: correctionInstruction(draft) }],
        }, { enableThinking: false });
        const response = await originalFetch(normalizeEndpointUrl(config!.endpoint.baseUrl), {
          method: 'POST', signal: timeout, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config!.apiKey}` },
          body: JSON.stringify({ ...base, response_format: config!.endpoint.caps?.structuredOutput !== 'json_schema' ? { type: 'json_object' }
            : { type: 'json_schema', json_schema: { name: 'analysis_corrections', strict: true, schema: correctionSchema } } }),
        });
        if (!response.ok) { void response.body?.cancel(); throw new Error('http'); }
        let content = '';
        let complete = false;
        let failure: Error | undefined;
        await readOpenAIContentStream(response, (text, done) => { content = text; complete = done; }, error => { failure = error; },
          { signal: timeout, parseWarning: '', validateFinalContent: text => applyCorrections(draft, JSON.parse(text)) });
        outputChars += content.length;
        if (failure || !complete) throw new Error('invalid_correction');
        return applyCorrections(draft, JSON.parse(content));
      } catch {
        verified = false;
        errorCodes.push(timeout.aborted ? 'timeout' : 'correction_rejected');
        return draft.tokens;
      }
    };
    let next = 0;
    const completed = Array<TokenData[]>(drafts.length);
    await Promise.all(Array.from({ length: Math.min(3, drafts.length) }, async () => {
      while (next < drafts.length) {
        const index = next++;
        completed[index] = await processDraft(drafts[index]);
      }
    }));
    tokens.push(...completed.flat());
    rows.push({ profile: hybrid ? 'local-plus-model' : 'local', caseId, run, firstTokenMs: first,
      durationMs: rounded(performance.now() - started), initialSuccess: hybrid ? verified : true,
      recoveredSuccess: hybrid ? verified : true, requests, outputChars,
      sourcePreserved: tokens.map(t => t.word).join('') === text, modelVerified: verified, errorCodes,
      ...(caseId === 'school-grammar' ? qualityScore(tokens) : {}),
    });
  };

  try {
    for (let run = 1; run <= args.runs; run++) {
      if (tokenizer) {
        await local(args.text, 'four-seasons', run, false);
        await local(qualitySource, 'school-grammar', run, false);
      }
      if (args.mode === 'model' || args.mode === 'compare') for (const profile of ['current', 'current-compact', 'small-compact']) {
        await pureModel(profile, args.text, 'four-seasons', run);
        await pureModel(profile, qualitySource, 'school-grammar', run);
      }
      if (args.mode === 'hybrid' || args.mode === 'compare') {
        await local(args.text, 'four-seasons', run, true);
        await local(qualitySource, 'school-grammar', run, true);
      }
    }
  } finally { globalThis.fetch = originalFetch; }
  return { measuredAt: new Date().toISOString(), nodeVersion: process.version, platform: process.platform, architecture: process.arch, inputChars: Array.from(args.text).length,
    engine: 'kuromoji@0.1.2 / bundled IPADIC', localInitialization, cache: 'disabled', thinking: 'disabled when declared supported',
    productionConcurrency: 3, hybridConcurrency: 3, rows,
    summary: [...new Set(rows.map(row => row.profile))].map(profile => {
      const runs = rows.filter(row => row.profile === profile && row.caseId === 'four-seasons');
      const sorted = runs.map(row => row.durationMs).sort((a, b) => a - b);
      return { profile, runs: runs.length, medianDurationMs: sorted[Math.floor(sorted.length / 2)],
        initialSuccessRate: runs.filter(row => row.initialSuccess).length / runs.length,
        finalSuccessRate: runs.filter(row => row.recoveredSuccess).length / runs.length,
        modelVerifiedRate: runs.filter(row => row.modelVerified).length / runs.length };
    }),
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    mode: { type: 'string', default: 'local' }, runs: { type: 'string', default: '3' },
    'text-file': { type: 'string', default: 'tests/fixtures/four-seasons.txt' },
    'env-file': { type: 'string', default: '.env.analysis-lab.local' },
  } });
  if (!['local', 'model', 'hybrid', 'compare'].includes(values.mode!)) throw new Error('Use --mode local|model|hybrid|compare');
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be an integer from 1 to 10');
  let config: ExperimentConfig | undefined;
  if (values.mode !== 'local') {
    if (await access(values['env-file']!).then(() => true, () => false)) process.loadEnvFile(values['env-file']!);
    config = experimentConfig(process.env);
  }
  const text = (await readFile(values['text-file']!, 'utf8')).trimEnd();
  console.log(JSON.stringify(await runExperiments({ mode: values.mode!, runs, text, config }), null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    // Only application-owned configuration errors are safe to display verbatim.
    console.error(error instanceof Error && /^(Missing ANALYSIS_LAB_|ANALYSIS_LAB_CAPS|Use --mode|--runs|Invalid experiment endpoint)/.test(error.message)
      ? error.message : 'Experiment failed; inspect the local configuration and input. No provider response was logged.');
    process.exitCode = 1;
  });
}
