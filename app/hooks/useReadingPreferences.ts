'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserStorage } from '../utils/storage';
import { DEFAULT_READING_PREFERENCES, parseReadingPreferences, READING_PREFERENCES_KEY, type ReadingPreferences } from '../utils/readingPreferences';

export function useReadingPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_READING_PREFERENCES);
  const hydrated = useRef(false);
  useEffect(() => {
    setPreferences(parseReadingPreferences(browserStorage.getItem(READING_PREFERENCES_KEY)));
    hydrated.current = true;
  }, []);
  const change = useCallback(<K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]) => {
    setPreferences(previous => { const next = { ...previous, [key]: value }; if (hydrated.current) browserStorage.setItem(READING_PREFERENCES_KEY, JSON.stringify(next)); return next; });
  }, []);
  return { preferences, change };
}
