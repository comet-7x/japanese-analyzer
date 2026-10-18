import { test, expect, describe } from 'bun:test';
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
      expect(countMoras('ありがとう')).toBe(5);
      // さ・く・ら = 3 moras
      expect(countMoras('さくら')).toBe(3);
      // ね・こ = 2 moras
      expect(countMoras('ねこ')).toBe(2);
    });

    test('yōon (contracted small kana) combines with base kana to form 1 mora', () => {
      // きょ・う・りゅ・う = 4 moras
      expect(countMoras('きょうりゅう')).toBe(4);
      // と・う・きょ・う = 4 moras
      expect(countMoras('とうきょう')).toBe(4);
      // しゃ・し・ん = 3 moras (しゃ=1, し=1, ん=1)
      expect(countMoras('しゃしん')).toBe(3);
    });

    test('sokuon (っ) and hatsuon (ん) count as 1 mora each', () => {
      // ちょ・っ・と = 3 moras (ちょ=1, っ=1, と=1)
      expect(countMoras('ちょっと')).toBe(3);
      // が・っ・こ・う = 4 moras
      expect(countMoras('がっこう')).toBe(4);
      // に・っ・ぽ・ん = 4 moras
      expect(countMoras('にっぽん')).toBe(4);
    });

    test('chōonpu (ー) counts as 1 mora in Katakana loanwords', () => {
      // チョ・コ・レ・ー・ト = 5 moras
      expect(countMoras('チョコレート')).toBe(5);
      // コ・ー・ヒ・ー = 4 moras
      expect(countMoras('コーヒー')).toBe(4);
      // パ・ー・テ・ィ = 4 moras (パ=1, ー=1, ティ=1)
      expect(countMoras('パーティー')).toBe(4);
    });

    test('empty or invalid input handling', () => {
      expect(countMoras('')).toBe(0);
      expect(countMoras('   ')).toBe(0);
    });
  });

  describe('analyzeReadingPhoneticWeight', () => {
    test('sokuon (っ) has 0.8 acoustic duration while chōonpu (ー) has 1.2 duration', () => {
      // ちょ(1.05) + っ(0.80) + と(1.00) = 2.85
      expect(analyzeReadingPhoneticWeight('ちょっと')).toBeCloseTo(2.85, 2);
      // コ(1.00) + ー(1.20) + ヒ(1.00) + ー(1.20) = 4.40
      expect(analyzeReadingPhoneticWeight('コーヒー')).toBeCloseTo(4.40, 2);
      // さ(1.00) + ん(1.00) + ぽ(1.00) = 3.00
      expect(analyzeReadingPhoneticWeight('さんぽ')).toBeCloseTo(3.00, 2);
    });
  });

  describe('getTokenPhoneticWeight', () => {
    test('token with furigana takes precedence and applies content word boost', () => {
      // '駅' is 名詞 (content word boost 1.08), furigana 'えき' is 2 moras -> 2 * 1.08 = 2.16
      const token: TokenData = { word: '駅', pos: '名詞', furigana: 'えき' };
      expect(getTokenPhoneticWeight(token)).toBeCloseTo(2.16, 2);

      // '学校' is 名詞, furigana 'がっこう': が(1) + っ(0.8) + こ(1) + う(1) = 3.8 * 1.08 = 4.104
      const gakkou: TokenData = { word: '学校', pos: '名詞', furigana: 'がっこう' };
      expect(getTokenPhoneticWeight(gakkou)).toBeCloseTo(4.10, 1);
    });

    test('single-mora particles have clitic reduction with min visibility threshold', () => {
      // 1-mora particles: は, が, に, を: 1 * 0.90 -> min 0.95
      expect(getTokenPhoneticWeight({ word: 'は', pos: '助詞' })).toBe(0.95);
      expect(getTokenPhoneticWeight({ word: 'が', pos: '助詞' })).toBe(0.95);
      expect(getTokenPhoneticWeight({ word: 'に', pos: '助詞' })).toBe(0.95);
      // 2-mora particle: から: 2 * 0.90 = 1.80
      expect(getTokenPhoneticWeight({ word: 'から', pos: '助詞' })).toBeCloseTo(1.80, 2);
    });

    test('punctuation pause weighting', () => {
      expect(getTokenPhoneticWeight({ word: '。', pos: '記号' })).toBe(1.2);
      expect(getTokenPhoneticWeight({ word: '、', pos: '記号' })).toBe(0.8);
      expect(getTokenPhoneticWeight({ word: '！', pos: '记号' })).toBe(1.2);
      expect(getTokenPhoneticWeight({ word: '\n', pos: '改行' })).toBe(2.0);
    });

    test('brackets have minimal pause', () => {
      expect(getTokenPhoneticWeight({ word: '「', pos: '记号' })).toBe(0.05);
      expect(getTokenPhoneticWeight({ word: '」', pos: '记号' })).toBe(0.05);
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

      expect(cues.length).toBe(6);
      expect(cues[0].startTime).toBe(0);
      expect(cues[cues.length - 1].endTime).toBe(2.4);

      // Verify particle 'は' receives >= 0.15s duration
      const haCue = cues[1];
      expect(haCue.word).toBe('は');
      expect(haCue.endTime - haCue.startTime).toBeGreaterThanOrEqual(0.15);

      // Verify chronological ordering
      for (let i = 0; i < cues.length - 1; i++) {
        expect(cues[i].startTime).toBeLessThan(cues[i].endTime);
        expect(cues[i].endTime).toBeCloseTo(cues[i + 1].startTime, 4);
      }

      // Without visualLead (visualLead = 0)
      expect(getActiveTokenIndexAtTime(cues, 0.1, 0)).toBe(0);
      expect(getActiveTokenIndexAtTime(cues, haCue.startTime + 0.02, 0)).toBe(1);

      // With default visual lead (~90ms)
      expect(getActiveTokenIndexAtTime(cues, haCue.startTime - 0.05)).toBe(1);

      // Out of bounds
      expect(getActiveTokenIndexAtTime(cues, -1)).toBe(-1);
      expect(getActiveTokenIndexAtTime(cues, 3.5)).toBe(-1);
    });
  });

  describe('alignWordBoundariesToTokens (Edge TTS Ground Truth alignment)', () => {
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

      expect(alignedCues.length).toBe(7);
      expect(alignedCues[0]).toEqual({ tokenIndex: 0, word: '天気', startTime: 0.125, endTime: 0.438 });
      expect(alignedCues[1]).toEqual({ tokenIndex: 1, word: 'が', startTime: 0.450, endTime: 0.550 });
      expect(alignedCues[2]).toEqual({ tokenIndex: 2, word: 'いい', startTime: 0.563, endTime: 0.775 });
      expect(alignedCues[3]).toEqual({ tokenIndex: 3, word: 'から', startTime: 0.788, endTime: 1.113 });
      expect(alignedCues[4]).toEqual({ tokenIndex: 5, word: '散歩', startTime: 1.338, endTime: 1.713 });
      expect(alignedCues[5]).toEqual({ tokenIndex: 6, word: 'し', startTime: 1.725, endTime: 1.875 });
      expect(alignedCues[6]).toEqual({ tokenIndex: 7, word: 'ましょう', startTime: 1.888, endTime: 2.400 });

      // Precise playback lookup at ground truth timestamps
      expect(getActiveTokenIndexAtTime(alignedCues, 0.48, 0)).toBe(1); // Exactly at particle "が"
      expect(getActiveTokenIndexAtTime(alignedCues, 0.60, 0)).toBe(2); // Exactly at "いい"
      expect(getActiveTokenIndexAtTime(alignedCues, 1.50, 0)).toBe(5); // Exactly at "散歩"
    });
  });
});
