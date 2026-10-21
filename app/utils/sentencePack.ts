import { hasDailySentenceReadings, isAttributedDailySentence, type DailySentence } from './dailySentences';
import { LOCALES } from '../i18n';

export const MAX_SENTENCE_PACK_SIZE = 500;
export const SENTENCE_PACK_SCHEMA_VERSION = 3;
export interface SentencePack {
  schemaVersion: typeof SENTENCE_PACK_SCHEMA_VERSION;
  version: string;
  publishedAt: string;
  sha256: string;
  source: { url: string; sha256: string; license: 'CC BY 2.0 FR' };
  sentences: Omit<DailySentence, 'date'>[];
}

export function parseSentencePack(value: unknown): SentencePack {
  if (!value || typeof value !== 'object') throw new Error('Invalid sentence pack');
  const pack = value as SentencePack;
  if (pack.schemaVersion !== SENTENCE_PACK_SCHEMA_VERSION || !/^\d{4}-\d{2}-\d{2}$/.test(pack.publishedAt)
    || new Date(`${pack.publishedAt}T00:00:00Z`).toISOString().slice(0, 10) !== pack.publishedAt
    || !/^[a-f0-9]{64}$/.test(pack.sha256) || pack.version !== `${pack.publishedAt}-${pack.sha256.slice(0, 12)}`
    || !pack.source || pack.source.license !== 'CC BY 2.0 FR' || !/^[a-f0-9]{64}$/.test(pack.source.sha256)
    || typeof pack.source.url !== 'string' || !pack.source.url.startsWith('https://')
    || !Array.isArray(pack.sentences) || !pack.sentences.length || pack.sentences.length > MAX_SENTENCE_PACK_SIZE) {
    throw new Error('Invalid sentence pack metadata');
  }
  const ids = new Set<number>(); const texts = new Set<string>();
  for (const sentence of pack.sentences) {
    if (!isAttributedDailySentence({ ...sentence, date: pack.publishedAt }) || !hasDailySentenceReadings(sentence)
      || !LOCALES.every(locale => sentence.translation[locale]?.trim())
      || ids.has(sentence.source!.id) || texts.has(sentence.text)) throw new Error('Invalid or duplicate packed sentence');
    ids.add(sentence.source!.id); texts.add(sentence.text);
  }
  return pack;
}
