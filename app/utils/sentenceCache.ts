import type { EndpointPayload, TokenData } from '../services/api';
import type { Locale } from '../i18n';
import { browserStorage } from './storage';

/** Bounded LRU. Persistence is opt-in; model results and credential scopes stay in memory. */
export class ResultCache<T> {
  private entries = new Map<string, { json: string; bytes: number; expiresAt?: number }>();
  private bytes = 0;
  private hydrated = false;
  constructor(private maxEntries = 20, private maxBytes = 2 * 1024 * 1024,
    private persistence?: { key: string; ttlMs: number }) {}

  private hydrate() {
    if (!this.persistence || this.hydrated || typeof window === 'undefined') return;
    this.hydrated = true;
    try {
      const entries: unknown = JSON.parse(browserStorage.getItem(this.persistence.key) || '[]');
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1]?.json !== 'string'
          || typeof entry[1].expiresAt !== 'number' || entry[1].expiresAt <= Date.now()) continue;
        // Reject corrupt values before they can reach consumers.
        JSON.parse(entry[1].json);
        this.put(entry[0], entry[1].json, entry[1].expiresAt);
      }
    } catch { /* Invalid or blocked storage must not prevent translation. */ }
  }

  private persist() {
    if (this.persistence) browserStorage.setItem(this.persistence.key, JSON.stringify([...this.entries]));
  }

  private put(key: string, json: string, expiresAt?: number) {
    const bytes = (key.length + json.length) * 2;
    if (bytes > this.maxBytes) return;
    this.bytes -= this.entries.get(key)?.bytes ?? 0;
    this.entries.delete(key);
    this.entries.set(key, { json, bytes, expiresAt });
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
  }

  get(key: string): T | undefined {
    this.hydrate();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key); this.bytes -= entry.bytes; this.persist();
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return JSON.parse(entry.json) as T;
  }
  set(key: string, value: T) {
    this.hydrate();
    this.put(key, JSON.stringify(value), this.persistence ? Date.now() + this.persistence.ttlMs : undefined);
    this.persist();
  }
  clear() {
    this.hydrated = true; this.entries.clear(); this.bytes = 0;
    if (this.persistence) browserStorage.removeItem(this.persistence.key);
  }
}

// Opaque session-only credential scopes keep keys out of cache identifiers and diagnostics.
const credentialScopes = new Map<string, number>();
export function credentialScope(apiKey = ''): number {
  if (!credentialScopes.has(apiKey)) credentialScopes.set(apiKey, credentialScopes.size + 1);
  return credentialScopes.get(apiKey)!;
}
export function sentenceCacheKey(text: string, endpoint: EndpointPayload, locale: Locale, apiKey = '', thinking = false): string {
  return JSON.stringify([1, text, endpoint.baseUrl, endpoint.model, endpoint.caps ?? {}, locale, credentialScope(apiKey), thinking]);
}

export function localCorrectionCacheKey(text: string, endpoint: EndpointPayload, locale: Locale, apiKey = '', thinking = false): string {
  return JSON.stringify(['local-correction', text, endpoint.baseUrl, endpoint.model, endpoint.caps ?? {}, locale, credentialScope(apiKey), thinking]);
}

export const analysisCache = new ResultCache<TokenData[]>();
export const localCorrectionCache = new ResultCache<TokenData[]>();
export const sentenceTranslationCache = new ResultCache<string>();
