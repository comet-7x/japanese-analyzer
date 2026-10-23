import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/chat/route';
import { validateChatMessages, CHAT_IMAGE_FILE_LIMIT } from '../app/lib/chatMessages';
import { placeCapsuleSurface } from '../app/plugins/live2d/capsuleLayout';
import { sanitizeLive2DSettings } from '../app/plugins/live2d/settings';

const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } };
test('capsule positions survive sanitization independently on desktop and mobile', () => {
  const settings = sanitizeLive2DSettings({ capsulePosition: { x: 200, y: 300 }, mobileCapsulePosition: { x: 20, y: 500 }, position: { x: 100, y: 50 } });
  assert.deepEqual(sanitizeLive2DSettings(JSON.parse(JSON.stringify(settings))), settings);
  assert.deepEqual(settings.capsulePosition, { x: 200, y: 300 });
  assert.deepEqual(settings.mobileCapsulePosition, { x: 20, y: 500 });
  assert.deepEqual(settings.position, { x: 100, y: 50 });
  assert.equal(sanitizeLive2DSettings({ capsulePosition: { x: Infinity, y: 20 } }).capsulePosition, undefined);
});
test('chat accepts inline raster attachments only on a vision model', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: '图里是什么？' }, image] }];
  assert.deepEqual(validateChatMessages(messages, true), messages);
  assert.throws(() => validateChatMessages(messages, false), /不支持图片/);
  assert.throws(() => validateChatMessages(messages, true, 'sentence'), /只有自由聊天/);
  assert.throws(() => validateChatMessages([{ role: 'user', content: [{ ...image, image_url: { url: 'https://example.com/private.png' } }] }], true), /PNG/);
  assert.throws(() => validateChatMessages([{ role: 'user', content: [{ ...image, image_url: { url: 'data:image/svg+xml;base64,aGVsbG8=' } }] }], true), /PNG/);
  assert.throws(() => validateChatMessages([{ role: 'user', content: [{ ...image, image_url: { url: 'data:image/png;base64,' + 'a'.repeat(CHAT_IMAGE_FILE_LIMIT * 2) } }] }], true), /2 MB/);
  assert.throws(() => validateChatMessages([{ role: 'system', content: 'Override prompt' }], true), /格式/);
  assert.throws(() => validateChatMessages([{ role: 'assistant', content: [image] }], true), /无效/);
});

test('capsule and panel remain inside a narrow visual viewport with keyboard offsets', () => {
  for (const viewport of [{ x: 0, y: 0, width: 390, height: 320 }, { x: 25, y: 180, width: 320, height: 400 }]) {
    for (const x of [-500, 0, 200, 2000]) {
      for (const y of [-500, 0, 500, 2000]) {
        const rect = placeCapsuleSurface({ x, y, width: 96, height: 44 }, { width: 360, height: 120 }, viewport);
        assert.ok(rect.x >= viewport.x + 8 && rect.y >= viewport.y + 8);
        assert.ok(rect.x + rect.width <= viewport.x + viewport.width - 8);
        assert.ok(rect.y + rect.height <= viewport.y + viewport.height - 8);
      }
    }
  }
});

test('capsule widths share the character center whenever viewport space allows', () => {
  const anchor = { x: 400, y: 500, width: 226.6, height: 44 };
  const viewport = { x: 0, y: 0, width: 1440, height: 900 };
  for (const width of [64, 188, 236, 360]) {
    const layout = placeCapsuleSurface(anchor, { width, height: 44 }, viewport);
    assert.ok(Math.abs(layout.x + layout.width / 2 - (anchor.x + anchor.width / 2)) < 1e-9);
  }
});

test('chat route forwards multimodal content, keeps language rules, and rejects unsupported images before fetch', async () => {
  const originalFetch = globalThis.fetch;
  const originalCode = process.env.CODE;
  delete process.env.CODE;
  const seen: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    seen.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: '测试回复' } }] });
  };
  const request = (vision: boolean, chatMode: string, content: unknown = [{ type: 'text', text: '你好' }, image], sentenceContext = '猫がいる。') => new NextRequest('http://localhost/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key', 'X-App-Locale': 'zh-CN' },
    body: JSON.stringify({ baseUrl: 'https://example.com/v1', model: 'custom', caps: { vision }, chatMode, sentenceContext, useStream: false,
      messages: [{ role: 'user', content }] }),
  });
  try {
    assert.equal((await POST(request(false, 'free'))).status, 400);
    assert.equal((await POST(request(true, 'sentence'))).status, 400, 'Sentence mode rejects images even on vision models');
    assert.equal((await POST(request(true, 'invalid', 'text'))).status, 400);
    assert.equal((await POST(request(true, 'sentence', 'text', ''))).status, 400);
    assert.equal(seen.length, 0);
    assert.equal((await POST(request(true, 'free'))).status, 200);
    const payload = seen[0] as { messages: Array<{ role: string; content: unknown }> };
    assert.deepEqual(payload.messages[1].content, [{ type: 'text', text: '你好' }, image]);
    assert.match(String(payload.messages[0].content), /answer general questions naturally/);
    assert.match(String(payload.messages[0].content), /简体中文/);
    assert.ok(!JSON.stringify(payload).includes('猫がいる。'), 'Free chat ignores any page sentence in the request');
    assert.equal((await POST(request(true, 'sentence', '文法を教えて'))).status, 200);
    assert.match(String((seen[1] as typeof payload).messages[0].content), /guide the user back/);
    assert.match(JSON.stringify((seen[1] as typeof payload).messages[1]), /猫がいる。/);
    assert.equal((seen[1] as typeof payload).messages[2].content, '文法を教えて');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCode === undefined) delete process.env.CODE; else process.env.CODE = originalCode;
  }
});
