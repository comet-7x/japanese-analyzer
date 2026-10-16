import assert from 'node:assert/strict';
import { AnalysisSession, splitRecoveryChunk, type AnalysisProgress } from '../app/utils/analysisSession';
import { analyzeSentence, createAnalysisSession, type AnalysisDiagnosticEvent } from '../app/services/api';
import { AnalysisValidationError, ApiRequestError } from '../app/utils/requestErrors';
import { splitJapaneseText } from '../app/utils/japaneseChunking';

const endpoint = { baseUrl: 'https://private.example', model: 'test-model', caps: { thinking: true } };
const token = (word: string) => ({ word, pos: '記号', furigana: '' });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const response = (content: string, stream: boolean, reason = 'stop', terminal = true) => stream
  ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: reason || undefined }] })}\n\n${terminal ? 'data: [DONE]\n\n' : ''}`)
  : Response.json({ choices: [{ message: { content }, finish_reason: reason || undefined }] });

export async function runAnalysisRecoveryTests() {
  const originalFetch = globalThis.fetch;
  const source = '猫が窓の外を見ている。\n今日は晴れです。';
  try {
    for (const stream of [false, true]) {
      for (const failure of ['invalid_json', 'invalid_tokens', 'source_mismatch', 'truncated', ...(stream ? ['interrupted'] : [])]) {
        let requests = 0;
        const diagnostics: AnalysisDiagnosticEvent[] = [];
        globalThis.fetch = async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.thinkingEnabled, false);
          const text = JSON.parse(body.prompt.match(/待解析句子.*： (.*)$/u)[1]);
          const content = ++requests === 1
            ? failure === 'invalid_json' ? JSON.stringify({ tokens: [token(text)] }).slice(0, -2) : failure === 'invalid_tokens' ? '{"tokens":[{"word":"猫"}]}'
              : failure === 'source_mismatch' ? JSON.stringify({ tokens: [token('誤字')] }) : JSON.stringify({ tokens: [token(text)] })
            : JSON.stringify({ tokens: [token(text)] });
          return response(content, stream, requests === 1 && failure === 'truncated' ? 'length'
            : requests === 1 && failure === 'interrupted' ? '' : 'stop', !(requests === 1 && failure === 'interrupted'));
        };
        const progress: AnalysisProgress[] = [];
        const session = createAnalysisSession(source, 'private-key', endpoint, { stream, onDiagnostics: event => diagnostics.push(event), onProgress: value => progress.push(value) });
        const result = await session.run();
        assert.equal(result.status, 'complete', `${stream}/${failure}`);
        assert.equal(result.initialSuccess, false);
        if (stream && failure === 'invalid_json') {
          const tentative = progress.findIndex(value => value.tokens.map(token => token.word).join('') === source && value.status === 'running');
          assert.ok(tentative >= 0, 'A complete token may arrive before its JSON frame validates');
          assert.ok(progress.slice(tentative + 1).some(value => value.tokens.length === 0), 'Failed provisional tokens must be withdrawn before recovery');
        }
        assert.equal(result.tokens.map(t => t.word).join(''), source);
        assert.equal(requests, 3, 'One recovery round splits at the closest legal sentence boundary');
        assert.equal(diagnostics.find(event => event.stage === 'error')?.errorCode, failure);
        const safe = JSON.stringify(diagnostics);
        assert.ok(!safe.includes(source) && !safe.includes('private-key') && !safe.includes(endpoint.baseUrl));
        if (failure === 'truncated') assert.ok(diagnostics.find(event => event.stage === 'error')!.outputChars > 0, 'Truncated responses still report their output volume');
        if (failure === 'source_mismatch') assert.equal(diagnostics.find(event => event.stage === 'error')?.mismatchOffset, 0);
      }
    }

    // An atomic long sentence cannot be recursively split or endlessly retried.
    let requests = 0;
    const atomic = 'あ'.repeat(500);
    globalThis.fetch = async () => { requests++; return response('{', false); };
    await assert.rejects(analyzeSentence(atomic, undefined, endpoint), error => error instanceof AnalysisValidationError && error.code === 'invalid_json');
    assert.equal(requests, 2);
    for (const status of [400, 401, 403]) {
      requests = 0;
      globalThis.fetch = async () => { requests++; return new Response('{}', { status }); };
      await assert.rejects(analyzeSentence(source, undefined, endpoint), error => error instanceof ApiRequestError && error.status === status);
      assert.equal(requests, 1);
    }
    requests = 0;
    globalThis.fetch = async () => { requests++; return response('{}', false, 'content_filter'); };
    await assert.rejects(analyzeSentence(source, undefined, endpoint), error => error instanceof AnalysisValidationError && error.code === 'content_filter');
    assert.equal(requests, 1);

    // Real timeout cancels fetch, has a distinct category, and does not retry.
    let timeoutSignal: AbortSignal | null | undefined;
    requests = 0;
    globalThis.fetch = async (_url, init) => {
      requests++; timeoutSignal = init?.signal;
      return new Promise(() => {}); // A transport ignoring abort must not hang the run.
    };
    const timedOut = createAnalysisSession(source, undefined, endpoint, { requestTimeoutMs: 5 });
    const timeoutResult = await timedOut.run();
    assert.equal(timeoutResult.chunks[0].errorCode, 'timeout');
    assert.equal(timeoutSignal?.aborted, true);
    assert.equal(requests, 1);

    for (const text of ['猫。\n犬。', '「猫。犬。」\n鳥。', '😀猫。\n次。', 'a'.repeat(500)]) {
      const chunk = splitJapaneseText(text)[0];
      const split = splitRecoveryChunk(chunk);
      assert.equal(split.map(c => c.text).join(''), chunk.text);
      assert.equal(split[0].start, chunk.start);
      assert.equal(split.at(-1)?.end, chunk.end);
    }

    // A failure must not discard/cancel successful later chunks. Manual retry
    // uses only the failed leaf, and does not acquire another automatic round.
    const article = `${'今日は晴れです。'.repeat(30)}\n${'明日は雨です。'.repeat(35)}`;
    const chunks = splitJapaneseText(article);
    let allowFailed = false;
    const calls: string[] = [];
    const snapshots: AnalysisProgress[] = [];
    const retained = new AnalysisSession(article, async (chunk, _context, signal) => {
      calls.push(chunk.text);
      assert.equal(signal.aborted, false);
      if (chunk.start === 0 && !allowFailed) throw new AnalysisValidationError('invalid_json');
      return [token(chunk.text)];
    }, { onProgress: progress => snapshots.push(progress) });
    const failed = await retained.run();
    assert.equal(failed.status, 'failed');
    assert.equal(failed.tokens.length, 0, 'Later validated chunks wait behind the first failed gap');
    assert.ok(failed.chunks.some(c => c.status === 'complete'));
    const before = calls.length;
    allowFailed = true;
    const fixed = await retained.retryFailed();
    assert.equal(fixed.status, 'complete');
    assert.equal(calls.length, before + 1);
    assert.equal(fixed.tokens.map(t => t.word).join(''), article);
    for (const snapshot of snapshots) assert.ok(article.startsWith(snapshot.tokens.map(t => t.word).join('')));
    assert.ok(chunks.length >= 2);

    const threeChunkText = '今日は晴れです。'.repeat(100);
    const threeChunkSource = splitJapaneseText(threeChunkText);
    assert.ok(threeChunkSource.length >= 3);
    let repairMiddle = false;
    const requestedRanges: string[] = [];
    const middleFailure = new AnalysisSession(threeChunkText, async (chunk, context) => {
      requestedRanges.push(context.id);
      if (context.rootIndex === 1 && !repairMiddle) throw new AnalysisValidationError('source_mismatch');
      return [token(chunk.text)];
    });
    const middleResult = await middleFailure.run();
    assert.equal(middleResult.tokens.map(token => token.word).join(''), threeChunkSource[0].text);
    assert.ok(middleResult.chunks.some(chunk => chunk.rootIndex > 1 && chunk.status === 'complete'));
    const failedCount = middleResult.chunks.filter(chunk => chunk.status === 'failed').length;
    const beforeManualFailure = requestedRanges.length;
    await middleFailure.retryFailed();
    assert.equal(requestedRanges.length, beforeManualFailure + failedCount, 'A failed manual attempt must not start another automatic recovery round');
    repairMiddle = true;
    const beforeManualSuccess = requestedRanges.length;
    assert.equal((await middleFailure.retryFailed()).tokens.map(token => token.word).join(''), threeChunkText);
    assert.equal(requestedRanges.length, beforeManualSuccess + failedCount);

    // Abort while recovery requests are active, then release a provider ignoring
    // cancellation. Neither late token updates nor more recoveries may appear.
    const late: Array<{ source: string; signal: AbortSignal; resolve: (response: Response) => void }> = [];
    let recoveryRequests = 0;
    const recoveryUpdates: AnalysisProgress[] = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const source = JSON.parse(body.prompt.match(/待解析句子.*： (.*)$/u)[1]);
      if (++recoveryRequests === 1) return response('{', false);
      return new Promise(resolve => late.push({ source, signal: init!.signal!, resolve }));
    };
    const recovering = createAnalysisSession(source, undefined, endpoint, { stream: false, onProgress: progress => recoveryUpdates.push(progress) });
    const recoveryTask = recovering.run();
    await tick();
    assert.equal(late.length, 2);
    recovering.cancel();
    assert.equal((await recoveryTask).status, 'cancelled');
    const afterRecoveryCancel = recoveryUpdates.length;
    late.forEach(item => {
      assert.equal(item.signal.aborted, true);
      item.resolve(response(JSON.stringify({ tokens: [token(item.source)] }), false));
    });
    await tick();
    assert.equal(recoveryUpdates.length, afterRecoveryCancel);
    assert.equal(recoveryRequests, 3);

    // Same bounded pool for both modes is exercised through their request flags.
    for (const stream of [true, false]) {
      const resolvers: Array<() => void> = [];
      let active = 0; let maximum = 0;
      const long = '今日は晴れです。'.repeat(160);
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.stream, stream);
        const text = JSON.parse(body.prompt.match(/待解析句子.*： (.*)$/u)[1]);
        active++; maximum = Math.max(maximum, active);
        await new Promise<void>(resolve => resolvers.push(resolve));
        active--;
        return response(JSON.stringify({ tokens: [token(text)] }), stream);
      };
      const session = createAnalysisSession(long, undefined, endpoint, { stream });
      const pending = session.run();
      await tick(); assert.equal(active, 3);
      while (session.getSnapshot().status === 'running') {
        resolvers.splice(0).forEach(resolve => resolve());
        await tick();
      }
      assert.equal((await pending).status, 'complete');
      assert.equal(maximum, 3);
    }

    // User cancellation prevents queued recoveries and ignores late transport data.
    const releases: Array<() => void> = [];
    const cancelledUpdates: AnalysisProgress[] = [];
    const cancelled = new AnalysisSession(article, async chunk => {
      await new Promise<void>(resolve => { releases.push(resolve); });
      return [token(chunk.text)];
    }, { onProgress: progress => cancelledUpdates.push(progress), chunking: { targetChars: 1000, maxChars: 1000 } });
    const cancelledTask = cancelled.run();
    cancelled.cancel();
    const afterCancel = cancelledUpdates.length;
    releases.forEach(release => release());
    assert.equal((await cancelledTask).status, 'cancelled');
    assert.equal(cancelledUpdates.length, afterCancel);
    assert.equal(cancelled.getSnapshot().tokens.length, 0);
  } finally { globalThis.fetch = originalFetch; }
}
