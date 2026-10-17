import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { machineTranslate, MachineTranslationError } from '../app/api/_utils/machineTranslation';
import { readTranslationServiceSettings } from '../app/lib/translationServices';

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  try {
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const body = JSON.parse(String(init?.body));
      return Response.json({ data: { translations: [{ translatedText: `${body.q}&amp;译` }] } });
    };
    const google = await machineTranslate('猫&犬。\r\n\r\n駅', 'google', 'zh-TW', { googleApiKey: 'google-key' }, new AbortController().signal);
    assert.equal(google, '猫&犬。&译\r\n\r\n駅&译');
    assert.equal(calls.length, 2, 'Empty lines must be preserved without upstream requests');
    const googleUrl = new URL(calls[0].url);
    assert.equal(googleUrl.origin, 'https://translation.googleapis.com');
    assert.equal(googleUrl.searchParams.get('key'), 'google-key');
    const googleBody = JSON.parse(String(calls[0].init?.body));
    assert.deepEqual({ source: googleBody.source, target: googleBody.target, format: googleBody.format }, { source: 'ja', target: 'zh-TW', format: 'text' });

    calls.length = 0;
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ trans_result: [{ dst: '역' }] });
    };
    assert.equal(await machineTranslate('駅', 'baidu', 'ko', { baiduAppId: 'app', baiduSecret: 'secret' }, new AbortController().signal), '역');
    const baidu = new URLSearchParams(String(calls[0].init?.body));
    assert.equal(calls[0].url, 'https://fanyi-api.baidu.com/api/trans/vip/translate');
    assert.equal(baidu.get('from'), 'jp');
    assert.equal(baidu.get('to'), 'kor');
    assert.equal(baidu.get('sign'), createHash('md5').update(`app駅${baidu.get('salt')}secret`, 'utf8').digest('hex'));

    calls.length = 0;
    globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const query = new URLSearchParams(String(init?.body)).get('q') ?? '';
      assert.ok(Buffer.byteLength(query, 'utf8') <= 5_000, 'Baidu chunks must obey the UTF-8 byte limit');
      return Response.json({ trans_result: [{ dst: '片段' }] });
    };
    await machineTranslate('猫'.repeat(4_000), 'baidu', 'zh-CN', { baiduAppId: 'app', baiduSecret: 'secret' }, new AbortController().signal);
    assert.ok(calls.length > 1);

    globalThis.fetch = async () => Response.json({ error_code: '54001', error_msg: 'Invalid Sign' });
    await assert.rejects(machineTranslate('駅', 'baidu', 'en', { baiduAppId: 'app', baiduSecret: 'wrong' }, new AbortController().signal),
      (error: unknown) => error instanceof MachineTranslationError && error.status === 401);

    await assert.rejects(machineTranslate('駅', 'google', 'en', {}, new AbortController().signal),
      (error: unknown) => error instanceof MachineTranslationError && error.status === 400);
    assert.equal(readTranslationServiceSettings(null).preferredProvider, 'model');
    assert.deepEqual(readTranslationServiceSettings(JSON.stringify({ preferredProvider: 'baidu', google: { apiKey: 'g' }, baidu: { appId: 'a', secret: 's' } })),
      { preferredProvider: 'baidu', google: { apiKey: 'g' }, baidu: { appId: 'a', secret: 's' } });
    assert.equal(readTranslationServiceSettings('{').google.apiKey, '');
    console.log('Machine translation passed: fixed endpoints, credentials, language mapping, signatures, entity decoding and line preservation.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
