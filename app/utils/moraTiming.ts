import type { TokenData } from '../services/api';

/**
 * Regex matching base kana followed by optional glide / small yōon kana.
 * Small yōon (ゃゅょ etc.) combine with preceding base kana into a single mora.
 * Small sokuon (っ / ッ), hatsuon (ん / ン), and chōonpu (ー) count as a full mora each.
 */
const MORA_REGEX = /[\u3041-\u3096\u30A0-\u30FFー][ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]?/gu;

/**
 * Count the phonetic moras (モーラ/拍) in a kana reading.
 * If reading contains Kanji or is empty, falls back to character length.
 */
export function countMoras(kanaOrText: string): number {
  if (!kanaOrText || !kanaOrText.trim()) return 0;
  const matches = kanaOrText.match(MORA_REGEX);
  if (matches && matches.length > 0) {
    return matches.length;
  }
  // Fallback for non-kana text (ASCII, numbers, or unread Kanji): 1 weight per 2 chars, min 1
  return Math.max(1, Math.ceil(kanaOrText.trim().length * 0.8));
}

/**
 * Phonetic weight calculation for an individual token's reading.
 * Deconstructs kana into acoustic mora segments:
 * - Plain mora (直音 / 拗音): ~1.0
 * - Sokuon (促音 っ/ッ): ~0.80 (shorter silent plosive closure)
 * - Chōonpu (长音 ー): ~1.20 (prolonged vowel resonance)
 * - Hatsuon (拨音 ん/ン): ~1.00 (moraic nasal)
 */
export function analyzeReadingPhoneticWeight(reading: string): number {
  if (!reading || !reading.trim()) return 0;
  const segments = reading.match(MORA_REGEX);
  if (!segments || segments.length === 0) {
    return Math.max(1, Math.ceil(reading.trim().length * 0.8));
  }
  let total = 0;
  for (const seg of segments) {
    if (seg === 'っ' || seg === 'ッ') {
      total += 0.80; // Sokuon has shorter closure duration in natural speech
    } else if (seg === 'ー') {
      total += 1.20; // Chōon has longer acoustic duration
    } else if (seg === 'ん' || seg === 'ン') {
      total += 1.00; // Hatsuon nasal mora
    } else if (seg.length > 1) {
      total += 1.05; // Yōon (glide + vowel)
    } else {
      total += 1.00; // Plain mora
    }
  }
  return total;
}

/**
 * Phonetic weight calculation for an isolated TokenData unit (backward-compatible).
 */
