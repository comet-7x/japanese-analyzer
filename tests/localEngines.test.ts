import assert from 'node:assert/strict';
import { schoolTokens, scoreTokens, scoreReadings } from '../scripts/analysis-lab/engines/school';
import { goldCases, safetyCases, readingCases } from '../scripts/analysis-lab/engines/corpus';

// Offsets are rebuilt in JS UTF-16, never copied from native byte/codepoint offsets.
const source = '😀　静かだ。\r\nお金がない。';
const result = schoolTokens(source, [
  { word: '😀', pos: ['補助記号'], reading: '' },
  { word: '静か', pos: ['形状詞'], reading: 'シズカ' },
  { word: 'だ', pos: ['助動詞'], reading: 'ダ' },
  { word: '。', pos: ['補助記号'], reading: '' },
  { word: 'お', pos: ['接頭辞'], reading: 'オ' },
  { word: '金', pos: ['名詞'], reading: 'カネ' },
  { word: 'が', pos: ['助詞'], reading: 'ガ' },
  { word: 'ない', pos: ['形容詞'], reading: 'ナイ' },
  { word: '。', pos: ['補助記号'], reading: '' },
]);
assert.equal(result.map(t => t.word).join(''), source);
assert.ok(result.every(t => source.slice(t.start, t.end) === t.word));
assert.equal(result.find(t => t.word === '静かだ')?.pos, '形容動詞');
assert.equal(result.find(t => t.word === 'お金')?.reading, 'おかね');
assert.equal(result.find(t => t.word === 'ない')?.pos, '形容詞');
assert.equal(result.filter(t => t.pos === '改行').length, 2);
assert.throws(() => schoolTokens('猫猫。', [{ word: '猫', pos: ['名詞'], reading: 'ネコ' }, { word: '。', pos: ['記号'], reading: '' }]));
assert.throws(() => schoolTokens('ﾈｺ', [{ word: 'ネコ', pos: ['名詞'], reading: 'ネコ' }]));
assert.throws(() => schoolTokens('猫', [{ word: '', pos: ['名詞'], reading: '' }]));
const negative = schoolTokens('食べない', [{ word: '食べ', pos: ['動詞'], reading: 'タベ' }, { word: 'ない', pos: ['助動詞'], reading: 'ナイ' }]);
assert.equal(negative[1].pos, '助動詞', 'The adapter does not rewrite lexical grammatical judgments');
const kana = schoolTokens('ルミポネリア', [{ word: 'ルミポネリア', pos: ['名詞'], reading: '', unknown: true }]);
assert.equal(kana[0].reading, 'るみぽねりあ');
const gold = [['猫', '名詞', 'ねこ']] as const;
assert.equal(scoreTokens(schoolTokens('猫', [{ word: '猫', pos: ['名詞'], reading: 'ネコ' }]), gold).exact, true);
assert.equal(scoreTokens(schoolTokens('猫猫', [{ word: '猫猫', pos: ['名詞'], reading: 'ネコネコ' }]), gold).exact, false);
assert.equal(scoreTokens(schoolTokens('猫猫', [{ word: '猫', pos: ['名詞'], reading: 'ネコ' }, { word: '猫', pos: ['名詞'], reading: 'ネコ' }]), gold).exact, false, 'Extra tokens penalize exact accuracy');
assert.equal(scoreTokens(schoolTokens('猫', [{ word: '猫', pos: ['名詞'], reading: 'ビョウ' }]), gold).readingCorrect, 0);
const pronoun = schoolTokens('私', [{ word: '私', pos: ['代名詞'], reading: 'ワタクシ' }]);
assert.equal(scoreTokens(pronoun, [['私', '代名詞', 'わたし']]).exact, false);
assert.equal(scoreTokens(pronoun, [['私', '代名詞', 'わたし']], { 0: ['わたくし'] }).exact, true);
const pair = schoolTokens('二人', [{ word: '二', pos: ['名詞'], reading: 'ニ' }, { word: '人', pos: ['名詞'], reading: 'ニン' }]);
assert.equal(scoreReadings('二人', pair, [{ word: '二人', readings: ['ふたり'] }])[0].passed, false, 'Source coverage cannot stand in for correct whole-word readings');
assert.equal(scoreReadings('二人', [{ word: '二人', pos: '名詞', reading: 'ふたり', start: 0, end: 2 }], [{ word: '二人', readings: ['ふたり'] }])[0].passed, true);
assert.throws(() => scoreReadings('猫猫', [], [{ word: '猫', readings: ['ねこ'] }]));
assert.equal(new Set([...goldCases, ...safetyCases].map(c => c.id)).size, goldCases.length + safetyCases.length);
for (const test of goldCases) assert.equal(test.expected.map(t => t[0]).join(''), test.text, test.id);
for (const test of readingCases) for (const target of test.targets) assert.ok(test.text.includes(target.word), test.id);
assert.ok(!goldCases.some(c => c.id.includes('deserted')), 'Ambiguous readings are probes, not fabricated gold');
console.log('Local engine comparison passed: exact source coverage, Unicode offsets, shared school conventions and independent scoring.');
