import assert from 'node:assert/strict';
import './canonicalSurface.test';
import { NextRequest } from 'next/server';
import { zipSync, strToU8 } from 'fflate';
import { zipEntry } from '../scripts/local-analyzer/archive.mjs';
import { analyzeLocally, clearLocalDictionaryCache } from '../app/services/localAnalyzer';
import { applyLocalCorrections, correctionChunks, LocalCorrectionValidationError, validateLocalTokens, type LocalCorrectionErrorReason } from '../app/lib/localCorrections';
import { LocalCorrectionFormatError, localCorrectionCompletionContent, parseLocalCorrectionContent, type CorrectionFormatDetails } from '../app/lib/localCorrectionFormat';
import { createLocalCorrectionSession } from '../app/services/localCorrection';
import { AnalysisSession } from '../app/utils/analysisSession';
import { POST as correct } from '../app/api/local-analyzer/correct/route';
import { GET as dictionary } from '../app/api/local-analyzer/dictionary/[hash]/route';
import type { TokenData } from '../app/services/api';
import { createTranslator, localizeError, LOCALES } from '../app/i18n';
import { messages } from '../app/i18n/messages';
import crlfFixture from './fixtures/local-correction-crlf.json';

const token = (word: string): TokenData => ({ word, pos: '名詞', furigana: 'ねこ' });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const model = { endpoint: { baseUrl: 'https://fixture.example/v1', model: 'fixture-model', caps: { structuredOutput: 'json_schema' as const, thinking: true } }, apiKey: 'fixture-not-a-secret' };
const request = (body: object) => new NextRequest('http://localhost/api/local-analyzer/correct', { method: 'POST', headers: {
  'Content-Type': 'application/json', Authorization: 'Bearer fixture-not-a-secret' }, body: JSON.stringify({ ...model.endpoint, ...body }) });