export function getTokenPhoneticWeight(token: TokenData): number {
  const word = token.word || '';
  const furigana = token.furigana?.trim();

  // Whitespace and newline
  if (/^\n+$/.test(word)) return 2.0;
  if (/^\s+$/.test(word)) return 0.3;

  // Punctuation pause weights
  if (/[。！？!?]/.test(word)) return 1.2;
  if (/[、，,]/.test(word)) return 0.8;
  if (/[…—~〜]/.test(word)) return 1.0;
  if (/^[「」『』（）()[\]【】"'\-:]+$/.test(word)) return 0.05;

  const reading = furigana || word;
  let weight = analyzeReadingPhoneticWeight(reading);

  const pos = token.pos || '';
  const isParticle = /助詞|助词/.test(pos) && !/助動詞|助动词/.test(pos);
  const isAuxiliary = /助動詞|助动词/.test(pos);
  const isContentWord = /名詞|名词|動詞|动词|形容詞|形容词|副詞|副词|連体詞|连体词/.test(pos);

  if (isParticle) {
    weight *= 0.90;
    if (weight < 0.95) weight = 0.95;
  } else if (isAuxiliary) {
    weight *= 0.92;
  } else if (isContentWord) {
    weight *= 1.08;
  }

  return Math.max(0.5, weight);
}

/**
 * Full contextual prosody model:
 * Calculates token weights taking into account grammatical categories and
 * prosodic boundary lengthening (phrase-final / sentence-final lengthening).
 */
export function calculateContextualPhoneticWeights(tokens: TokenData[]): number[] {
  const n = tokens.length;
  const weights: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const token = tokens[i];
    const word = token.word || '';
    const furigana = token.furigana?.trim();

    // 1. Whitespace & linebreaks
    if (/^\n+$/.test(word)) { weights[i] = 2.0; continue; }
    if (/^\s+$/.test(word)) { weights[i] = 0.3; continue; }

    // 2. Punctuations
    if (/[。！？!?]/.test(word)) { weights[i] = 1.2; continue; }
    if (/[、，,]/.test(word)) { weights[i] = 0.8; continue; }
    if (/[…—~〜]/.test(word)) { weights[i] = 1.0; continue; }
    if (/^[「」『』（）()[\]【】"'\-:]+$/.test(word)) { weights[i] = 0.05; continue; }

    // 3. Acoustic mora decomposition
    const reading = furigana || word;
    let baseWeight = analyzeReadingPhoneticWeight(reading);

    // 4. POS (Part of Speech) dynamics
    const pos = token.pos || '';
    const isParticle = /助詞|助词/.test(pos) && !/助動詞|助动词/.test(pos);
    const isAuxiliary = /助動詞|助动词/.test(pos);
    const isContentWord = /名詞|名词|動詞|动词|形容詞|形容词|副詞|副词|連体詞|连体词/.test(pos);

    if (isParticle) {
      baseWeight *= 0.90;
      if (baseWeight < 0.95) baseWeight = 0.95;
    } else if (isAuxiliary) {
      baseWeight *= 0.92;
    } else if (isContentWord) {
      baseWeight *= 1.08;
    }

    // 5. Prosodic boundary lengthening
    const nextToken = i + 1 < n ? tokens[i + 1] : null;
    const isSentenceFinal = !nextToken || /[。！？!?]/.test(nextToken.word || '') || i === n - 1;
    const isClauseFinal = nextToken && /[、，,]/.test(nextToken.word || '');

    if (isSentenceFinal) {
      baseWeight *= 1.20; // Final lengthening before sentence conclusion
    } else if (isClauseFinal) {
      baseWeight *= 1.10; // Clause-final deceleration before comma
    }

    weights[i] = Math.max(0.5, baseWeight);
  }

  return weights;
}

export interface TokenTimeCue {
  tokenIndex: number;
  word: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
}

/**
 * Generate a timeline of start/end times for each token given the total audio duration.
 *
 * @param tokens The parsed tokens of the sentence
 * @param totalDuration Total duration of the audio in seconds
 * @param leadPadding Acoustic lead silence before speech onset (~0.02s)
 * @param tailPadding Acoustic trail silence after last sound (~0.05s)
 */
export function calculateMoraTimeline(
  tokens: TokenData[],
  totalDuration: number,
  leadPadding = 0.02,
  tailPadding = 0.05
): TokenTimeCue[] {
  if (!tokens || tokens.length === 0 || totalDuration <= 0) {
    return [];
  }

  // Ensure paddings don't exceed audio duration
  const availableDuration = Math.max(0.1, totalDuration - leadPadding - tailPadding);
  const actualLead = totalDuration > leadPadding + tailPadding ? leadPadding : 0;

  // Compute contextual weights for all tokens
  const weights = calculateContextualPhoneticWeights(tokens);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  if (totalWeight <= 0) return [];

  const timePerWeight = availableDuration / totalWeight;

  let currentStart = actualLead;
  const cues: TokenTimeCue[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const duration = weights[i] * timePerWeight;
    const endTime = i === tokens.length - 1 ? totalDuration : currentStart + duration;

    cues.push({
      tokenIndex: i,
      word: tokens[i].word,
      startTime: currentStart,
      endTime,
    });

    currentStart = endTime;
  }

  return cues;
}

/**
 * Find the active tokenIndex for a given audio playback time in seconds.
 * Includes a smooth visual anticipation offset (default 90ms) to counteract
 * auditory-visual latency (human auditory onset detection vs visual cortical perception).
 *
 * @param cues The calculated token timeline cues
 * @param currentTime Current audio playback time in seconds
 * @param visualLead Visual anticipation offset in seconds (default 0.09s = 90ms)
 * @returns tokenIndex or -1 if outside valid range
 */
export function getActiveTokenIndexAtTime(
  cues: TokenTimeCue[],
  currentTime: number,
  visualLead = 0.09
): number {
  if (!cues || cues.length === 0 || currentTime < 0) return -1;

  // Smooth ramp-in for the very first 150ms of audio to prevent initial jump
  const effectiveLead = currentTime < 0.15
    ? visualLead * (currentTime / 0.15)
    : visualLead;

  const adjustedTime = Math.max(0, currentTime + effectiveLead);

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (adjustedTime >= cue.startTime && adjustedTime < cue.endTime) {
      return cue.tokenIndex;
    }
  }

  // If at or past the end of the last cue
  const lastCue = cues[cues.length - 1];
  if (adjustedTime >= lastCue.startTime && adjustedTime <= lastCue.endTime + 0.3) {
    return lastCue.tokenIndex;
  }

  return -1;
}

/**
 * Align real TTS WordBoundary events (such as Microsoft Edge TTS ground truth)
 * to parsed sentence tokens based on text span overlap.
 */
export function alignWordBoundariesToTokens(
  tokens: TokenData[],
  boundaries: Array<{ word: string; startTime: number; endTime: number }>
): TokenTimeCue[] {
  if (!tokens || tokens.length === 0 || !boundaries || boundaries.length === 0) {
    return [];
  }

  const fullSentence = tokens.map(t => t.word || '').join('');

  // Map each boundary to character offset in fullSentence
  let searchIndex = 0;
  const boundaryRanges: Array<{
    word: string;
    startTime: number;
    endTime: number;
    start: number;
    end: number;
  }> = [];

  for (const b of boundaries) {
    const idx = fullSentence.indexOf(b.word, searchIndex);
    if (idx !== -1) {
      const charLen = Array.from(b.word).length;
      boundaryRanges.push({
        ...b,
        start: idx,
        end: idx + charLen,
      });
      searchIndex = idx + charLen;
    }
  }

  // Map each non-punctuation token to its character range and match overlapping boundaries
  let charPos = 0;
  const cues: TokenTimeCue[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const len = Array.from(t.word || '').length;
    const start = charPos;
    const end = charPos + len;
    charPos = end;

    const isPunct = !t.word
      || /^\s+$/.test(t.word)
      || /^[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\r\n\t]+$/.test(t.word);
    if (isPunct) continue;

    const overlaps = boundaryRanges.filter(br => br.start < end && br.end > start);
    if (overlaps.length > 0) {
      cues.push({
        tokenIndex: i,
        word: t.word,
        startTime: overlaps[0].startTime,
        endTime: overlaps[overlaps.length - 1].endTime,
      });
    }
  }

  return cues;
}
