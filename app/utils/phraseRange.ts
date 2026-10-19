import type { TokenData } from '../services/api';
import { getLocalRomaji } from './romaji';

/** 一次最多圈选的词数（满足长句与跨行长句完整解析，避免截断漏词） */
export const PHRASE_MAX_WORDS = 200;

export interface PhraseRange {
  start: number;
  end: number;
}

const PUNCTUATION_ONLY_RE = /^[\s。\u3001，,.!?！？:：;；「」『』()（）[\]【】〈〉《》…・･〜～\—\-\u2014\u2015]+$/;

export function isPunctuationToken(token: TokenData): boolean {
  const pos = token.pos || '';
  return pos.includes('記号')
    || pos.includes('標点')
    || pos.includes('标点')
    || pos.includes('句読点')
    || pos.includes('符号')
    || PUNCTUATION_ONLY_RE.test(token.word);
}

/**
 * 规范化圈选范围。a 是圈选的起点，b 是终点：
 * - 允许跨行长句勾选（不再因遇到换行符而截断）；
 * - 支持长达 200 词的长句完整框选，避免漏词；
 * - 智能修剪两端多余换行符及前端误蹭的孤立标点；
 * - 完整保留长句闭合标点与句中词汇。
 */
export function normalizePhraseRange(tokens: readonly TokenData[], a: number, b: number): PhraseRange | null {
  const last = tokens.length - 1;
  if (last < 0) return null;
  let start = Math.max(0, Math.min(a, b));
  let end = Math.min(last, Math.max(a, b));

  // 修剪两端纯换行符
  while (start <= end && tokens[start].pos === '改行') start++;
  while (end >= start && tokens[end].pos === '改行') end--;
  if (start > end) return null;

  // 修剪前端可能误触的上一句结尾标点
  while (start < end && isPunctuationToken(tokens[start])) {
    start++;
  }

  const words: number[] = [];
  for (let i = start; i <= end; i++) {
    if (!isPunctuationToken(tokens[i]) && tokens[i].pos !== '改行') {
      words.push(i);
    }
  }
  if (words.length < 1) return null;
  if (words.length === 1 && start === end) return null;

  // 超过上限时根据拖动方向截断
  if (words.length > PHRASE_MAX_WORDS) {
    if (a > b) {
      const kept = words.slice(-PHRASE_MAX_WORDS);
      start = kept[0];
    } else {
      const kept = words.slice(0, PHRASE_MAX_WORDS);
      const lastWord = kept[kept.length - 1];
      if (lastWord + 1 <= end && isPunctuationToken(tokens[lastWord + 1])) {
        end = lastWord + 1;
      } else {
        end = lastWord;
      }
    }
  }

  while (start <= end && tokens[start].pos === '改行') start++;
  while (end >= start && tokens[end].pos === '改行') end--;

  return start <= end ? { start, end } : null;
}

export function getPhraseText(tokens: readonly TokenData[], range: PhraseRange): string {
  return tokens.slice(range.start, range.end + 1).map((token) => token.word).join('');
}

/** 整段读音：有注音的词用注音，其余用原文 */
export function getPhraseReading(tokens: readonly TokenData[], range: PhraseRange): string {
  return tokens.slice(range.start, range.end + 1).map((token) => {
    if (/助詞|助词/.test(token.pos) && !/助動詞|助动词/.test(token.pos)) {
      if (token.word === 'は') return 'わ';
      if (token.word === 'へ') return 'え';
      if (token.word === 'を') return 'お';
    }
    return token.furigana || token.word;
  }).join('');
}

/** 把被拆开的一个词合并回单个词项；词性、读音取 AI 给出的结果 */
export function mergePhraseTokens(
  tokens: readonly TokenData[],
  range: PhraseRange,
  merged: { pos?: string; furigana?: string },
): TokenData[] {
  const word = getPhraseText(tokens, range);
  const pos = merged.pos?.trim() || '名詞';
  const furigana = merged.furigana?.trim() || getPhraseReading(tokens, range);
  return [
    ...tokens.slice(0, range.start),
    { word, pos, furigana, romaji: getLocalRomaji(word, furigana, pos) },
    ...tokens.slice(range.end + 1),
  ];
}
