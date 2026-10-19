import { NextRequest, NextResponse } from 'next/server';
import { normalizeLocale } from '../../i18n';
import { getJstDateKey, type DailySentence } from '../../utils/dailySentences';
import { fetchDailySentenceCandidates } from '../_utils/dailySentence';
import { requireApiSession } from '../_utils/sessionAuth';

export const dynamic = 'force-dynamic';
// At most four locale batches per date. Successful batches and concurrent requests are shared.
const batches = new Map<string, { fetchedAt: number; pending: boolean; promise: Promise<DailySentence[]> }>();
const REFRESH_INTERVAL_MS = 10_000;

export async function GET(req: NextRequest) {
  const authError = requireApiSession(req);
  if (authError) return authError;
  const date = getJstDateKey();
  const locale = normalizeLocale(req.nextUrl.searchParams.get('locale'));
  const key = `${date}:${locale}`;
  for (const cachedKey of batches.keys()) if (!cachedKey.startsWith(`${date}:`)) batches.delete(cachedKey);
  let batch = batches.get(key);
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (!batch || (refresh && !batch.pending && Date.now() - batch.fetchedAt >= REFRESH_INTERVAL_MS)) {
    const entry = { fetchedAt: Date.now(), pending: true, promise: fetchDailySentenceCandidates(date, locale) };
    entry.promise = entry.promise.then(sentences => {
      entry.pending = false;
      return sentences;
    }, error => {
      entry.pending = false;
      if (batches.get(key) === entry) batches.delete(key);
      // Internal diagnostics distinguish timeouts, HTTP failures and unusable data; UI keeps a short fallback message.
      console.warn('[daily-sentence] Online source unavailable:', error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error');
      throw error;
    });
    batch = entry;
    batches.set(key, entry);
  }
  try {
    return NextResponse.json({ date, sentences: await batch.promise }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // An unavailable public service silently leaves the client's local sentence in place.
    return NextResponse.json({ error: { message: '今日一句暂不可用' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
