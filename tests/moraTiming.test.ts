import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  countMoras,
  analyzeReadingPhoneticWeight,
  getTokenPhoneticWeight,
  calculateMoraTimeline,
  getActiveTokenIndexAtTime,
  alignWordBoundariesToTokens,
} from '../app/utils/moraTiming';
import type { TokenData } from '../app/services/api';

describe('moraTiming algorithm tests', () => {
  describe('countMoras', () => {
    test('standard plain kana words', () => {
      // あ・り・が・と・う = 5 moras
      assert.equal(countMoras('ありがとう'), 5);
      // さ・く・ら = 3 moras
      assert.equal(countMoras('さくら'), 3);
      // ね・こ = 2 moras
      assert.equal(countMoras('ねこ'), 2);
    });

    test('yōon (contracted small kana) combines with base kana to form 1 mora', () => {
      // きょ・う・りゅ・う = 4 moras
      assert.equal(countMoras('きょうりゅう'), 4);
      // と・う・きょ・う = 4 moras
      assert.equal(countMoras('とうきょう'), 4);
      // しゃ・し・ん = 3 moras (しゃ=1, し=1, ん=1)
      assert.equal(countMoras('しゃしん'), 3);
    });

    test('sokuon (っ) and hatsuon (ん) count as 1 mora each', () => {
      // ちょ・っ・と = 3 moras (ちょ=1, っ=1, と=1)
      assert.equal(countMoras('ちょっと'), 3);
      // が・っ・こ・う = 4 moras
      assert.equal(countMoras('がっこう'), 4);
      // に・っ・ぽ・ん = 4 moras
      assert.equal(countMoras('にっぽん'), 4);
    });

    test('chōonpu (ー) counts as 1 mora in Katakana loanwords', () => {
      // チョ・コ・レ・ー・ト = 5 moras
      assert.equal(countMoras('チョコレート'), 5);
      // コ・ー・ヒ・ー = 4 moras
      assert.equal(countMoras('コーヒー'), 4);
      // パ・ー・テ・ィ = 4 moras (パ=1, ー=1, ティ=1)
      assert.equal(countMoras('パーティー'), 4);
    });

    test('empty or invalid input handling', () => {
      assert.equal(countMoras(''), 0);
      assert.equal(countMoras('   '), 0);
    });
  });

  describe('analyzeReadingPhoneticWeight', () => {
    test('sokuon (っ) has 0.8 acoustic duration while chōonpu (ー) has 1.2 duration', () => {
      // ちょ(1.05) + っ(0.80) + と(1.00) = 2.85
      assert.ok(Math.abs(analyzeReadingPhoneticWeight('ちょっと') - (2.85)) < 0.5 * 10 ** -2);
      // コ(1.00) + ー(1.20) + ヒ(1.00) + ー(1.20) = 4.40
      assert.ok(Math.abs(analyzeReadingPhoneticWeight('コーヒー') - (4.40)) < 0.5 * 10 ** -2);
      // さ(1.00) + ん(1.00) + ぽ(1.00) = 3.00
      assert.ok(Math.abs(analyzeReadingPhoneticWeight('さんぽ') - (3.00)) < 0.5 * 10 ** -2);
    });
  });

  describe('getTokenPhoneticWeight', () => {
    test('token with furigana takes precedence and applies content word boost', () => {
      // '駅' is 名詞 (content word boost 1.08), furigana 'えき' is 2 moras -> 2 * 1.08 = 2.16
      const token: TokenData = { word: '駅', pos: '名詞', furigana: 'えき' };
      assert.ok(Math.abs(getTokenPhoneticWeight(token) - (2.16)) < 0.5 * 10 ** -2);

      // '学校' is 名詞, furigana 'がっこう': が(1) + っ(0.8) + こ(1) + う(1) = 3.8 * 1.08 = 4.104
      const gakkou: TokenData = { word: '学校', pos: '名詞', furigana: 'がっこう' };
      assert.ok(Math.abs(getTokenPhoneticWeight(gakkou) - (4.10)) < 0.5 * 10 ** -1);
    });

    test('single-mora particles have clitic reduction with min visibility threshold', () => {
      // 1-mora particles: は, が, に, を: 1 * 0.90 -> min 0.95
      assert.equal(getTokenPhoneticWeight({ word: 'は', pos: '助詞' }), 0.95);
      assert.equal(getTokenPhoneticWeight({ word: 'が', pos: '助詞' }), 0.95);
      assert.equal(getTokenPhoneticWeight({ word: 'に', pos: '助詞' }), 0.95);
      // 2-mora particle: から: 2 * 0.90 = 1.80
      assert.ok(Math.abs(getTokenPhoneticWeight({ word: 'から', pos: '助詞' }) - (1.80)) < 0.5 * 10 ** -2);
    });

    test('punctuation pause weighting', () => {
      assert.equal(getTokenPhoneticWeight({ word: '。', pos: '記号' }), 1.2);
      assert.equal(getTokenPhoneticWeight({ word: '、', pos: '記号' }), 0.8);
      assert.equal(getTokenPhoneticWeight({ word: '！', pos: '记号' }), 1.2);
      assert.equal(getTokenPhoneticWeight({ word: '\n', pos: '改行' }), 2.0);
    });

    test('brackets have minimal pause', () => {
      assert.equal(getTokenPhoneticWeight({ word: '「', pos: '记号' }), 0.05);
      assert.equal(getTokenPhoneticWeight({ word: '」', pos: '记号' }), 0.05);
    });
  });

  describe('calculateMoraTimeline & getActiveTokenIndexAtTime', () => {
    test('accurately distributes durations across sentence tokens including particles and supports lookup with visual lead', () => {
      const tokens: TokenData[] = [
        { word: '今日', pos: '名詞', furigana: 'きょう' },
        { word: 'は', pos: '助詞', furigana: 'は' },
        { word: '良い', pos: '形容詞', furigana: 'いい' },
        { word: '天気', pos: '名詞', furigana: 'てんき' },
        { word: 'です', pos: '助動詞', furigana: 'です' },
        { word: '。', pos: '記号' },
      ];
      const totalDuration = 2.4;
      const cues = calculateMoraTimeline(tokens, totalDuration, 0.0, 0.0);

      assert.equal(cues.length, 6);
      assert.equal(cues[0].startTime, 0);
      assert.equal(cues[cues.length - 1].endTime, 2.4);

      // Verify particle 'は' receives >= 0.15s duration
      const haCue = cues[1];
      assert.equal(haCue.word, 'は');
      assert.ok(haCue.endTime - haCue.startTime >= 0.15);

      // Verify chronological ordering
      for (let i = 0; i < cues.length - 1; i++) {
        assert.ok(cues[i].startTime < cues[i].endTime);
        assert.ok(Math.abs(cues[i].endTime - (cues[i + 1].startTime)) < 0.5 * 10 ** -4);
      }

      // Without visualLead (visualLead = 0)
      assert.equal(getActiveTokenIndexAtTime(cues, 0.1, 0), 0);
      assert.equal(getActiveTokenIndexAtTime(cues, haCue.startTime + 0.02, 0), 1);

      // With default visual lead (~90ms)
      assert.equal(getActiveTokenIndexAtTime(cues, haCue.startTime - 0.05), 1);

      // Out of bounds
      assert.equal(getActiveTokenIndexAtTime(cues, -1), -1);
      assert.equal(getActiveTokenIndexAtTime(cues, 3.5), -1);
    });
  });

  describe('alignWordBoundariesToTokens (Edge TTS Ground Truth alignment)', () => {
    test('keeps UTF-16 offsets consistent across emoji, supplementary kanji and repeated words', () => {
      const tokens = ['😀', '𠮷野', '、', '猫', '猫'].map(word => ({ word, pos: '名詞' }));
      const cues = alignWordBoundariesToTokens(tokens, [
        { word: '😀', startTime: 0.1, endTime: 0.2 },
        { word: '𠮷野', startTime: 0.3, endTime: 0.5 },
        { word: '猫', startTime: 0.8, endTime: 1 },
        { word: '猫', startTime: 1.2, endTime: 1.4 },
      ]);
      assert.deepEqual(cues.map(cue => cue.tokenIndex), [0, 1, 3, 4]);
      assert.equal(getActiveTokenIndexAtTime(cues, 0, 0), -1);
      assert.equal(getActiveTokenIndexAtTime(cues, 0.6, 0), 1, 'Keep the previous word highlighted through a pause');
      assert.equal(getActiveTokenIndexAtTime(cues, 0.8, 0), 3);
      assert.equal(getActiveTokenIndexAtTime(cues, 1.2, 0), 4);
      assert.equal(getActiveTokenIndexAtTime(cues, 2, 0), -1);
    });
    test('accurately maps real Microsoft Edge TTS WordBoundary events to TokenData without punctuation offsets', () => {
      const tokens: TokenData[] = [
        { word: '天気', furigana: 'てんき', pos: '名詞' }, // tokenIndex 0
        { word: 'が', furigana: '', pos: '助詞' },         // tokenIndex 1
        { word: 'いい', furigana: 'いい', pos: '形容詞' },    // tokenIndex 2
        { word: 'から', furigana: 'から', pos: '助詞' },     // tokenIndex 3
        { word: '、', furigana: '', pos: '記号' },         // tokenIndex 4 (punct, skipped)
        { word: '散歩', furigana: 'さんぽ', pos: '名詞' },   // tokenIndex 5
        { word: 'し', furigana: '', pos: '動詞' },         // tokenIndex 6
        { word: 'ましょう', furigana: 'ましょう', pos: '助動詞' }, // tokenIndex 7
        { word: '。', furigana: '', pos: '記号' },         // tokenIndex 8 (punct, skipped)
      ];

      // Real Edge TTS WordBoundary output
      const edgeBoundaries = [
        { word: '天気', startTime: 0.125, endTime: 0.438 },
        { word: 'が', startTime: 0.450, endTime: 0.550 },
        { word: 'いい', startTime: 0.563, endTime: 0.775 },
        { word: 'から', startTime: 0.788, endTime: 1.113 },
        { word: '散歩', startTime: 1.338, endTime: 1.713 },
        { word: 'し', startTime: 1.725, endTime: 1.875 },
        { word: 'ましょう', startTime: 1.888, endTime: 2.400 },
      ];

      const alignedCues = alignWordBoundariesToTokens(tokens, edgeBoundaries);

      assert.equal(alignedCues.length, 7);
      assert.deepEqual(alignedCues[0], { tokenIndex: 0, word: '天気', startTime: 0.125, endTime: 0.438 });
      assert.deepEqual(alignedCues[1], { tokenIndex: 1, word: 'が', startTime: 0.450, endTime: 0.550 });
      assert.deepEqual(alignedCues[2], { tokenIndex: 2, word: 'いい', startTime: 0.563, endTime: 0.775 });
      assert.deepEqual(alignedCues[3], { tokenIndex: 3, word: 'から', startTime: 0.788, endTime: 1.113 });
      assert.deepEqual(alignedCues[4], { tokenIndex: 5, word: '散歩', startTime: 1.338, endTime: 1.713 });
      assert.deepEqual(alignedCues[5], { tokenIndex: 6, word: 'し', startTime: 1.725, endTime: 1.875 });
      assert.deepEqual(alignedCues[6], { tokenIndex: 7, word: 'ましょう', startTime: 1.888, endTime: 2.400 });

      // Precise playback lookup at ground truth timestamps
      assert.equal(getActiveTokenIndexAtTime(alignedCues, 0.48, 0), 1); // Exactly at particle "が"
      assert.equal(getActiveTokenIndexAtTime(alignedCues, 0.60, 0), 2); // Exactly at "いい"
      assert.equal(getActiveTokenIndexAtTime(alignedCues, 1.50, 0), 5); // Exactly at "散歩"
    });
  });
});
