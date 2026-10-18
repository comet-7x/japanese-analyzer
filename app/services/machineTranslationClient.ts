import type { Locale } from '../i18n';
import { isValidMyMemoryEmail, type MachineTranslationResponse } from '../lib/translationServices';
import { ResultCache } from '../utils/sentenceCache';

export const MACHINE_TRANSLATION_CACHE_KEY = 'japaneseAnalyzer:machineTranslations:v1';
const cache = new ResultCache<string>(100, 1024 * 1024, {
  key: MACHINE_TRANSLATION_CACHE_KEY, ttlMs: 30 * 24 * 60 * 60 * 1000,
});
let cacheGeneration = 0;
const cacheKey = (text: string, locale: Locale) => JSON.stringify(['mymemory', text, locale]);

export function getCachedMachineTranslation(text: string, locale: Locale): string | undefined {
  const value = cache.get(cacheKey(text, locale));
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function clearMachineTranslationCache() { cacheGeneration++; cache.clear(); }

type SharedRequest = { controller: AbortController; promise: Promise<string>; subscribers: number };
const pending = new Map<string, SharedRequest>();

/** Each subscriber can cancel independently. Abort upstream only when everyone has left. */
function subscribe(entry: SharedRequest, signal: AbortSignal): Promise<string> {
  entry.subscribers++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      settled = true;
      signal.removeEventListener('abort', abort);
      entry.subscribers--;
      // Effect cleanup/restart and a replacement subscriber can share the same request.
      queueMicrotask(() => { if (!entry.subscribers) entry.controller.abort(); });
    };
    const abort = () => { if (!settled) { release(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); } };
    signal.addEventListener('abort', abort, { once: true });
    entry.promise.then(value => {
      if (!settled) { release(); resolve(value); }
    }, error => {
      if (!settled) { release(); reject(error); }
    });
    if (signal.aborted) abort();
  });
}

export function translateWithMyMemory({ text, locale, email = '', signal, force = false }: {
  text: string; locale: Locale; email?: string; signal: AbortSignal; force?: boolean;
}): Promise<{ translation: string; fromCache: boolean }> {
  signal.throwIfAborted();
  const cached = force ? undefined : getCachedMachineTranslation(text, locale);
  if (cached !== undefined) return Promise.resolve({ translation: cached, fromCache: true });
  email = email.trim();
  if (email && !isValidMyMemoryEmail(email)) return Promise.reject(new Error('请输入有效的 MyMemory 联系邮箱，或留空使用匿名翻译。'));
  // Email affects quota attribution, never the translation or its persistent cache key.
  const key = JSON.stringify([text, locale, email]);
  let entry = pending.get(key);
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController();
    const generation = cacheGeneration;
    const promise = (async () => {
      const response = await fetch('/api/machine-translate', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-App-Locale': locale },
        body: JSON.stringify({ provider: 'mymemory', text, ...(email ? { email } : {}) }),
      });
      const value = await response.json().catch(() => null) as (MachineTranslationResponse & { error?: { message?: string } }) | null;
      if (!response.ok || typeof value?.translation !== 'string' || !value.translation.trim()) {
        throw new Error(value?.error?.message || `机器翻译请求失败（HTTP ${response.status}）`);
      }
      controller.signal.throwIfAborted();
      if (generation === cacheGeneration) cache.set(cacheKey(text, locale), value.translation);
      return value.translation;
    })();
    entry = { controller, promise, subscribers: 0 };
    pending.set(key, entry);
    const current = entry;
    const remove = () => { if (pending.get(key) === current) pending.delete(key); };
    void promise.then(remove, remove);
  }
  return subscribe(entry, signal).then(translation => ({ translation, fromCache: false }));
}
