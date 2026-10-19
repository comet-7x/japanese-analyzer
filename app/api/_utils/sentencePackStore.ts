import { createHash } from 'node:crypto';
import { bundledSentencePack } from '../../utils/bundledSentencePack';
import { MAX_SENTENCE_PACK_BYTES, parseSentencePack, type SentencePack } from '../../utils/sentencePack';
import { DAILY_SENTENCE_PACK_TIMEOUT_MS } from '../../utils/dailySentencePolicy';
import { validateBaseUrl } from './validateBaseUrl';

export function verifySentencePack(value: unknown): SentencePack {
  const pack = parseSentencePack(value);
  if (createHash('sha256').update(JSON.stringify(pack.sentences)).digest('hex') !== pack.sha256) {
    throw new Error('Sentence pack checksum mismatch');
  }
  return pack;
}

async function readBoundedJson(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_SENTENCE_PACK_BYTES) {
    await response.body?.cancel(); throw new Error('Sentence pack too large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty sentence pack response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SENTENCE_PACK_BYTES) { await reader.cancel(); throw new Error('Sentence pack too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Serve last verified data immediately; optional HTTPS snapshots update independently in the background. */
export function createSentencePackStore({ bundled = bundledSentencePack, url = '', now = Date.now,
  fetcher = fetch, warn = console.warn }: {
  bundled?: SentencePack; url?: string; now?: () => number; fetcher?: typeof fetch; warn?: (...args: unknown[]) => void;
} = {}) {
  let current = verifySentencePack(bundled);
  let pending: Promise<void> | undefined;
  let nextCheck = 0; let failures = 0; let etag = '';
  const refresh = () => {
    if (!url || now() < nextCheck) return pending ?? Promise.resolve();
    if (pending) return pending;
    nextCheck = now() + 86_400_000;
    pending = (async () => {
      const endpoint = new URL(validateBaseUrl(url));
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Sentence pack updates require a public HTTPS URL without credentials');
      const response = await fetcher(endpoint, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(DAILY_SENTENCE_PACK_TIMEOUT_MS),
        headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) } });
      if (response.status === 304 && etag) { failures = 0; return; }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Sentence pack HTTP ${response.status}`); }
      const candidate = verifySentencePack(await readBoundedJson(response));
      if (Date.parse(candidate.publishedAt) > now() + 86_400_000) throw new Error('Sentence pack publication date is in the future');
      // Published dates are immutable versions; never replace a newer snapshot with an older/same-day one.
      if (candidate.publishedAt > current.publishedAt) current = candidate;
      etag = response.headers.get('etag') || '';
      failures = 0;
    })().catch(error => {
      failures = Math.min(failures + 1, 6);
      nextCheck = now() + Math.min(15 * 60_000 * 2 ** (failures - 1), 6 * 60 * 60_000);
      warn('[daily-sentence] Snapshot update deferred:', error instanceof Error ? error.message : 'Unknown error');
    }).finally(() => { pending = undefined; });
    return pending;
  };
  return { get() { void refresh(); return current; }, refresh };
}

export const sentencePackStore = createSentencePackStore({ url: process.env.DAILY_SENTENCE_PACK_URL });
