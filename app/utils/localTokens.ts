import { toHiragana } from './romaji';

export interface RawToken { word: string; pos: string[]; reading: string; readingKind?: 'kana' | 'pronunciation'; lemma?: string; unknown?: boolean; }
export interface SchoolToken { word: string; pos: string; reading: string; start: number; end: number; }
const allowed = new Set(['名詞', '代名詞', '動詞', '形容詞', '形容動詞', '副詞', '連体詞', '接続詞', '感動詞', '助詞', '助動詞', '記号', '改行']);

/** Shared, deliberately small adapter. No dictionary-specific lexical corrections. */
export function schoolTokens(source: string, raw: RawToken[]): SchoolToken[] {
  const tokens: SchoolToken[] = [];
  let cursor = 0;
  const append = (word: string, pos: string, reading: string) => {
    if (!word || !source.startsWith(word, cursor)) throw new Error('source_alignment');
    tokens.push({ word, pos, reading, start: cursor, end: cursor + word.length });
    cursor += word.length;
  };
  const spaces = (text: string) => { for (const char of text) append(char, /[\r\n]/u.test(char) ? '改行' : '記号', ''); };
  const mapPos = (item: RawToken) => {
    const [head, detail] = item.pos;
    if (head === '名詞' && detail === '代名詞') return '代名詞';
    if (head === '形状詞') return '名詞';
    if (head === '補助記号' || head === '空白') return '記号';
    if (head === '接尾辞') return detail?.startsWith('動詞') ? '動詞' : detail?.startsWith('形容詞') ? '形容詞' : '名詞';
    return allowed.has(head) ? head : '名詞';
  };
  const read = (item: RawToken) => toHiragana(item.readingKind === 'pronunciation' && /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(item.word) ? item.word
    : item.reading && item.reading !== '*' ? item.reading.normalize('NFKC')
    : /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(item.word) ? item.word : '');
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item.word) throw new Error('empty_surface');
    const start = source.indexOf(item.word, cursor);
    if (start < cursor || /\S/u.test(source.slice(cursor, start))) throw new Error('source_omitted');
    spaces(source.slice(cursor, start));
    if (/^\s+$/u.test(item.word)) { spaces(item.word); continue; }
    let word = item.word;
    let pos = mapPos(item);
    let reading = read(item);
    const next = raw[i + 1];
    // Match the project's declared school-grammar convention: 静か + だ -> 静かだ.
    if ((item.pos[0] === '形状詞' || item.pos[1] === '形容動詞語幹') && next?.word === 'だ' && next.pos[0] === '助動詞' && source.startsWith(word + next.word, cursor)) {
      word += next.word; reading += read(next); pos = '形容動詞'; i++;
    } else if (['お', 'ご'].includes(word) && ['接頭詞', '接頭辞'].includes(item.pos[0]) && next && mapPos(next) === '名詞'
      && source.startsWith(word + next.word, cursor)) {
      word += next.word; reading += read(next); pos = '名詞'; i++;
    }
    if (pos === '記号') reading = '';
    append(word, pos, reading);
  }
  if (/\S/u.test(source.slice(cursor))) throw new Error('trailing_source_omitted');
  spaces(source.slice(cursor));
  if (tokens.map(t => t.word).join('') !== source) throw new Error('source_mismatch');
  return tokens;
}
