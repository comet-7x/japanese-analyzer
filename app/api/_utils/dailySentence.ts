import type { Locale } from '../../i18n';
import { isDailySentenceText, isSentenceAttribution, type DailySentence } from '../../utils/dailySentences';
export function parseDailySentenceCandidates(value: unknown, date: string): DailySentence[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { data?: unknown }).data)) return [];
  const result: DailySentence[] = [];
  for (const raw of (value as { data: unknown[] }).data.slice(0, 12)) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (row.lang !== 'jpn' || row.is_unapproved !== false || !isSentenceAttribution(row) || !isDailySentenceText(row.text)) continue;
    if (result.some(item => item.text === row.text || item.source?.id === row.id)) continue;
    const sentence: DailySentence = { date, text: row.text, tokens: [], translation: {}, source: {
      provider: 'tatoeba', id: row.id, license: row.license, translations: {},
    } };
    for (const rawTranslation of Array.isArray(row.translations) ? row.translations.slice(0, 100) : []) {
      if (!rawTranslation || typeof rawTranslation !== 'object') continue;
      const tr = rawTranslation as Record<string, unknown>;
      if (!isSentenceAttribution(tr) || tr.is_direct !== true || tr.is_unapproved !== false
        || typeof tr.text !== 'string' || !tr.text.trim() || tr.text.length > 240 || /[<>\r\n]/.test(tr.text)) continue;
      // Preserve the contributor's script; do not present unconverted traditional Chinese as simplified (or vice versa).
      const locale: Locale | null = tr.lang === 'eng' ? 'en' : tr.lang === 'kor' ? 'ko'
        : tr.lang === 'cmn' && tr.script === 'Hant' ? 'zh-TW' : tr.lang === 'cmn' && tr.script === 'Hans' ? 'zh-CN' : null;
      if (locale && !sentence.translation[locale]) {
        sentence.translation[locale] = tr.text.trim();
        sentence.source!.translations[locale] = { id: tr.id, license: tr.license };
      }
    }
    result.push(sentence);
  }
  return result;
}
