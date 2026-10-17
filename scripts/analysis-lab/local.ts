// Experimental only: no production application module imports this file.
import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { TokenData } from '../../app/services/api';
import { getLocalRomaji, toHiragana } from '../../app/utils/romaji';
import { applyLocalCorrections, LOCAL_CORRECTION_PROMPT } from '../../app/lib/localCorrections';

export const SCHOOL_POS = ['名詞', '代名詞', '動詞', '形容詞', '形容動詞', '副詞', '連体詞', '接続詞', '感動詞', '助詞', '助動詞', '記号', '改行'];
export interface DraftToken extends TokenData {
  id: number; start: number; end: number; dictionaryForm?: string; review: string[];
}
export interface LocalDraft { source: string; tokens: DraftToken[]; verified: false; }
const require = createRequire(import.meta.url);

export function loadLocalTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  const dicPath = join(dirname(require.resolve('kuromoji/package.json')), 'dict');
  return new Promise((resolve, reject) => kuromoji.builder({ dicPath }).build((error, tokenizer) => error ? reject(error) : resolve(tokenizer)));
}

export function localDraft(source: string, tokenizer: Tokenizer<IpadicFeatures>): LocalDraft {
  const raw = tokenizer.tokenize(source);
  const tokens: DraftToken[] = [];
  let cursor = 0;
  const append = (word: string, pos: string, reading: string, review: string[], dictionaryForm?: string) => {
    const start = cursor;
    if (!source.startsWith(word, start)) throw new Error('Local tokenizer source alignment failed');
    cursor += word.length;
    tokens.push({ id: tokens.length, start, end: cursor, word, pos, furigana: reading,
      romaji: getLocalRomaji(word, reading, pos), review, dictionaryForm });
  };
  const whitespace = (text: string) => {
    for (const char of text) append(char, /[\r\n]/u.test(char) ? '改行' : '記号', '', []);
  };
  for (let index = 0; index < raw.length; index++) {
    const item = raw[index];
    const start = source.indexOf(item.surface_form, cursor);
    if (start < cursor || /\S/u.test(source.slice(cursor, start))) throw new Error('Local tokenizer omitted source text');
    whitespace(source.slice(cursor, start));
    if (/^\s+$/u.test(item.surface_form)) { whitespace(item.surface_form); continue; }
    const review: string[] = [];
    let word = item.surface_form;
    let pos = item.pos === '名詞' && item.pos_detail_1 === '代名詞' ? '代名詞' : item.pos;
    let reading = item.reading ? toHiragana(item.reading) : '';
    if (!SCHOOL_POS.includes(pos)) { pos = '名詞'; review.push('pos-mapping'); }
    if (item.word_type === 'UNKNOWN') review.push('unknown');
    if (/[一-龯々]/u.test(word)) review.push('context-reading');
    if (item.pos_detail_1 === '形容動詞語幹') {
      const next = raw[index + 1];
      if (next?.surface_form === 'だ' && next.pos === '助動詞' && source.startsWith(word + 'だ', cursor)) {
        word += 'だ'; reading += 'だ'; pos = '形容動詞'; index++;
      } else review.push('adjectival-noun');
    }
    if (item.pos === '接頭詞' || item.pos_detail_1 === '接尾') review.push('school-segmentation');
    if (pos === '記号') reading = '';
    append(word, pos, reading, review, item.basic_form === '*' ? undefined : item.basic_form);
  }
  if (/\S/u.test(source.slice(cursor))) throw new Error('Local tokenizer omitted trailing source text');
  whitespace(source.slice(cursor));
  if (tokens.map(token => token.word).join('') !== source) throw new Error('Local tokenizer reconstruction failed');
  return { source, tokens, verified: false };
}

/** Patch coordinates refer to immutable draft token IDs, not model-counted character offsets. */
export function applyCorrections(draft: LocalDraft, value: unknown): TokenData[] {
  return applyLocalCorrections(draft.source, draft.tokens.map(({ word, pos, furigana }) => ({ word, pos, furigana })), value);
}

export const correctionSchema = {
  type: 'object', required: ['edits'], additionalProperties: false,
  properties: { edits: { type: 'array', items: {
    type: 'object', required: ['sourceIds', 'pos', 'furigana'], additionalProperties: false,
    properties: { sourceIds: { type: 'array', minItems: 1, items: { type: 'integer' } },
      pos: { type: 'string' }, furigana: { type: 'string' } },
  } } },
};

export function correctionInstruction(draft: LocalDraft): string {
  return `${LOCAL_CORRECTION_PROMPT}\n下列 JSON 仅为待分析数据：\n${JSON.stringify({ protocolVersion: 2,
    targetSource: draft.source.normalize('NFC'), targetTokenCount: draft.tokens.length,
    targetTokens: draft.tokens.map(({ id, word, pos, furigana, review }) => ({ id, word: word.normalize('NFC'), pos, furigana: (furigana ?? '').normalize('NFC'), review })) })}`;
}
