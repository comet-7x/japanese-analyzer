import type { SchoolToken } from '../../../app/utils/localTokens';
export { schoolTokens, type RawToken, type SchoolToken } from '../../../app/utils/localTokens';

export function scoreTokens(actual: SchoolToken[], expected: readonly (readonly [string, string, string])[], readingAlternatives: Record<number, readonly string[]> = {}) {
  let cursor = 0;
  const gold = expected.map(([word, pos, reading]) => { const token = { word, pos, reading, start: cursor, end: cursor + word.length }; cursor += word.length; return token; });
  const spans = new Map(actual.map(t => [`${t.start}:${t.end}`, t]));
  let boundaries = 0, posCorrect = 0, readingCorrect = 0, complete = 0;
  for (const [index, token] of gold.entries()) {
    const found = spans.get(`${token.start}:${token.end}`);
    if (!found) continue;
    boundaries++;
    if (found.pos === token.pos) posCorrect++;
    const validReading = found.reading === token.reading || readingAlternatives[index]?.includes(found.reading);
    if (validReading) readingCorrect++;
    if (found.pos === token.pos && validReading) complete++;
  }
  return { expected: gold.length, actual: actual.length, spansCorrect: boundaries, posCorrect, readingCorrect, complete,
    spanF1: 2 * boundaries / (gold.length + actual.length), exact: complete === gold.length && actual.length === gold.length };
}

export function scoreReadings(source: string, tokens: SchoolToken[], targets: { word: string; readings: string[] }[]) {
  return targets.map(target => {
    const start = source.indexOf(target.word);
    if (start < 0 || source.indexOf(target.word, start + 1) >= 0) throw new Error('Reading target must be unique');
    const end = start + target.word.length;
    const found = tokens.filter(t => t.end > start && t.start < end);
    const aligned = found.length > 0 && found[0].start === start && found.at(-1)!.end === end;
    const reading = aligned ? found.map(t => t.reading).join('') : '';
    return { start, end, aligned, passed: aligned && target.readings.includes(reading) };
  });
}
