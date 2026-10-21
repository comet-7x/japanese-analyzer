import type { TokenData } from '../services/api';
import { calculateMoraTimeline } from '../utils/moraTiming';

export interface TextSpan { start: number; end: number }
export interface SpeechBoundary { word: string; startTime: number; endTime: number }
export interface SpeechTextCue extends TextSpan { startTime: number; endTime: number }
export interface SpeechTiming {
  boundaries?: readonly SpeechBoundary[];
  tokens?: TokenData[];
}

/** Media time is the authority; no easing or spring may delay this progress. */
export function speechCueProgress(cue: SpeechTextCue, seconds: number): number {
  const duration = cue.endTime - cue.startTime;
  if (!Number.isFinite(seconds) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(1, (seconds - cue.startTime) / duration));
}

export function speechRangeProgress(frame: TextSpan & { progress: number }, range: TextSpan): number {
  if (range.end <= range.start) return 0;
  const position = frame.start + (frame.end - frame.start) * frame.progress;
  return Math.max(0, Math.min(1, (position - range.start) / (range.end - range.start)));
}

export function speechGraphemes(text: string): TextSpan[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text), part =>
      ({ start: part.index, end: part.index + part.segment.length }));
  }
  let offset = 0;
  return Array.from(text, char => {
    const span = { start: offset, end: offset + char.length };
    offset = span.end;
    return span;
  });
}

/** Offsets always refer to the original UTF-16 string, as Web Speech does. */
export function speechWords(text: string): TextSpan[] {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text), part =>
      ({ start: part.index, end: part.index + part.segment.length }));
  }
  let offset = 0;
  return Array.from(text, char => {
    const span = { start: offset, end: offset + char.length };
    offset = span.end;
    return span;
  });
}

export function alignSpeechBoundaries(text: string, boundaries: readonly SpeechBoundary[]): SpeechTextCue[] {
  const cues: SpeechTextCue[] = [];
  let offset = 0;
  let lastTime = -1;
  for (const boundary of boundaries) {
    if (!boundary.word || !Number.isFinite(boundary.startTime) || !Number.isFinite(boundary.endTime)
      || boundary.startTime < 0 || boundary.startTime < lastTime || boundary.endTime <= boundary.startTime) continue;
    const start = text.indexOf(boundary.word, offset);
    if (start < 0) continue;
    const end = start + boundary.word.length;
    cues.push({ start, end, startTime: boundary.startTime, endTime: boundary.endTime });
    offset = end;
    lastTime = boundary.startTime;
  }
  return cues;
}

export function estimateSpeechCues(text: string, duration: number, timing?: SpeechTiming): SpeechTextCue[] {
  if (!Number.isFinite(duration) || duration <= 0 || !text) return [];
  // Use the readings captured when this audio was requested, never a later analysis.
  const tokens = timing?.tokens?.map(token => ({ ...token })) ?? [];
  const matched = tokens.length > 0 && tokens.map(token => token.word).join('') === text;
  const units = matched ? tokens : speechWords(text).map(span => ({ word: text.slice(span.start, span.end), pos: '' }));
  let offset = 0;
  return calculateMoraTimeline(units, duration).map(cue => {
    const span = { start: offset, end: offset + cue.word.length, startTime: cue.startTime, endTime: cue.endTime };
    offset = span.end;
    return span;
  });
}

/** Keep the previous word through a pause, but never run ahead of the audio clock. */
export function speechCueAtTime(cues: readonly SpeechTextCue[], seconds: number): SpeechTextCue | null {
  if (!Number.isFinite(seconds) || seconds < 0 || cues.length === 0 || seconds < cues[0].startTime) return null;
  let low = 0;
  let high = cues.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (cues[middle].startTime <= seconds) low = middle;
    else high = middle - 1;
  }
  return cues[low];
}

export function tokenAtSpeechSpan(text: string, tokens: readonly TokenData[], span: TextSpan): number | null {
  if (tokens.map(token => token.word).join('') !== text) return null;
  let start = 0;
  let best: number | null = null;
  let overlap = 0;
  tokens.forEach((token, index) => {
    const end = start + token.word.length;
    const amount = Math.max(0, Math.min(end, span.end) - Math.max(start, span.start));
    if (amount > overlap) { best = index; overlap = amount; }
    start = end;
  });
  return best;
}

/** Sentence pages are bounded even when the source has no punctuation at all. */
export function speechPages(text: string, limit = 42): TextSpan[] {
  const graphemes = speechGraphemes(text).map(span => ({ text: text.slice(span.start, span.end), index: span.start }));
  const pages: TextSpan[] = [];
  const size = Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 42));
  let first = 0;
  while (first < graphemes.length) {
    let end = Math.min(graphemes.length, first + size);
    let softBreak = -1;
    let sentenceBreak = false;
    for (let i = first; i < end; i++) {
      const char = graphemes[i].text;
      if (/[。！？!?\n]/u.test(char) || (char === '.' && (i + 1 === graphemes.length || /\s/u.test(graphemes[i + 1].text)))) {
        end = i + 1;
        sentenceBreak = true;
        break;
      }
      if (/[、，,;；\s]/u.test(char) && i - first >= size / 2) softBreak = i + 1;
    }
    if (!sentenceBreak && end < graphemes.length && softBreak > first) end = softBreak;
    // A sentence-ending mark/quote must not become a page of its own.
    while (end < graphemes.length && end - first < size + 4 && /^[。！？!?」』”’）)】]$/u.test(graphemes[end].text)) end++;
    // Paragraph spacing belongs to the preceding page; it is trimmed only for display.
    while (end < graphemes.length && /^\s+$/u.test(graphemes[end].text)) end++;
    pages.push({ start: graphemes[first].index, end: end < graphemes.length ? graphemes[end].index : text.length });
    first = end;
  }
  return pages;
}
