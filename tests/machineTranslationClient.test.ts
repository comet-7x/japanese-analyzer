import assert from 'node:assert/strict';
import { ResultCache } from '../app/utils/sentenceCache';
import { clearMachineTranslationCache, getCachedMachineTranslation, MACHINE_TRANSLATION_CACHE_KEY, translateWithMyMemory } from '../app/services/machineTranslationClient';

async function main() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const values = new Map<string, string>();
  let blocked = false;
  const storage = {
    getItem(key: string) { if (blocked) throw new Error('blocked'); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (blocked) throw new Error('full'); values.set(key, value); },
    removeItem(key: string) { if (blocked) throw new Error('blocked'); values.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  const calls: { body: { text: string; email?: string }; signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  const request = (text: string, controller = new AbortController(), email?: string, force = false) =>
    translateWithMyMemory({ text, locale: 'en', signal: controller.signal, email, force });
  try {
    clearMachineTranslationCache();
    globalThis.fetch = async (_url, init) => new Promise(resolve => calls.push({ body: JSON.parse(String(init?.body)), signal: init!.signal!, resolve }));
    const firstController = new AbortController();
    const first = request('共用する。', firstController);
    const firstRejected = assert.rejects(first, { name: 'AbortError' });
    const second = request('共用する。');
    assert.equal(calls.length, 1, 'Concurrent subscribers share one HTTP request');
    firstController.abort(); await firstRejected;
    assert.equal(calls[0].signal.aborted, false, 'One subscriber cannot cancel another');
    calls[0].resolve(Response.json({ translation: 'Shared' }));
    assert.deepEqual(await second, { translation: 'Shared', fromCache: false });
    assert.equal(calls[0].body.email, undefined, 'No email means anonymous use');
    assert.deepEqual(await request('共用する。', undefined, 'person@example.com'), { translation: 'Shared', fromCache: true });
    assert.equal(calls.length, 1, 'Changing email never wastes quota on an already cached translation');
    assert.ok(values.get(MACHINE_TRANSLATION_CACHE_KEY)?.includes('Shared'));
    assert.ok(!values.get(MACHINE_TRANSLATION_CACHE_KEY)?.includes('person@example.com'), 'Translation cache stores no email');
    const refreshed = request('共用する。', undefined, undefined, true);
    const sameRefresh = request('共用する。', undefined, undefined, true);
    assert.equal(calls.length, 2, 'Even explicit simultaneous refreshes share a request');
    calls[1].resolve(Response.json({ translation: 'Refreshed' }));
    assert.equal((await refreshed).translation, 'Refreshed'); await sameRefresh;

    const emailed = request('メール付き。', undefined, ' contact+app@example.com ');
    assert.equal(calls[2].body.email, 'contact+app@example.com');
    calls[2].resolve(Response.json({ translation: 'With contact' })); await emailed;
    assert.ok(!values.get(MACHINE_TRANSLATION_CACHE_KEY)?.includes('contact+app@example.com'));

    const quota = request('制限された。');
    calls[3].resolve(Response.json({ error: { code: 'MYMEMORY_QUOTA_EXCEEDED', message: 'Quota reached' } }, { status: 429 }));
    await assert.rejects(quota, /Quota reached/);
    assert.equal(calls.length, 4, 'Quota failure never automatically retries with a different identity');
    assert.equal(getCachedMachineTranslation('制限された。', 'en'), undefined);
    const retry = request('制限された。', undefined, 'person@example.com');
    calls[4].resolve(Response.json({ translation: 'Manual retry with contact' })); await retry;

    const abortController = new AbortController();
    const cancelled = request('中止する。', abortController);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    abortController.abort(); await rejected; await Promise.resolve();
    assert.equal(calls[5].signal.aborted, true, 'No remaining subscribers cancels upstream');
    calls[5].resolve(Response.json({ translation: 'Late result' }));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(getCachedMachineTranslation('中止する。', 'en'), undefined, 'Late cancelled results are never persisted');

    const beingCleared = request('削除中。');
    clearMachineTranslationCache();
    calls[6].resolve(Response.json({ translation: 'Display without restoring deleted cache' })); await beingCleared;
    assert.equal(getCachedMachineTranslation('削除中。', 'en'), undefined);
    assert.equal(values.has(MACHINE_TRANSLATION_CACHE_KEY), false);
    await assert.rejects(request('不正なメール。', undefined, 'bad-email'), /有效/);
    assert.equal(calls.length, 7);

    const options = { key: 'cache-persistence-test', ttlMs: 1000 };
    let now = 1000; Date.now = () => now;
    const cache = new ResultCache<string>(2, 1000, options);
    cache.set('a', 'A'); cache.set('b', 'B'); cache.get('a'); cache.set('c', 'C');
    const reloaded = new ResultCache<string>(2, 1000, options);
    assert.equal(reloaded.get('a'), 'A', 'A new instance restores persisted values');
    assert.equal(reloaded.get('b'), undefined, 'Persistence retains eviction bounds');
    now = 2001;
    assert.equal(reloaded.get('a'), undefined, 'Persisted results expire');
    assert.equal(new ResultCache<string>(2, 1000, options).get('c'), undefined);
    values.set(options.key, '{broken');
    const corrupt = new ResultCache<string>(2, 1000, options);
    assert.equal(corrupt.get('a'), undefined);
    blocked = true;
    const memoryOnly = new ResultCache<string>(2, 1000, options);
    memoryOnly.set('a', 'works'); assert.equal(memoryOnly.get('a'), 'works'); memoryOnly.clear();
    console.log('Machine client passed: persistence/expiry, bounds, blocked storage, deduplication, per-subscriber cancellation, email and quota failures.');
  } finally {
    clearMachineTranslationCache();
    Date.now = originalNow; globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window');
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
