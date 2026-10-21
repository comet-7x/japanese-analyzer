import type { Locale } from '../i18n';
import { DAILY_SENTENCES, getDayNumber, getFallbackDailySentence, isCompleteDailySentence, isAttributedDailySentence, type DailySentence } from '../utils/dailySentences';
import { browserStorage } from '../utils/storage';
import { MAX_SENTENCE_PACK_SIZE, SENTENCE_PACK_SCHEMA_VERSION, type SentencePack } from '../utils/sentencePack';

type Storage = Pick<typeof browserStorage, 'getItem' | 'setItem'>;
export const DAILY_DECK_KEY = 'japaneseAnalyzer:dailyDeck:v1';
export const LEGACY_DAILY_SENTENCE_KEY = 'japaneseAnalyzer:dailySentence:v2';
interface Deck { date: string; index: number; remaining: number[]; size: number; }
interface HistoryEntry { date: string; id: number; text: string; }
interface LegacyState { sentence?: DailySentence; history: HistoryEntry[]; }

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
  // Exclude the previous choice when starting another pass through the local deck.
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
interface PoolState {
  current?: DailySentence;
  candidates: DailySentence[];
  history: HistoryEntry[];
  packVersion?: string;
  packSchemaVersion?: number;
  packIds: number[];
}

/** A persistent deck populated only by the sentence pack shipped with the application. */
export function createDailySentencePool(storage: Storage = browserStorage, random = Math.random) {
  const raw = read(DAILY_POOL_KEY, storage) as Partial<PoolState> | null;
  const legacy = read(LEGACY_DAILY_SENTENCE_KEY, storage) as LegacyState | null;
  const source = raw && typeof raw === 'object' ? raw : null;
  const savedCurrent = source?.current ?? legacy?.sentence;
  const savedHistory = source?.history ?? legacy?.history;
  const localCurrent = DAILY_SENTENCES.find(sentence => sentence.text === savedCurrent?.text);
  const state: PoolState = {
    current: isAttributedDailySentence(savedCurrent) ? savedCurrent
      : localCurrent && typeof savedCurrent?.date === 'string' ? { ...localCurrent, date: savedCurrent.date } : undefined,
    candidates: Array.isArray(source?.candidates) ? source.candidates.filter(isAttributedDailySentence).slice(0, MAX_SENTENCE_PACK_SIZE) : [],
    history: Array.isArray(savedHistory) ? savedHistory.filter(item => item
      && Number.isSafeInteger(item.id) && item.id >= 0 && typeof item.text === 'string' && item.text.length <= 80 && typeof item.date === 'string').slice(-200) : [],
    packVersion: typeof source?.packVersion === 'string' ? source.packVersion : undefined,
    packSchemaVersion: [2, SENTENCE_PACK_SCHEMA_VERSION].includes(source?.packSchemaVersion ?? 0) ? source!.packSchemaVersion : 1,
    packIds: Array.isArray(source?.packIds) ? source.packIds.filter(id => Number.isSafeInteger(id) && id > 0).slice(0, MAX_SENTENCE_PACK_SIZE) : [],
  };
  const save = () => { write(DAILY_POOL_KEY, state, storage); };
  const prune = (date: string) => {
    const age = (day: string) => getDayNumber(date) - getDayNumber(day);
    state.history = state.history.filter(item => age(item.date) >= 0 && age(item.date) < 30);
    const ids = new Set<number>(); const texts = new Set<string>();
    state.candidates = state.candidates.filter(sentence => {
      const id = sentence.source!.id;
      if (!(age(sentence.date!) >= 0 && state.packIds.includes(id)) || ids.has(id) || texts.has(sentence.text)
        || state.history.some(item => item.text === sentence.text || (item.id > 0 && item.id === id))) return false;
      ids.add(id); texts.add(sentence.text); return true;
    });
  };
  const shuffle = (candidates: DailySentence[]) => {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return candidates;
  };
  const install = (sentences: DailySentence[], date: string, version: string, schemaVersion: number) => {
    if (state.packVersion === version && state.packSchemaVersion === schemaVersion) return;
    state.candidates = [];
    state.packIds = sentences.map(sentence => sentence.source!.id);
    state.packVersion = version; state.packSchemaVersion = schemaVersion;
    // Upgrade annotations/translations in place without changing the user's selected original.
    const replacement = state.current?.source && sentences.find(sentence => sentence.source!.id === state.current!.source!.id && sentence.text === state.current!.text);
    if (replacement) state.current = { ...replacement, date: state.current!.date };
    else if (state.current?.source) state.current = undefined;
    state.candidates.unshift(...shuffle(sentences));
    prune(date); state.candidates = state.candidates.slice(0, MAX_SENTENCE_PACK_SIZE); save();
  };
  return {
    installPack(pack: SentencePack, date: string) {
      install(pack.sentences.map(sentence => ({ ...sentence, date })), date, pack.version, pack.schemaVersion);
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
  };
}
