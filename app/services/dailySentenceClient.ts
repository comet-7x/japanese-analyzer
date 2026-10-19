import { LOCALES, type Locale } from '../i18n';
import { DAILY_SENTENCES, getDayNumber, getFallbackDailySentence, isCompleteDailySentence, isOnlineDailySentence, type DailySentence } from '../utils/dailySentences';
import { browserStorage } from '../utils/storage';
import { MAX_SENTENCE_PACK_SIZE, type SentencePack } from '../utils/sentencePack';

type Storage = Pick<typeof browserStorage, 'getItem' | 'setItem'>;
export const DAILY_DECK_KEY = 'japaneseAnalyzer:dailyDeck:v1';
export const DAILY_ONLINE_KEY = 'japaneseAnalyzer:dailySentence:v2';
interface Deck { date: string; index: number; remaining: number[]; size: number; }
interface HistoryEntry { date: string; id: number; text: string; }
interface OnlineState { sentence?: DailySentence; history: HistoryEntry[]; }

function read(key: string, storage: Storage): unknown {
  try { return JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
}
function write(key: string, value: unknown, storage: Storage): boolean {
  try { const json = JSON.stringify(value); storage.setItem(key, json); return storage.getItem(key) === json; } catch { return false; }
}

/** Fisher–Yates; daily choice stays stable unless the user explicitly asks for another sentence. */
export function getLocalDailySentence(date: string, storage: Storage = browserStorage, random = Math.random, options: { refresh?: boolean; exclude?: string } = {}): DailySentence {
  const raw = read(DAILY_DECK_KEY, storage) as Deck | null;
  const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < DAILY_SENTENCES.length;
  const valid = raw && raw.size === DAILY_SENTENCES.length && typeof raw.date === 'string' && validIndex(raw.index)
    && Array.isArray(raw.remaining) && raw.remaining.length < DAILY_SENTENCES.length
    && raw.remaining.every(validIndex) && !raw.remaining.includes(raw.index) && new Set(raw.remaining).size === raw.remaining.length;
  if (valid && raw.date === date && !options.refresh) return { ...DAILY_SENTENCES[raw.index], date };
  const remaining = valid ? [...raw.remaining] : [];
  // An online sentence can also occur in the local deck; do not immediately show the same text.
  if (remaining.length === 1 && DAILY_SENTENCES[remaining[0]].text === options.exclude) remaining.pop();
  if (!remaining.length) {
    remaining.push(...DAILY_SENTENCES.map((_, index) => index));
    for (let i = remaining.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
    }
    if (valid && remaining[0] === raw.index) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
  }
  if (DAILY_SENTENCES[remaining[0]].text === options.exclude) remaining.push(remaining.shift()!);
  const index = remaining.shift()!;
  const saved = write(DAILY_DECK_KEY, { date, index, remaining, size: DAILY_SENTENCES.length }, storage);
  return { ...(saved || options.refresh ? DAILY_SENTENCES[index] : getFallbackDailySentence(new Date(`${date}T03:00:00Z`))), date };
}

export const DAILY_POOL_KEY = 'japaneseAnalyzer:dailyPool:v1';
const DAY_MS = 86_400_000;
const SYNC_INTERVAL_MS = 15 * 60_000;
const POOL_LOW_WATER = 3;
interface PoolState {
  current?: DailySentence;
  candidates: DailySentence[];
  history: HistoryEntry[];
  syncedAt: Partial<Record<Locale, number>>;
  retryAt: Partial<Record<Locale, number>>;
  failures: Partial<Record<Locale, number>>;
  packVersion?: string;
  packPublishedAt?: string;
  packSchemaVersion?: number;
  packIds: number[];
}

/** A persistent candidate deck. Network completion never selects or replaces the current sentence. */
export function createDailySentencePool(storage: Storage = browserStorage, random = Math.random, now = Date.now) {
  const raw = read(DAILY_POOL_KEY, storage) as Partial<PoolState> | null;
  const legacy = read(DAILY_ONLINE_KEY, storage) as OnlineState | null;
  const source = raw && typeof raw === 'object' ? raw : null;
  const timestamps = (value: unknown): Partial<Record<Locale, number>> => Object.fromEntries(LOCALES.flatMap(locale => {
    const n = value && typeof value === 'object' ? (value as Record<string, unknown>)[locale] : undefined;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? [[locale, n]] : [];
  }));
  const savedCurrent = source?.current ?? legacy?.sentence;
  const savedHistory = source?.history ?? legacy?.history;
  const localCurrent = DAILY_SENTENCES.find(sentence => sentence.text === savedCurrent?.text);
  const state: PoolState = {
    current: isOnlineDailySentence(savedCurrent) ? savedCurrent
      : localCurrent && typeof savedCurrent?.date === 'string' ? { ...localCurrent, date: savedCurrent.date } : undefined,
    candidates: Array.isArray(source?.candidates) ? source.candidates.filter(isOnlineDailySentence).slice(0, MAX_SENTENCE_PACK_SIZE) : [],
    history: Array.isArray(savedHistory) ? savedHistory.filter(item => item
      && Number.isSafeInteger(item.id) && item.id >= 0 && typeof item.text === 'string' && item.text.length <= 80 && typeof item.date === 'string').slice(-200) : [],
    syncedAt: timestamps(source?.syncedAt), retryAt: timestamps(source?.retryAt), failures: timestamps(source?.failures),
    packVersion: typeof source?.packVersion === 'string' ? source.packVersion : undefined,
    packPublishedAt: typeof source?.packPublishedAt === 'string' ? source.packPublishedAt : undefined,
    packSchemaVersion: source?.packSchemaVersion === 2 ? 2 : 1,
    packIds: Array.isArray(source?.packIds) ? source.packIds.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, MAX_SENTENCE_PACK_SIZE) : [],
  };
  const save = () => { write(DAILY_POOL_KEY, state, storage); };
  const prune = (date: string) => {
    const age = (day: string) => getDayNumber(date) - getDayNumber(day);
    state.history = state.history.filter(item => age(item.date) >= 0 && age(item.date) < 30);
    const ids = new Set<number>(); const texts = new Set<string>();
    state.candidates = state.candidates.filter(sentence => {
      const id = sentence.source!.id;
      if (!(age(sentence.date!) >= 0 && (age(sentence.date!) < 7 || state.packIds.includes(id))) || ids.has(id) || texts.has(sentence.text)
        || state.history.some(item => item.text === sentence.text || (item.id > 0 && item.id === id))) return false;
      ids.add(id); texts.add(sentence.text); return true;
    });
  };
  const nextSyncAt = (date: string, locale: Locale) => {
    prune(date);
    const last = Math.min(state.syncedAt[locale] ?? 0, now());
    const ready = state.candidates.filter(sentence => isCompleteDailySentence(sentence, locale)).length;
    const due = ready <= POOL_LOW_WATER ? last + SYNC_INTERVAL_MS : last + DAY_MS;
    // Bound persisted deadlines so clock changes or corrupted storage cannot disable sync indefinitely.
    return Math.max(due, Math.min(state.retryAt[locale] ?? 0, now() + 6 * 60 * 60_000));
  };
  const shuffle = (candidates: DailySentence[]) => {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates;
  };
  const install = (sentences: DailySentence[], date: string, version: string, publishedAt: string, schemaVersion: number) => {
    if (state.packVersion === version || (state.packPublishedAt && (state.packPublishedAt > publishedAt
      || (state.packPublishedAt === publishedAt && (state.packSchemaVersion ?? 1) >= schemaVersion)))) return;
    state.candidates = state.candidates.filter(sentence => !state.packIds.includes(sentence.source!.id));
    state.packIds = sentences.map(sentence => sentence.source!.id);
    state.packVersion = version; state.packPublishedAt = publishedAt; state.packSchemaVersion = schemaVersion;
    state.candidates.unshift(...shuffle(sentences));
    prune(date); state.candidates = state.candidates.slice(0, MAX_SENTENCE_PACK_SIZE); save();
  };
  return {
    installPack(pack: SentencePack, date: string) {
      install(pack.sentences.map(sentence => ({ ...sentence, date })), date, pack.version, pack.publishedAt, pack.schemaVersion);
    },
    current(date: string, locale: Locale) {
      return state.current?.date === date && isCompleteDailySentence(state.current, locale) ? state.current : null;
    },
    take(date: string, locale: Locale, exclude = ''): DailySentence {
      prune(date);
      const selected = state.candidates.find(sentence => sentence.text !== exclude && isCompleteDailySentence(sentence, locale));
      const sentence = selected ? { ...selected, date }
        : getLocalDailySentence(date, storage, random, { refresh: !!exclude, exclude });
      state.current = sentence;
      state.history.push({ date, id: sentence.source?.id ?? 0, text: sentence.text });
      state.history = state.history.slice(-200);
      prune(date); save();
      return sentence;
    },
    addBatch(value: unknown, date: string, locale: Locale): boolean {
      if (!value || typeof value !== 'object') return false;
      const batch = value as { date?: unknown; sentences?: unknown; packVersion?: unknown; packPublishedAt?: unknown; packSchemaVersion?: unknown };
      if (batch.date !== date || !Array.isArray(batch.sentences)) return false;
      const candidates = batch.sentences.slice(0, MAX_SENTENCE_PACK_SIZE).filter(isOnlineDailySentence).filter(sentence => sentence.date === date);
      if (!candidates.length) return false;
      if (typeof batch.packVersion === 'string' && /^\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/.test(batch.packVersion)
        && typeof batch.packPublishedAt === 'string' && batch.packVersion.startsWith(`${batch.packPublishedAt}-`)) {
        install(candidates, date, batch.packVersion, batch.packPublishedAt, batch.packSchemaVersion === 2 ? 2 : 1);
      } else {
        state.candidates.push(...shuffle(candidates));
        prune(date); state.candidates = state.candidates.slice(0, MAX_SENTENCE_PACK_SIZE);
      }
      state.syncedAt[locale] = now(); state.retryAt[locale] = 0; state.failures[locale] = 0;
      save(); return true;
    },
    failed(locale: Locale) {
      const attempts = Math.min((state.failures[locale] ?? 0) + 1, 6);
      state.failures[locale] = attempts;
      state.retryAt[locale] = now() + Math.min(SYNC_INTERVAL_MS * 2 ** (attempts - 1), 6 * 60 * 60_000);
      save();
    },
    syncDelay(date: string, locale: Locale) { return Math.max(0, nextSyncAt(date, locale) - now()); },
  };
}
