import assert from 'node:assert/strict';
import { streamAnalyzeSentence, type AnalysisDiagnosticEvent, type TokenData } from '../app/services/api';
import { splitJapaneseText } from '../app/utils/japaneseChunking';

const endpoint = { baseUrl: 'https://private-provider.example', model: 'test-model', caps: { thinking: true } };
const encoder = new TextEncoder();
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
const token = (word: string) => ({ word, pos: '記号', furigana: '' });
const event = (content: string) => encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);

export async function runAnalysisStreamingTests() {
  const source = `${'今日は晴れです。'.repeat(25)}\n${'明日は雨です。'.repeat(40)}`;
  const chunks = splitJapaneseText(source);
  assert.ok(chunks.length >= 2 && chunks.length <= 3);
  const originalFetch = globalThis.fetch;
  const streams: Array<{ controller: ReadableStreamDefaultController<Uint8Array>; cancelled: boolean }> = [];
  const events: Array<{ tokens: TokenData[]; done: boolean }> = [];
  const errors: Error[] = [];
  const diagnostics: AnalysisDiagnosticEvent[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.thinkingEnabled, false);
      assert.equal(body.caps.thinking, true);
      const request = { controller: null as unknown as ReadableStreamDefaultController<Uint8Array>, cancelled: false };
      streams.push(request);
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { request.controller = controller; },
        cancel() { request.cancelled = true; },
      }));
    };

    const pending = streamAnalyzeSentence(source, (content, done) => {
      events.push({ tokens: JSON.parse(content).tokens, done });
    }, error => errors.push(error), 'sk-private', endpoint, { onDiagnostics: event => diagnostics.push(event) });
    await pause();
    assert.equal(streams.length, chunks.length, 'Chunks start concurrently');

    // A later chunk finishing first must not jump over the unfinished source prefix.
    streams.slice(1).forEach((stream, index) => {
      stream.controller.enqueue(event(JSON.stringify({ tokens: [token(chunks[index + 1].text)] })));
      stream.controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      stream.controller.close();
    });
    await pause();
    assert.equal(events.length, 0);

    const firstObject = `{"tokens":[${JSON.stringify(token(chunks[0].text.slice(0, 1)))}`;
    streams[0].controller.enqueue(event(firstObject));
    await pause();
    assert.equal(events.at(-1)?.tokens.map(token => token.word).join(''), source.slice(0, 1), 'Show the first complete token before its chunk finishes');
    assert.equal(events.at(-1)?.done, false);

    // The last object is incomplete: keep the previous tokens and do not report success.
    streams[0].controller.enqueue(event(',{"word":"'));
    await pause();
    assert.equal(events.length, 1);
    const rest = JSON.stringify(chunks[0].text.slice(1)).slice(1);
    streams[0].controller.enqueue(event(`${rest},"pos":"記号"}]}`));
    streams[0].controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    streams[0].controller.close();
    await pending;
    assert.equal(errors.length, 0);
    assert.equal(events.at(-1)?.tokens.map(token => token.word).join(''), source);
    assert.equal(events.filter(event => event.done).length, 1);
    for (const event of events) assert.ok(source.startsWith(event.tokens.map(token => token.word).join('')));
    assert.equal(diagnostics.filter(event => event.stage === 'complete').length, chunks.length);
    assert.ok(diagnostics.every(event => event.elapsedMs >= 0 && event.reasoningChars === 0));
    assert.ok(!JSON.stringify(diagnostics).includes(source));
    assert.ok(!JSON.stringify(diagnostics).includes('sk-private'));
    assert.ok(!JSON.stringify(diagnostics).includes(endpoint.baseUrl));

    // Whitespace omitted by the model is restored while streaming, too.
    streams.length = 0;
    events.length = 0;
    const spacedSource = `今日\nは晴れです。${source}`;
    const spacedChunks = splitJapaneseText(spacedSource);
    const abortController = new AbortController();
    const abortPending = streamAnalyzeSentence(spacedSource, (content, done) => events.push({ tokens: JSON.parse(content).tokens, done }),
      error => errors.push(error), undefined, endpoint, { signal: abortController.signal });
    await pause();
    streams[0].controller.enqueue(event(`{"tokens":[${JSON.stringify(token('今日は'))}`));
    await pause();
    assert.equal(events.at(-1)?.tokens.map(token => token.word).join(''), '今日\nは');
    // Queue another update, then abort before the debounce timer can emit it.
    streams[0].controller.enqueue(event(`,${JSON.stringify(token('晴れ'))}`));
    await new Promise(resolve => setTimeout(resolve, 1));
    abortController.abort();
    await abortPending;
    const countAfterAbort = events.length;
    await pause();
    assert.equal(events.length, countAfterAbort);
    assert.equal(events.some(event => event.done), false);
    assert.equal(streams.length, spacedChunks.length);
    assert.ok(streams.every(stream => stream.cancelled));
    assert.equal(errors.length, 0);

    // Failure, recovery and sibling retention are covered in analysisRecovery.test.ts.
  } finally {
    globalThis.fetch = originalFetch;
  }
}
