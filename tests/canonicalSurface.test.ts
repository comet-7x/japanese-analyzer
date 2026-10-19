import assert from 'node:assert/strict';
import { restoreCanonicalWords } from '../app/utils/canonicalSurface';

const cases: [string, string[], string[]][] = [
  ['まるて\u3099', ['まるで'], ['まるて\u3099']],
  ['まるで', ['まるて\u3099'], ['まるで']],
  ['カ\u3099ッツホ\u309aース\u3099', ['ガッツ', 'ポーズ'], ['カ\u3099ッツ', 'ホ\u309aース\u3099']],
  ['て\u3099す。\r\n', ['で', 'す', '。', '\r', '\n'], ['て\u3099', 'す', '。', '\r', '\n']],
  ['éとe\u0301', ['e\u0301', 'と', 'é'], ['é', 'と', 'e\u0301']],
  ['한です', ['한', 'で', 'す'], ['한', 'で', 'す']],
  ['か\u3099😀。', ['が', '😀', '。'], ['か\u3099', '😀', '。']],
  ['まるで美しい', ['まるで', '美しい'], ['まるで', '美しい']],
];
for (const [original, words, expected] of cases) {
  const snapshot = [...words];
  const restored = restoreCanonicalWords(original, words);
  assert.deepEqual(restored, expected);
  assert.equal(restored!.join(''), original, 'Restore the original code units, not a normalized source');
  assert.deepEqual(words, snapshot);
}
for (const [original, words] of [
  ['まるで', ['まるて', '\u3099']],
  ['か\u3099😀', ['が', '\ud83d', '\ude00']],
  ['か\u3099🐈‍⬛', ['が', '🐈', '‍⬛']],
  ['ｶﾞ', ['ガ']], ['①', ['1']], ['㈱', ['株式会社']], ['〜', ['～']],
  ['まるて\u3099', ['まるです']], ['か\u3099', ['か']],
  ['猫\r\n', ['猫\n']], ['猫 犬', ['猫犬']], ['猫', []], ['猫', ['']],
] as [string, string[]][]) assert.equal(restoreCanonicalWords(original, words), null);

// Exercise whole-source invariants over every voiced/semi-voiced kana, mixed
// NFC/NFD input and several legal model boundaries; no linguistic gold implied.
for (const kana of Array.from('がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴ')) {
  const original = `前${kana.normalize('NFD')}後。\r\n`;
  for (const words of [[`前${kana}後。\r\n`], ['前', kana, '後', '。', '\r', '\n']]) {
    assert.equal(restoreCanonicalWords(original, words)!.join(''), original);
  }
}
console.log('Canonical surface restoration passed: exact NFC equivalence, original code units, grapheme boundaries, kana, Hangul, emoji, CRLF and rejection of compatibility/lexical changes.');