async function main() {
  const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const diagnostics: string[] = [];
  console.warn = (...args) => {
    if (args[0] === '[local-correction-diagnostic]') diagnostics.push(String(args[1]));
    else originalWarn(...args);
  };
  const originalCode = process.env.CODE;
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    text = '';
    constructor(readonly url: string) { FakeWorker.instances.push(this); }
    postMessage(value: { text: string }) { this.text = value.text; }
    terminate() { this.terminated = true; }
    deliver(data: unknown) { this.onmessage?.({ data }); }
  }
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
  try {
    const a = new AbortController(); let partials = 0;
    const pending = analyzeLocally('猫。', { signal: a.signal, onPartial: () => partials++ });
    const old = FakeWorker.instances.at(-1)!;
    old.deliver({ type: 'partial', tokens: [token('猫')] });
    assert.equal(partials, 1);
    a.abort(); await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(old.terminated);
    old.deliver({ type: 'partial', tokens: [token('猫')] });
    assert.equal(partials, 1, 'Late worker messages cannot update a cancelled task');
    const fresh = analyzeLocally('犬', { signal: new AbortController().signal });
    const active = FakeWorker.instances.at(-1)!;
    assert.notEqual(active, old);
    active.deliver({ type: 'complete', tokens: [token('犬')] });
    assert.equal((await fresh)[0].word, '犬');
    const corrupt = analyzeLocally('犬', { signal: new AbortController().signal });
    assert.equal(FakeWorker.instances.at(-1), active, 'Completed engine is reused');
    active.deliver({ type: 'complete', tokens: [null] });
    await assert.rejects(corrupt, /本地初稿/);
    assert.ok(active.terminated);
    assert.equal(FakeWorker.instances.length, 2);
    await assert.rejects(analyzeLocally('猫'.repeat(12_001), { signal: new AbortController().signal }), /12000/);
    assert.equal(FakeWorker.instances.length, 2, 'Oversized input never allocates an engine');
    await clearLocalDictionaryCache();

    const draft = [token('猫'), { word: '。', pos: '記号', furigana: '' }]; const unchanged = JSON.stringify(draft);
    assert.equal(applyLocalCorrections('猫。', draft, { edits: [] }).map(t => t.word).join(''), '猫。');
    assert.deepEqual(applyLocalCorrections('猫。', draft, { edits: [{ sourceIds: [0], pos: '名詞', furigana: 'ネコ' }] })[0],
      { word: '猫', pos: '名詞', furigana: 'ねこ', romaji: 'neko' });
    const merged = applyLocalCorrections('静かだ。', ['静か', 'だ', '。'].map((word, index) => ({ word, pos: index === 2 ? '記号' : '名詞', furigana: index === 2 ? '' : 'しずか' })),
      { edits: [{ sourceIds: [0, 1], pos: '形容動詞', furigana: 'しずかだ' }] });
    assert.equal(merged[0].word, '静かだ');
    assert.equal(merged.map(t => t.word).join(''), '静かだ。');
    let aliases: unknown;
    const aliased = applyLocalCorrections('猫。', draft, { edits: [{ sourceIds: [0], pos: '固有名詞', furigana: 'ねこ' }] },
      { onValidated: value => { aliases = value; } });
    assert.equal(aliased[0].pos, '名詞');
    assert.deepEqual(aliases, { editCount: 1, normalizedPosAliases: 1 });
    const invalidCorrections: [unknown, LocalCorrectionErrorReason][] = [
      [{}, 'invalid_edits'], [{ edits: [null] }, 'invalid_edit'], [{ edits: [null, null, null] }, 'too_many_edits'],
      [{ edits: [{ sourceIds: [], pos: '名詞', furigana: '' }] }, 'invalid_source_ids'],
      [{ edits: [{ sourceIds: [0.5], pos: '名詞', furigana: '' }] }, 'invalid_source_ids'],
      [{ edits: [{ sourceIds: [2], pos: '名詞', furigana: '' }] }, 'out_of_bounds'],
      [{ edits: [{ sourceIds: [1, 0], pos: '名詞', furigana: '' }] }, 'non_contiguous_ids'],
      [{ edits: [{ sourceIds: [0, 0], pos: '名詞', furigana: '' }] }, 'non_contiguous_ids'],
      [{ edits: [{ sourceIds: [0], pos: 'noun', furigana: 'ねこ' }] }, 'invalid_pos'],
      [{ edits: [{ sourceIds: [0], pos: '名詞', furigana: 'cat' }] }, 'invalid_reading'],
      [{ edits: [{ sourceIds: [1], pos: '記号', furigana: 'まる' }] }, 'invalid_reading'],
      [{ edits: [{ sourceIds: [0], pos: '名詞', furigana: '', word: '犬' }] }, 'unexpected_field'],
      [{ edits: [{ sourceIds: [0], pos: '名詞', furigana: '' }, { sourceIds: [0], pos: '名詞', furigana: '' }] }, 'overlapping_source_ids'],
    ];
    for (const [value, reason] of invalidCorrections) assert.throws(() => applyLocalCorrections('猫。', draft, value), error => {
      assert.ok(error instanceof LocalCorrectionValidationError); assert.equal(error.details.reason, reason); return true;
    });
    assert.equal(JSON.stringify(draft), unchanged, 'Rejected patches never mutate the draft');
    assert.equal(applyLocalCorrections('まるて\u3099。', [token('まるて\u3099'), { word: '。', pos: '記号', furigana: '' }],
      { edits: [{ sourceIds: [0], pos: '副詞', furigana: 'まるで' }] })[0].word, 'まるて\u3099', 'Protocol never rewrites NFD source');
    const crlfDraft: TokenData[] = crlfFixture.words.map(word => ({ word, pos: /^\s+$/u.test(word) ? '改行' : '名詞', furigana: '' }));
    assert.equal(crlfDraft.map(t => t.word).join(''), crlfFixture.source);
    const preserved = applyLocalCorrections(crlfFixture.source, crlfDraft, { edits: [{ sourceIds: [39, 40, 41], pos: '動詞', furigana: 'はこんでき' }] });
    assert.equal(preserved.map(t => t.word).join(''), crlfFixture.source);
    const indexedDraft = ['日', '本', '語', 'の', '勉', '強'].map(token);
    assert.deepEqual(applyLocalCorrections('日本語の勉強', indexedDraft, { edits: [
      { sourceIds: [0, 1], pos: '名詞', furigana: 'にほん' }, { sourceIds: [4, 5], pos: '名詞', furigana: 'べんきょう' },
    ] }).map(t => t.word), ['日本', '語', 'の', '勉強']);

    // The new screenshot was a SyntaxError: JSON wrappers and malformed JSON
    // are distinct from invalid edit indices. Never manufacture missing JSON.
    const json = JSON.stringify({ edits: [{ sourceIds: [0], pos: '名詞', furigana: 'ねこ' }] });
    for (const [content, format] of [[json, 'json'], [` \ufeff${json}\n`, 'json'],
      ['```json\n' + json + '\n```', 'fenced_json'], ['```JSON\r\n' + json + '\r\n```', 'fenced_json'],
      ['```\n' + json + '\n```', 'fenced_json']] as const) {
      const parsed = parseLocalCorrectionContent(content);
      assert.deepEqual(parsed.value, JSON.parse(json));
      assert.equal(parsed.format, format);
      assert.equal(applyLocalCorrections('猫。', draft, parsed.value).map(t => t.word).join(''), '猫。');
    }
    const complex = { edits: [{ sourceIds: [0], pos: '名詞', furigana: 'ねこ' }] };
    assert.deepEqual(parseLocalCorrectionContent(JSON.stringify(complex)).value, complex, 'Do not strip or rewrite JSON string contents');
    const malformed: [unknown, CorrectionFormatDetails['reason']][] = [
      ['', 'empty_content'], [null, 'empty_content'], ['{"edits":[', 'incomplete_json'],
      ['{"edits":[{"word":"private-output-sentinel', 'incomplete_json'],
      ['{"edits":[],}', 'invalid_json'], ['{"edits":[...]}', 'invalid_json'],
      ['{"edits":[]} {"edits":[]}', 'invalid_json'],
      ['说明：' + json, 'non_json_content'], [json + '\n说明', 'invalid_json'],
      ['<think>private-output-sentinel</think>\n' + json, 'reasoning_in_content'],
      ['```json\n' + json, 'non_json_content'],
      ['```json\n' + json + '\n```\n解释', 'non_json_content'],
      ['```json\n' + json + '\n```\n```json\n' + json + '\n```', 'invalid_json'],
      ["{'edits': []}", 'invalid_json'], ['{"edits": /* no comments */ []}', 'invalid_json'],
    ];
    for (const [content, reason] of malformed) assert.throws(() => parseLocalCorrectionContent(content), error => {
      assert.ok(error instanceof LocalCorrectionFormatError);
      assert.equal(error.details.stage, 'model_content');
      assert.equal(error.details.reason, reason);
      assert.ok(!JSON.stringify(error.details).includes('private-output-sentinel'));
      assert.ok(!error.message.includes('private-output-sentinel'));
      for (const locale of LOCALES.filter(l => l !== 'zh-CN')) assert.notEqual(localizeError(error.message, locale), error.message);
      return true;
    });
    for (const [reason, expected] of [['length', 'truncated'], ['content_filter', 'content_filter'], [undefined, 'missing_finish'], ['tool_calls', 'abnormal_finish']] as const) {
      assert.throws(() => localCorrectionCompletionContent({ choices: [{ finish_reason: reason, message: { content: '```json\n' + json + '\n```' } }] }), error =>
        error instanceof LocalCorrectionFormatError && error.details.stage === 'completion' && error.details.reason === expected);
    }
    assert.throws(() => validateLocalTokens('猫。', [token('猫')]));
    const source = '猫。'.repeat(400);
    const input = Array.from({ length: 400 }, () => token('猫。'));
    const chunks = correctionChunks(source, input);
    assert.equal(chunks.map(c => c.text).join(''), source);
    assert.ok(chunks.every(c => c.start % 2 === 0 && c.end % 2 === 0));
    assert.ok(chunks.every(c => c.text.normalize('NFC').length <= 180));
    assert.throws(() => new AnalysisSession('猫', async () => [], { sourceChunks: [{ start: 1, end: 2, text: '猫', sentenceCount: 1, overLimit: false }] }));

    // Same three-request scheduler, with one automatic split/retry round.
    const counts = new Map<string, number>(); let failing = true;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const key = body.source;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (failing && key.includes('犬')) return Response.json({ error: { message: 'fixture failure' } }, { status: 502 });
      return Response.json({ tokens: body.tokens });
    };
    const initial = [token('猫。'), token('犬。'), token('鳥。')].flatMap((t, i) => [
      ...Array.from({ length: 200 }, () => ({ ...t })), ...(i < 2 ? [{ word: '\n', pos: '改行', furigana: '' }] : []),
    ]);
    const multi = initial.map(t => t.word).join('');
    const session = createLocalCorrectionSession(multi, initial, model, { signal: new AbortController().signal, thinkingEnabled: false, onProgress() {} });
    const failed = await session.run();
    assert.equal(failed.status, 'failed');
    assert.ok(failed.chunks.some(c => c.status === 'complete'));
    assert.ok([...counts.values()].some(n => n > 1), 'Failed corrections receive one bounded automatic recovery');
    const completedKeys = failed.chunks.filter(chunk => chunk.status === 'complete').map(chunk => multi.slice(chunk.start, chunk.end));
    const completedCounts = new Map(completedKeys.map(key => [key, counts.get(key)]));
    failing = false;
    assert.equal((await session.retryFailed()).status, 'complete');
    assert.ok(completedKeys.every(key => counts.get(key) === completedCounts.get(key)), 'Manual retry reuses completed blocks');
    const controller = new AbortController();
    globalThis.fetch = async () => new Promise(() => {});
    const cancelled = createLocalCorrectionSession('猫', [token('猫')], model, { signal: controller.signal, thinkingEnabled: false, onProgress() {} });
    const running = cancelled.run(); await tick(); controller.abort();
    assert.equal((await running).status, 'cancelled', 'Cancellation settles even if transport ignores abort');
    const originalTimeout = AbortSignal.timeout;
    try {
      AbortSignal.timeout = () => {
        const deadline = new AbortController();
        queueMicrotask(() => deadline.abort(new DOMException('signal timed out', 'TimeoutError')));
        return deadline.signal;
      };
      const timedOut = createLocalCorrectionSession('猫', [token('猫')], model, { signal: new AbortController().signal, thinkingEnabled: false, onProgress() {} });
      const result = await timedOut.run();
      assert.equal(result.status, 'failed');
      assert.equal(result.chunks[0].errorCode, 'timeout');
      assert.equal(result.chunks[0].error?.message, '解析请求超时，请重试。');
    } finally { AbortSignal.timeout = originalTimeout; }

    globalThis.fetch = async () => new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } });
    const invalidEnvelope = createLocalCorrectionSession('猫', [token('猫')], model, { signal: new AbortController().signal, thinkingEnabled: false, onProgress() {} });
    const invalidEnvelopeResult = await invalidEnvelope.run();
    assert.equal(invalidEnvelopeResult.status, 'failed');
    assert.equal(invalidEnvelopeResult.chunks[0].errorCode, 'invalid_response');
    assert.doesNotMatch(invalidEnvelopeResult.chunks[0].error?.message ?? '', /Unexpected token/);

    // Auth, provider settings, strict terminal validation and atomic source checks.
    process.env.CODE = 'fixture-code'; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('Unauthorized request must not call provider'); };
    assert.equal((await correct(request({ source: '猫。', tokens: draft }))).status, 401);
    assert.equal((await dictionary(new NextRequest('http://localhost/api/local-analyzer/dictionary/invalid'), { params: Promise.resolve({ hash: 'invalid' }) })).status, 401);
    delete process.env.CODE;
    assert.equal((await correct(request({ source: '猫。', tokens: [token('犬')] }))).status, 400);
    assert.equal(calls, 0);
    assert.equal((await dictionary(new NextRequest('http://localhost/api/local-analyzer/dictionary/invalid'), { params: Promise.resolve({ hash: '../private' }) })).status, 404);
    for (const [reason, content, status] of [
      ['stop', { edits: [] }, 200], ['length', { edits: [] }, 502], [undefined, { edits: [] }, 502],
      ['stop', { edits: [{ sourceIds: [0], pos: 'noun', furigana: 'ねこ' }] }, 502],
    ] as const) {
      globalThis.fetch = async (_url, init) => {
        calls++; const payload = JSON.parse(String(init?.body));
        assert.equal(payload.max_tokens, 8192); assert.equal(payload.stream, false);
        assert.deepEqual(payload.thinking, { type: 'disabled' });
        assert.equal(payload.response_format.json_schema.name, 'japanese_local_corrections');
        const input = JSON.parse(payload.messages[1].content);
        assert.equal(input.protocolVersion, 2);
        assert.equal(input.targetTokenCount, draft.length);
        assert.deepEqual(input.targetTokens.map((t: { id: number }) => t.id), [0, 1]);
        assert.match(payload.messages[0].content, /不要返回 word、tokens、from、to/);
        const editSchema = payload.response_format.json_schema.schema.properties.edits.items.properties;
        assert.match(editSchema.sourceIds.description, /0-based IDs/);
        assert.ok(editSchema.pos.enum.includes('固有名詞'));
        assert.equal(editSchema.word, undefined);
        return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: reason }] });
      };
      const response = await correct(request({ source: '猫。', tokens: draft, thinkingEnabled: false }));
      assert.equal(response.status, status);
      const result = await response.json();
      if (status === 200) assert.equal(result.tokens.map((t: TokenData) => t.word).join(''), '猫。');
      else assert.equal(result.tokens, undefined);
    }
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ edits: [{ sourceIds: [0], pos: '名詞', furigana: 'ねこ' }] }),
    } }] });
    const repair = await correct(request({ source: '猫。', tokens: draft, chunkContext: { start: 181, end: 183, index: 1, attempt: 2 } }));
    assert.equal(repair.status, 200);
    assert.equal((await repair.json()).tokens.map((t: TokenData) => t.word).join(''), '猫。');
    const repairLog = JSON.parse(diagnostics.at(-1)!);
    assert.equal(repairLog.protocolVersion, 2);
    assert.deepEqual(repairLog.chunk, { start: 181, end: 183, index: 1, attempt: 2 });
    assert.equal(repairLog.schemaFingerprint, 'local-correction-source-ids-v2');
    const nfdDraft = [token('まるて\u3099'), token('美しい')];
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ edits: [
      { sourceIds: [0], pos: '副詞', furigana: 'まるで' },
    ] }) } }] });
    const unicodeResponse = await correct(request({ source: 'まるて\u3099美しい', tokens: nfdDraft }));
    assert.equal(unicodeResponse.status, 200);
    assert.equal((await unicodeResponse.json()).tokens.map((t: TokenData) => t.word).join(''), 'まるて\u3099美しい');
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ edits: [
      { sourceIds: [39, 40, 41], pos: '動詞', furigana: 'はこんでき' },
    ] }) } }] });
    const repairedCRLF = await correct(request({ source: crlfFixture.source, tokens: crlfDraft, chunkContext: { start: 0, end: 184, index: 0, attempt: 1 } }));
    assert.equal(repairedCRLF.status, 200);
    assert.equal((await repairedCRLF.json()).tokens.map((t: TokenData) => t.word).join(''), crlfFixture.source);
    const closedLog = JSON.parse(diagnostics.at(-1)!);
    assert.equal(closedLog.outcome, 'accepted');
    assert.equal(closedLog.tokenCount, 118);
    assert.equal(closedLog.inputChars, 184);
    assert.equal(closedLog.protocolVersion, 2);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ edits: [
      { sourceIds: [39, 42], pos: '動詞', furigana: 'はこんでくる' },
    ] }) } }] });
    const rejectedCRLF = await correct(request({ source: crlfFixture.source, tokens: crlfDraft }));
    assert.equal(rejectedCRLF.status, 502);
    const rejectedCRLFBody = await rejectedCRLF.json();
    assert.equal(rejectedCRLFBody.tokens, undefined);
    assert.equal(rejectedCRLFBody.error.details.reason, 'non_contiguous_ids');
    assert.equal(rejectedCRLFBody.error.details.editIndex, 0);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ edits: [{ sourceIds: [185], pos: '名詞', furigana: 'ひみつ' }] }),
    } }] });
    const outOfBounds = await correct(request({ source: '猫。', tokens: draft }));
    assert.equal(outOfBounds.status, 502);
    const rejected = await outOfBounds.json();
    assert.deepEqual(rejected.error.details, { reason: 'out_of_bounds', tokenCount: 2, editCount: 1, editIndex: 0, invalidId: 185 });
    assert.equal(rejected.error.code, 'local_protocol_invalid');
    assert.match(rejected.error.message, /共 2 个词项/);
    const rejectLog = JSON.parse(diagnostics.at(-1)!);
    assert.equal(rejectLog.reason, 'out_of_bounds');
    assert.equal(rejectLog.finishReason, 'stop');
    assert.equal(rejectLog.tokenCount, 2);
    assert.ok(rejectLog.outputChars > 0);
    for (const secret of ['private-output-sentinel', 'fixture-not-a-secret', 'fixture.example', '猫', 'ねこ']) assert.ok(!diagnostics.join('\n').includes(secret));

    // Exercise raw HTTP envelope errors separately from JSON in message.content.
    for (const [raw, reason, stage] of [
      ['<html>private-output-sentinel</html>', 'invalid_upstream_json', 'upstream_response'],
      ['data: {"choices":[]}\n\n', 'invalid_upstream_json', 'upstream_response'],
      ['', 'invalid_upstream_json', 'upstream_response'],
      [JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"edits":[...' } }] }), 'incomplete_json', 'model_content'],
      [JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '```json\n' + json } }] }), 'non_json_content', 'model_content'],
      [JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '' } }] }), 'empty_content', 'model_content'],
      [JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '```json\n' + json + '\n```' } }] }), 'truncated', 'completion'],
    ] as const) {
      globalThis.fetch = async () => new Response(raw, { status: 200, headers: { 'Content-Type': 'application/json' } });
      const response = await correct(request({ source: '猫。', tokens: draft }));
      assert.equal(response.status, 502);
      const result = await response.json();
      assert.equal(result.tokens, undefined);
      assert.equal(result.error.code, reason);
      assert.equal(result.error.details.stage, stage);
      assert.equal(result.error.details.reason, reason);
      const diagnostic = JSON.parse(diagnostics.at(-1)!);
      assert.equal(diagnostic.stage, stage);
      assert.equal(diagnostic.reason, reason);
      assert.equal(diagnostic.upstreamChars, raw.length);
      assert.equal(diagnostic.requestedFormat, 'json_schema');
    }
    for (const structuredOutput of ['json_schema', 'json_object'] as const) {
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.response_format.type, structuredOutput);
        assert.doesNotMatch(payload.messages[0].content, /\[\.\.\.\]/);
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '```json\n' + json + '\n```', reasoning_content: 'private-reasoning-sentinel' } }] });
      };
      const response = await correct(request({ source: '猫。', tokens: draft, caps: { ...model.endpoint.caps, structuredOutput } }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).tokens.map((t: TokenData) => t.word).join(''), '猫。');
      const diagnostic = JSON.parse(diagnostics.at(-1)!);
      assert.equal(diagnostic.outcome, 'accepted');
      assert.equal(diagnostic.wrapper, 'fenced_json');
      assert.equal(diagnostic.requestedFormat, structuredOutput);
      assert.equal(diagnostic.reasoningChars, 'private-reasoning-sentinel'.length);
    }
    // Wrapper compatibility cannot bypass a bad edit or an abnormal finish.
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
      content: '```json\n' + JSON.stringify({ edits: [{ sourceIds: [0], pos: 'noun', furigana: 'ねこ' }] }) + '\n```',
    } }] });
    const badFencedEdit = await correct(request({ source: '猫。', tokens: draft }));
    assert.equal(badFencedEdit.status, 502);
    assert.equal((await badFencedEdit.json()).error.details.reason, 'invalid_pos');
    for (const secret of ['private-output-sentinel', 'private-reasoning-sentinel', 'fixture-not-a-secret', 'fixture.example', '猫', 'ねこ']) assert.ok(!diagnostics.join('\n').includes(secret));

    // Exercise the real service -> route -> patch validation chain with a mock
    // provider. A failed chunk stays failed; retry never reissues good chunks.
    const providerCounts = new Map<string, number>(); let providerFails = true;
    globalThis.fetch = async (url, init) => {
      if (String(url) === '/api/local-analyzer/correct') return correct(new NextRequest('http://localhost/api/local-analyzer/correct', {
        method: 'POST', headers: init?.headers, body: String(init?.body), signal: init?.signal ?? undefined,
      }));
      const payload = JSON.parse(String(init?.body));
      const data = JSON.parse(payload.messages[1].content);
      const text = data.targetSource;
      providerCounts.set(text, (providerCounts.get(text) ?? 0) + 1);
      assert.equal(data.targetTokens[0].id, 0);
      assert.equal(data.targetTokens.at(-1).id, data.targetTokenCount - 1);
      assert.ok(data.targetTokenCount <= 80);
      assert.ok(data.contextBefore.normalize('NFC').length <= 120);
      assert.ok(data.contextAfter.normalize('NFC').length <= 120);
      const content = providerFails && text.includes('犬') ? '{"edits":['
        : '```json\n' + JSON.stringify({ edits: [] }) + '\n```';
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content } }] });
    };
    const integrated = createLocalCorrectionSession(multi, initial, model, { signal: new AbortController().signal, thinkingEnabled: false, onProgress() {} });
    const integratedFailure = await integrated.run();
    assert.equal(integratedFailure.status, 'failed');
    assert.ok(integratedFailure.chunks.filter(c => c.status === 'failed').every(c => c.error?.message.includes('JSON 不完整')));
    const failedIds = new Set(integratedFailure.chunks.filter(c => c.status === 'failed').map(c => c.id));
    const requestsBeforeManualRetry = [...providerCounts.values()].reduce((sum, count) => sum + count, 0);
    assert.ok(integratedFailure.chunks.some(chunk => chunk.status === 'complete'));
    providerFails = false;
    const integratedSuccess = await integrated.retryFailed();
    assert.equal(integratedSuccess.status, 'complete');
    assert.equal(integratedSuccess.confirmedTokens.map(t => t.word).join(''), multi);
    assert.equal([...providerCounts.values()].reduce((sum, count) => sum + count, 0) - requestsBeforeManualRetry, failedIds.size,
      'Manual retry requests only failed leaf chunks');
    for (const chunk of integratedSuccess.chunks) assert.equal(chunk.attempt, failedIds.has(chunk.id) ? 2 : 1);
    const archive = Buffer.from(zipSync({ 'dict/system.dic': strToU8('fixture dictionary') }));
    assert.ok(zipEntry(archive, 'dict/system.dic', 18).length);
    assert.throws(() => zipEntry(archive.subarray(0, 12), 'dict/system.dic', 18));
    assert.throws(() => zipEntry(archive, 'missing', 18));
    assert.throws(() => zipEntry(archive, 'dict/system.dic', 100));
    for (const locale of LOCALES.filter(l => l !== 'zh-CN')) for (const key of ['本地解析', '用模型校正', '本地初稿：读音和词性尚未经过模型校正。'] as const) {
      assert.ok(messages[key][locale]);
      if (locale === 'en' || locale === 'ko') assert.notEqual(createTranslator(locale)(key), key);
    }
    console.log('Local browser analysis passed: worker cancellation/reuse, source fidelity, atomic correction, failed-only retries, auth, provider controls, bounded archives and locales.');
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    if (originalCode === undefined) delete process.env.CODE; else process.env.CODE = originalCode;
    await clearLocalDictionaryCache();
    if (workerDescriptor) Object.defineProperty(globalThis, 'Worker', workerDescriptor); else Reflect.deleteProperty(globalThis, 'Worker');
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
