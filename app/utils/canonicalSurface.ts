let segmenter: Intl.Segmenter | undefined;

/** Restore original code units after proving NFC (not NFKC) equivalence.
 * Changing Unicode sequences must stay whole; CR/LF may retain their separate
 * original tokens. No searching, source normalization or missing-text repair. */
export function restoreCanonicalWords(original: string, words: readonly string[]): string[] | null {
  if (!words.length || words.some(word => !word)) return null;
  if (words.join('') === original) return [...words];
  const canonical = original.normalize('NFC');
  const normalizedWords = words.map(word => word.normalize('NFC'));
  // Normalizing tokens separately also rejects a boundary through a combining
  // sequence that would compose only when the model's words are joined.
  if (normalizedWords.join('') !== canonical || typeof Intl.Segmenter !== 'function') return null;
  segmenter ??= new Intl.Segmenter('ja', { granularity: 'grapheme' });
  const boundaries = new Map<number, number>([[0, 0]]);
  let normalizedOffset = 0;
  let concatenated = '';
  for (const part of segmenter.segment(original)) {
    const value = part.segment.normalize('NFC');
    // The local parser represents CR and LF separately, although Unicode treats
    // CRLF as one grapheme. This boundary is exact and never changes encoding.
    if (part.segment === '\r\n') boundaries.set(normalizedOffset + 1, part.index + 1);
    concatenated += value;
    normalizedOffset += value.length;
    boundaries.set(normalizedOffset, part.index + part.segment.length);
  }
  if (concatenated !== canonical) return null;
  let cursor = 0, start = 0;
  const restored: string[] = [];
  for (const word of normalizedWords) {
    cursor += word.length;
    const end = boundaries.get(cursor);
    if (end === undefined || end <= start) return null;
    restored.push(original.slice(start, end));
    start = end;
  }
  return start === original.length && restored.join('') === original ? restored : null;
}
