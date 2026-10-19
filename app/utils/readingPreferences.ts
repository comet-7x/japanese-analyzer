export interface ReadingPreferences { showFurigana: boolean; showRomaji: boolean; viewMode: 'lexical' | 'reading'; }
export const DEFAULT_READING_PREFERENCES: ReadingPreferences = { showFurigana: true, showRomaji: false, viewMode: 'lexical' };
export const READING_PREFERENCES_KEY = 'japaneseAnalyzer:reading:v1';
export function parseReadingPreferences(raw: string | null): ReadingPreferences {
  try { const data = JSON.parse(raw || '{}'); return { showFurigana: typeof data.showFurigana === 'boolean' ? data.showFurigana : true, showRomaji: typeof data.showRomaji === 'boolean' ? data.showRomaji : false, viewMode: data.viewMode === 'reading' ? 'reading' : 'lexical' }; } catch { return { ...DEFAULT_READING_PREFERENCES }; }
}
