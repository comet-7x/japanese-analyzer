import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { PassThrough } from 'node:stream';
import { MsEdgeTTS } from 'msedge-tts';
import { NextRequest } from 'next/server';
import { synthesizeEdgeTtsWithBoundaries } from '../app/api/_utils/edgeTtsNative';
import { POST } from '../app/api/tts/route';

async function main() {
  const originalFetch = globalThis.fetch;
  const originalCode = process.env.CODE;
  const metadata = mock.method(MsEdgeTTS.prototype, 'setMetadata', async () => {});
  const close = mock.method(MsEdgeTTS.prototype, 'close', () => {});
  let audioStream = new PassThrough();
  let metadataStream = new PassThrough();
  const stream = mock.method(MsEdgeTTS.prototype, 'toStream', () => ({ audioStream, metadataStream }));
  const tick = () => new Promise<void>(resolve => setImmediate(resolve));
  try {
    const completed = synthesizeEdgeTtsWithBoundaries('猫');
    await tick();
    metadataStream.end(JSON.stringify({ Metadata: [{ Type: 'WordBoundary', Data: {
      Offset: 1_000_000, Duration: 2_000_000, text: { Text: '猫' },
    } }] }));
    audioStream.end(Buffer.from('audio'));
    const result = await completed;
    assert.equal(result.audio.toString(), 'audio');
    assert.deepEqual(result.cues, [{ word: '猫', startTime: 0.1, endTime: 0.3 }]);
    assert.equal(close.mock.callCount(), 1);

    metadata.mock.mockImplementation(async () => { throw new Error('initialization failed'); });
    await assert.rejects(synthesizeEdgeTtsWithBoundaries('猫'), /initialization failed/);
    assert.equal(close.mock.callCount(), 2, 'Initialization errors also close the socket');
    metadata.mock.mockImplementation(async () => {});
    audioStream = new PassThrough(); metadataStream = new PassThrough();
    const failed = synthesizeEdgeTtsWithBoundaries('猫');
    await tick(); audioStream.destroy(new Error('stream failed'));
    await assert.rejects(failed, /stream failed/);
    assert.equal(close.mock.callCount(), 3);

    // A hanging connection must respect cancellation before it creates a stream.
    metadata.mock.mockImplementation(() => new Promise<void>(() => {}));
    const controller = new AbortController();
    const cancelled = synthesizeEdgeTtsWithBoundaries('猫', { signal: controller.signal });
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(close.mock.callCount(), 4);
    assert.equal(stream.mock.callCount(), 2);

    delete process.env.CODE;
    globalThis.fetch = async () => { throw new Error('An aborted native request must not start proxy fallback'); };
    const requestController = new AbortController();
    const response = POST(new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '猫', provider: 'edge' }), signal: requestController.signal,
    }));
    await tick(); requestController.abort();
    assert.equal((await response).status, 499);

    metadata.mock.mockImplementation(async () => { throw new DOMException('deadline', 'TimeoutError'); });
    const timedOut = await POST(new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '猫', provider: 'edge' }),
    }));
    assert.equal(timedOut.status, 504, 'Native timeouts must not start a fresh proxy deadline');
    console.log('Edge TTS passed: audio/cues, cleanup on completion/error, cancellation and deadlines.');
  } finally {
    mock.restoreAll(); globalThis.fetch = originalFetch;
    if (originalCode === undefined) delete process.env.CODE; else process.env.CODE = originalCode;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
