import { NextRequest, NextResponse } from 'next/server';
import { getJstDateKey } from '../../utils/dailySentences';
import { sentencePackBatch } from '../../utils/sentencePack';
import { sentencePackStore } from '../_utils/sentencePackStore';
import { requireApiSession } from '../_utils/sessionAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = requireApiSession(req);
  if (authError) return authError;
  // No public random API on the request path, including refresh=1. Locale selection happens in the pool.
  const pack = sentencePackStore.get();
  return NextResponse.json(sentencePackBatch(pack, getJstDateKey()), {
    headers: { 'Cache-Control': 'no-store', 'X-Sentence-Pack-Version': pack.version },
  });
}
