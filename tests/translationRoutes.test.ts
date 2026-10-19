import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST as machineTranslate } from '../app/api/machine-translate/route';
import { POST as reviewTranslation } from '../app/api/translate/review/route';

const request = (url: string, body: unknown, headers: Record<string, string> = {}) => new NextRequest(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const completion = (content: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });

async function main() {
  const originalFetch = globalThis.fetch;
  const originalCode = process.env.CODE;
  const originalIpHeader = process.env.MYMEMORY_CLIENT_IP_HEADER;
  try {
    delete process.env.CODE;
    delete process.env.MYMEMORY_CLIENT_IP_HEADER;
    let upstream = '';
    globalThis.fetch = async input => {
      upstream = String(input);
      return Response.json({ responseStatus: 200, responseData: { translatedText: '車站' } });
    };
    const translated = await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅' }, { 'X-App-Locale': 'zh-TW' }));
    assert.equal(translated.status, 200);
    assert.equal(new URL(upstream).searchParams.get('langpair'), 'ja|zh-TW');
    assert.equal((await translated.json()).translation, '車站');
    assert.equal(new URL(upstream).searchParams.has('de'), false);
    const emailed = await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅', email: ' user@example.com ' }));
    assert.equal(emailed.status, 200);
    assert.equal(new URL(upstream).searchParams.get('de'), 'user@example.com');
    await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅', ip: '192.0.2.2' }, { 'X-Real-IP': '192.0.2.1' }));
    assert.equal(new URL(upstream).searchParams.has('ip'), false, 'Client-provided IP is not trusted by default');
    process.env.MYMEMORY_CLIENT_IP_HEADER = 'X-Trusted-Client-IP';
    await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅' }, { 'X-Trusted-Client-IP': '2001:db8::1' }));
    assert.equal(new URL(upstream).searchParams.get('ip'), '2001:db8::1');
    await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅' }, { 'X-Trusted-Client-IP': 'fake-ip' }));
    assert.equal(new URL(upstream).searchParams.has('ip'), false);
    upstream = '';
    for (const email of ['not-an-email', 123, null, 'a@b.com\r\nX-Test: bad']) {
      const invalid = await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅', email }));
      assert.equal(invalid.status, 400);
      assert.equal((await invalid.json()).error.code, 'MYMEMORY_EMAIL_INVALID');
    }
    for (const provider of ['google', 'baidu']) {
      const invalid = await machineTranslate(request('http://localhost/api/machine-translate', { provider, text: '駅' }));
      assert.equal(invalid.status, 400);
      const invalidReview = await reviewTranslation(request('http://localhost/api/translate/review', { provider, text: '駅', draft: '车站' }));
      assert.equal(invalidReview.status, 400);
    }
    assert.equal(upstream, '', 'Removed providers never contact an upstream service');
    globalThis.fetch = async () => Response.json({ responseStatus: 429, responseDetails: 'quota exceeded', responseData: { translatedText: 'MYMEMORY WARNING' } });
    const quota = await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'mymemory', text: '駅' }));
    assert.equal(quota.status, 429);
    assert.equal((await quota.json()).error.code, 'MYMEMORY_QUOTA_EXCEEDED');

    let reviewPayload: Record<string, unknown> = {};
    globalThis.fetch = async (_input, init) => {
      reviewPayload = JSON.parse(String(init?.body));
      return completion({ translation: '第一段\n\n第二段', summary: '修正用词。' });
    };
    const endpoint = { baseUrl: 'https://model.example/v1', model: 'reviewer', caps: { structuredOutput: 'json_schema' } };
    const reviewed = await reviewTranslation(request('http://localhost/api/translate/review', {
      text: '一行目\n\n二行目', draft: '第一段\n\n第二段', provider: 'mymemory', ...endpoint,
    }, { Authorization: 'Bearer model-key', 'X-App-Locale': 'zh-CN' }));
    assert.equal(reviewed.status, 200);
    assert.equal((reviewPayload.response_format as { type?: string }).type, 'json_schema');
    assert.equal((await reviewed.json()).translation, '第一段\n\n第二段');

    globalThis.fetch = async () => completion({ translation: '段落被合并', summary: '' });
    const invalid = await reviewTranslation(request('http://localhost/api/translate/review', {
      text: '一行目\n\n二行目', draft: '第一段\n\n第二段', provider: 'mymemory', ...endpoint,
    }, { Authorization: 'Bearer model-key' }));
    assert.equal(invalid.status, 502, 'A review cannot alter the source line-break structure');
    const logError = console.error;
    const logged: unknown[] = [];
    console.error = (...args) => { logged.push(args[1]); };
    try {
      for (const content of ['```json {"translation":"secret upstream text"} ```', '{"translation":', '<html>private gateway response</html>']) {
        globalThis.fetch = async () => Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
        const malformed = await reviewTranslation(request('http://localhost/api/translate/review', {
          text: '駅', draft: '车站', provider: 'mymemory', ...endpoint,
        }, { Authorization: 'Bearer model-key' }));
        assert.equal(malformed.status, 502);
        const body = await malformed.json();
        assert.equal(body.error.message, '模型润色未完成，请重试。');
        assert.ok(!JSON.stringify(body).includes(content), 'The response does not expose a raw model fragment');
      }
      assert.equal(logged.length, 3);
      assert.ok(logged.every(error => error instanceof SyntaxError), 'Original parser failures remain available in server logs');
    } finally { console.error = logError; }
    console.log('Translation routes passed: removed-provider rejection, quota propagation and reviewed paragraph preservation.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCode === undefined) delete process.env.CODE; else process.env.CODE = originalCode;
    if (originalIpHeader === undefined) delete process.env.MYMEMORY_CLIENT_IP_HEADER; else process.env.MYMEMORY_CLIENT_IP_HEADER = originalIpHeader;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
