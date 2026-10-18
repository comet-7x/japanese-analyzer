import assert from 'node:assert/strict';
import { parseWordDetailResponseContent } from '../app/services/api';
import { getPhraseReading, getPhraseText, mergePhraseTokens, normalizePhraseRange, PHRASE_MAX_WORDS } from '../app/utils/phraseRange';

const token = (word: string, pos = '名詞', furigana = '') => ({ word, pos, furigana });
// 明日は早く起きなければならない。
const tokens = [
  token('明日', '名詞', 'あした'), token('は', '助詞'), token('早く', '形容詞', 'はやく'), token('起き', '動詞', 'おき'),
  token('なけれ', '助動詞'), token('ば', '助詞'), token('なら', '動詞'), token('ない', '助動詞'), token('。', '記号'),
];

// 顺序无关，短语选区
assert.deepEqual(normalizePhraseRange(tokens, 7, 4), { start: 4, end: 7 });
// 包含句末标点的完整句子：保留句末标点，不漏句末
assert.deepEqual(normalizePhraseRange(tokens, 4, 8), { start: 4, end: 8 });
// 单个词不成立范围
assert.equal(normalizePhraseRange(tokens, 3, 3), null);
// 支持跨换行选择长句：从第 1 行跨过换行到第 2 行完整保留
const withBreak = [token('今日'), token('は', '助詞'), token('\n', '改行'), token('明日'), token('も', '助詞')];
assert.deepEqual(normalizePhraseRange(withBreak, 0, 4), { start: 0, end: 4 });
// 往回跨行拖选同样完整保留
assert.deepEqual(normalizePhraseRange(withBreak, 4, 0), { start: 0, end: 4 });
// 支持超长长句（远超旧的 12 词限制），不漏词
const sentence25 = Array.from({ length: 25 }, (_, i) => token(`語${i}`));
assert.deepEqual(normalizePhraseRange(sentence25, 0, 24), { start: 0, end: 24 });
// 超出 PHRASE_MAX_WORDS (200) 时才做安全截断
const long = Array.from({ length: PHRASE_MAX_WORDS + 5 }, (_, i) => token(`語${i}`));
assert.deepEqual(normalizePhraseRange(long, 0, long.length - 1), { start: 0, end: PHRASE_MAX_WORDS - 1 });
assert.deepEqual(normalizePhraseRange(long, long.length - 1, 0), { start: long.length - PHRASE_MAX_WORDS, end: long.length - 1 });

const range = { start: 4, end: 7 };
assert.equal(getPhraseText(tokens, range), 'なければならない');
assert.equal(getPhraseReading(tokens, { start: 2, end: 3 }), 'はやくおき');

// 合并：被拆开的一个词合回单个词项，词性、读音取 AI 结果，前后词不变
const split = [token('図書', '名詞', 'としょ'), token('館', '名詞', 'かん'), token('で', '助詞')];
const merged = mergePhraseTokens(split, { start: 0, end: 1 }, { pos: '名詞', furigana: 'としょかん' });
assert.equal(merged.length, 2);
assert.deepEqual({ word: merged[0].word, pos: merged[0].pos, furigana: merged[0].furigana }, { word: '図書館', pos: '名詞', furigana: 'としょかん' });
assert.equal(merged[1].word, 'で');

// 短语释义：显示用前端按词拼出的完整读音，AI 返回的读音只留作合并用
const phraseDetail = parseWordDetailResponseContent(JSON.stringify({
  chineseTranslation: '因为有考试', category: '連語', dictionaryForm: '', explanation: '说明原因。',
  breakdown: '', example: '', exampleTranslation: '', pos: '', furigana: 'しけんがあるので',
}), { word: '試験があるので、今夜は', pos: '', furigana: 'しけんがあるので、こんやは', kind: 'phrase' });
assert.equal(phraseDetail.furigana, 'しけんがあるので、こんやは');
assert.equal(phraseDetail.mergeReading, 'しけんがあるので');
assert.equal(phraseDetail.category, '連語');

// 短语字段必须齐全：缺类别、类别不在四种之内、缺构成都算未完整生成
const phraseContext = { word: '試験がある', pos: '', furigana: 'しけんがある', kind: 'phrase' as const };
const phraseFields = { chineseTranslation: '有考试', dictionaryForm: '', explanation: '', breakdown: '', example: '', exampleTranslation: '', pos: '', furigana: '' };
assert.throws(() => parseWordDetailResponseContent(JSON.stringify(phraseFields), phraseContext), /category/);
assert.throws(() => parseWordDetailResponseContent(JSON.stringify({ ...phraseFields, category: '句子' }), phraseContext), /category/);
const withoutBreakdown: Record<string, string> = { ...phraseFields, category: '連語' };
delete withoutBreakdown.breakdown;
assert.throws(() => parseWordDetailResponseContent(JSON.stringify(withoutBreakdown), phraseContext), /breakdown/);
// 单词释义不受影响
assert.doesNotThrow(() => parseWordDetailResponseContent(JSON.stringify(phraseFields), { word: '試験', pos: '名詞' }));

console.log('Phrase range tests passed');
