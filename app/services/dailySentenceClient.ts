import { LOCALES, type Locale } from '../i18n';
import { DAILY_SENTENCES, getDayNumber, getFallbackDailySentence, isOnlineDailySentence, type DailySentence } from '../utils/dailySentences';
import { browserStorage } from '../utils/storage';

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
    candidates: Array.isArray(source?.candidates) ? source.candidates.filter(isOnlineDailySentence).slice(0, 120) : [],
    history: Array.isArray(savedHistory) ? savedHistory.filter(item => item
      && Number.isSafeInteger(item.id) && item.id >= 0 && typeof item.text === 'string' && item.text.length <= 80 && typeof item.date === 'string').slice(-200) : [],
    syncedAt: timestamps(source?.syncedAt), retryAt: timestamps(source?.retryAt), failures: timestamps(source?.failures),
  };
  const save = () => { write(DAILY_POOL_KEY, state, storage); };
  const prune = (date: string) => {
    const age = (day: string) => getDayNumber(date) - getDayNumber(day);
    state.history = state.history.filter(item => age(item.date) >= 0 && age(item.date) < 30);
    const ids = new Set<number>(); const texts = new Set<string>();
    state.candidates = state.candidates.filter(sentence => {
      const id = sentence.source!.id;
      if (!(age(sentence.date!) >= 0 && age(sentence.date!) < 7) || ids.has(id) || texts.has(sentence.text)
        || state.history.some(item => item.text === sentence.text || (item.id > 0 && item.id === id))) return false;
      ids.add(id); texts.add(sentence.text); return true;
    });
  };
  const nextSyncAt = (date: string, locale: Locale) => {
    prune(date);
    const last = Math.min(state.syncedAt[locale] ?? 0, now());
    const due = state.candidates.length <= POOL_LOW_WATER ? last + SYNC_INTERVAL_MS : last + DAY_MS;
    // Bound persisted deadlines so clock changes or corrupted storage cannot disable sync indefinitely.
    return Math.max(due, Math.min(state.retryAt[locale] ?? 0, now() + 6 * 60 * 60_000));
  };
  return {
    current(date: string) { return state.current?.date === date ? state.current : null; },
    take(date: string, locale: Locale, exclude = ''): DailySentence {
      prune(date);
      const eligible = state.candidates.filter(sentence => sentence.text !== exclude);
      const selected = eligible.find(sentence => sentence.translation[locale]) ?? eligible[0];
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
      const batch = value as { date?: unknown; sentences?: unknown };
      if (batch.date !== date || !Array.isArray(batch.sentences)) return false;
      const candidates = batch.sentences.slice(0, 12).filter(isOnlineDailySentence).filter(sentence => sentence.date === date);
      if (!candidates.length) return false;
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      state.candidates.push(...candidates);
      prune(date); state.candidates = state.candidates.slice(0, 120);
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
