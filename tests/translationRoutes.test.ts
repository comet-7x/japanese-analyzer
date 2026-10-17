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
  const originalGoogle = process.env.GOOGLE_TRANSLATE_API_KEY;
  try {
    delete process.env.CODE;
    process.env.GOOGLE_TRANSLATE_API_KEY = 'environment-key';
    let upstream = '';
    globalThis.fetch = async input => {
      upstream = String(input);
      return Response.json({ data: { translations: [{ translatedText: '車站' }] } });
    };
    const browserCredential = await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'google', text: '駅' }, {
      'X-App-Locale': 'zh-TW', 'X-Translation-Api-Key': 'browser-key',
    }));
    assert.equal(browserCredential.status, 200);
    assert.equal(new URL(upstream).searchParams.get('key'), 'browser-key', 'Browser credentials override deployment credentials');
    assert.equal((await browserCredential.json()).translation, '車站');
    await machineTranslate(request('http://localhost/api/machine-translate', { provider: 'google', text: '駅' }, { 'X-App-Locale': 'en' }));
    assert.equal(new URL(upstream).searchParams.get('key'), 'environment-key');

    let reviewPayload: Record<string, unknown> = {};
    globalThis.fetch = async (_input, init) => {
      reviewPayload = JSON.parse(String(init?.body));
      return completion({ translation: '第一段\n\n第二段', summary: '修正用词。' });
    };
    const endpoint = { baseUrl: 'https://model.example/v1', model: 'reviewer', caps: { structuredOutput: 'json_schema' } };
    const reviewed = await reviewTranslation(request('http://localhost/api/translate/review', {
      text: '一行目\n\n二行目', draft: '第一段\n\n第二段', provider: 'google', ...endpoint,
    }, { Authorization: 'Bearer model-key', 'X-App-Locale': 'zh-CN' }));
    assert.equal(reviewed.status, 200);
    assert.equal((reviewPayload.response_format as { type?: string }).type, 'json_schema');
    assert.equal((await reviewed.json()).translation, '第一段\n\n第二段');

    globalThis.fetch = async () => completion({ translation: '段落被合并', summary: '' });
    const invalid = await reviewTranslation(request('http://localhost/api/translate/review', {
      text: '一行目\n\n二行目', draft: '第一段\n\n第二段', provider: 'baidu', ...endpoint,
    }, { Authorization: 'Bearer model-key' }));
    assert.equal(invalid.status, 502, 'A review cannot alter the source line-break structure');
    console.log('Translation routes passed: browser/environment credential priority and strict reviewed paragraph preservation.');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCode === undefined) delete process.env.CODE; else process.env.CODE = originalCode;
    if (originalGoogle === undefined) delete process.env.GOOGLE_TRANSLATE_API_KEY; else process.env.GOOGLE_TRANSLATE_API_KEY = originalGoogle;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
