import assert from 'node:assert/strict';
import { machineTranslate, MachineTranslationError } from '../app/api/_utils/machineTranslation';
import { createTranslationService, readTranslationServiceSettings } from '../app/lib/translationServices';

async function main() {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const signal = new AbortController().signal;
  try {
    globalThis.fetch = async input => {
      const url = new URL(String(input)); calls.push(url);
      return Response.json({ responseStatus: 200, responseData: { translatedText: `${url.searchParams.get('q')}&amp;译` } });
    };
    assert.equal(await machineTranslate('猫&犬。\r\n\r\n駅', 'mymemory', 'zh-TW', signal), '猫&犬。&译\r\n\r\n駅&译');
    assert.equal(calls.length, 2, 'Empty lines never trigger upstream requests');
    assert.equal(calls[0].origin, 'https://api.mymemory.translated.net');
    assert.equal(calls[0].searchParams.get('q'), '猫&犬。');
    assert.equal(calls[0].searchParams.get('langpair'), 'ja|zh-TW');
    assert.equal(calls[0].searchParams.has('de'), false, 'Anonymous requests omit the contact email');
    await machineTranslate('未登録でも使える。', 'mymemory', 'en', signal, 'user+translation@example.com');
    assert.equal(calls.at(-1)!.searchParams.get('de'), 'user+translation@example.com');
    for (const locale of ['zh-CN', 'en', 'ko'] as const) {
      await machineTranslate('駅', 'mymemory', locale, signal);
      assert.equal(calls.at(-1)!.searchParams.get('langpair'), `ja|${locale}`);
    }
    calls.length = 0;
    const source = '猫😀'.repeat(400);
    await machineTranslate(source, 'mymemory', 'en', signal);
    assert.ok(calls.length > 1);
    assert.equal(calls.map(url => url.searchParams.get('q')).join(''), source);
    for (const url of calls) assert.ok(Buffer.byteLength(url.searchParams.get('q')!, 'utf8') <= 450);

    for (const status of [429, '403']) {
      globalThis.fetch = async () => Response.json({ responseStatus: status, responseDetails: 'quota exceeded', responseData: { translatedText: 'MYMEMORY WARNING' } });
      await assert.rejects(machineTranslate('駅', 'mymemory', 'en', signal),
        (error: unknown) => error instanceof MachineTranslationError && error.status === 429 && error.code === 'MYMEMORY_QUOTA_EXCEEDED');
    }
    globalThis.fetch = async () => Response.json({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING' } });
    await assert.rejects(machineTranslate('駅', 'mymemory', 'en', signal),
      (error: unknown) => error instanceof MachineTranslationError && error.code === 'MYMEMORY_QUOTA_EXCEEDED');
    globalThis.fetch = async () => Response.json({ responseStatus: 403, responseDetails: 'INVALID EMAIL PROVIDED' });
    await assert.rejects(machineTranslate('駅', 'mymemory', 'en', signal, 'user@example.com'),
      (error: unknown) => error instanceof MachineTranslationError && error.code === 'MYMEMORY_EMAIL_INVALID' && !error.message.includes('注册'));
    globalThis.fetch = async () => Response.json({ responseStatus: 200, responseData: { translatedText: ' ' } });
    await assert.rejects(machineTranslate('駅', 'mymemory', 'en', signal), MachineTranslationError);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(machineTranslate('駅', 'mymemory', 'en', signal),
      (error: unknown) => error instanceof MachineTranslationError && error.status === 503);
    globalThis.fetch = async () => Response.json({ responseStatus: 200, responseData: { translatedText: '&#x110000;&amp;' } });
    assert.equal(await machineTranslate('駅', 'mymemory', 'en', signal), '&#x110000;&');
    globalThis.fetch = async () => Response.json({ responseStatus: 200, responseData: { translatedText: '&#55296;&#xDFFF;&#128512;&#x5409;' } });
    assert.equal(await machineTranslate('駅', 'mymemory', 'en', signal), '&#55296;&#xDFFF;😀吉');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(machineTranslate('駅', 'mymemory', 'en', aborted.signal), { name: 'AbortError' });
    const defaultExpected = {
      preferredProvider: 'mymemory',
      activeId: 'mymemory',
      services: [{ id: 'mymemory', name: 'MyMemory', provider: 'mymemory' }],
    };
    assert.equal(readTranslationServiceSettings(null).preferredProvider, 'mymemory');
    assert.deepEqual(readTranslationServiceSettings(JSON.stringify({ preferredProvider: 'mymemory', google: { apiKey: 'g' }, baidu: { appId: 'a', secret: 's' } })), defaultExpected);
    assert.equal(readTranslationServiceSettings(JSON.stringify({ preferredProvider: 'baidu' })).preferredProvider, 'mymemory');
    assert.deepEqual(readTranslationServiceSettings('{'), defaultExpected);
    assert.deepEqual(readTranslationServiceSettings('null'), defaultExpected);
    assert.deepEqual(readTranslationServiceSettings('{"preferredProvider":"model","myMemoryEmail":" user@example.com "}'), {
      preferredProvider: 'model',
      activeId: 'mymemory',
      services: [{ id: 'mymemory', name: 'MyMemory', provider: 'mymemory', email: 'user@example.com' }],
      myMemoryEmail: 'user@example.com',
    });
    assert.deepEqual(readTranslationServiceSettings('{"myMemoryEmail":"invalid"}'), defaultExpected);

    const created = createTranslationService('mymemory');
    assert.equal(created.provider, 'mymemory');
    assert.ok(created.id.startsWith('translate-'));

    const customServices = [
      { id: 'mymemory', name: 'MyMemory (Work)', provider: 'mymemory', email: 'work@example.com' },
      { id: 'custom-1', name: 'MyMemory (Personal)', provider: 'mymemory', email: 'personal@example.com' },
    ];
    const withCustom = readTranslationServiceSettings(JSON.stringify({
      services: customServices,
      activeId: 'custom-1',
      preferredProvider: 'custom-1',
    }));
    assert.equal(withCustom.activeId, 'custom-1');
    assert.equal(withCustom.preferredProvider, 'custom-1');
    assert.equal(withCustom.services.length, 2);
    assert.equal(withCustom.myMemoryEmail, 'work@example.com');

    console.log('Machine translation passed: language mapping, UTF-8 chunks, paragraph preservation, provider errors and cancellation.');
  } finally { globalThis.fetch = originalFetch; }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
