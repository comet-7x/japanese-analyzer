'use client';

import { useLayoutEffect, type RefObject } from 'react';
import type { TokenData } from '../services/api';
import { speechRangeProgress } from '../lib/speechReading';
import { getSpeechReadingFrame, subscribeSpeechReadingFrame, type SpeechReadingFrame } from '../lib/speechReadingStore';
import { setSpeechSweep } from '../lib/speechSweep';

/** A single local paint subscriber; audio frames never render the sentence tree. */
export default function SpeechReadingHighlight({ containerRef, tokens, layoutKey }: {
  containerRef: RefObject<HTMLDivElement | null>;
  tokens: TokenData[];
  layoutKey: unknown;
}) {
  useLayoutEffect(() => {
    const text = tokens.map(token => token.word).join('');
    let offset = 0;
    const ranges = tokens.map(token => {
      const range = { start: offset, end: offset + token.word.length };
      offset = range.end;
      return range;
    });
    const entries = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('.word-unit-wrapper[data-token-index]') ?? []).flatMap(element => {
      const start = ranges[Number(element.dataset.tokenIndex)];
      const end = ranges[Number(element.dataset.tokenEnd ?? element.dataset.tokenIndex)];
      return start && end ? [{ element, start: start.start, end: end.end }] : [];
    });
    let previous: typeof entries[number] | null = null;
    const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
    let latest = getSpeechReadingFrame();
    const paint = (reading: SpeechReadingFrame | null) => {
      latest = reading;
      const matching = reading?.text === text && reading.end > reading.start;
      const point = matching ? Math.min(reading.end - 1e-7, reading.start + (reading.end - reading.start) * reading.progress) : -1;
      const next = matching ? previous && previous.start <= point && previous.end > point ? previous
        : entries.find(entry => entry.start <= point && entry.end > point) ?? null : null;
      if (previous !== next) {
        previous?.element.removeAttribute('data-reading-current');
        next?.element.setAttribute('data-reading-current', 'true');
      }
      if (next && reading) setSpeechSweep(next.element, media?.matches ? 1 : speechRangeProgress(reading, next), 10);
      previous = next;
    };
    const onPreference = () => paint(latest);
    const unsubscribe = subscribeSpeechReadingFrame(paint);
    paint(getSpeechReadingFrame());
    media?.addEventListener('change', onPreference);
    return () => {
      unsubscribe();
      media?.removeEventListener('change', onPreference);
      previous?.element.removeAttribute('data-reading-current');
    };
  }, [containerRef, tokens, layoutKey]);
  return null;
}
