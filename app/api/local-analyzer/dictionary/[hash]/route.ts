import { NextRequest } from 'next/server';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import manifest from '../../../../lib/localAnalyzerManifest.json';
import { requireApiSession } from '../../../_utils/sessionAuth';

export const runtime = 'nodejs';
export async function GET(req: NextRequest, context: { params: Promise<{ hash: string }> }) {
  const denied = requireApiSession(req); if (denied) return denied;
  const { hash } = await context.params;
  if (!/^[a-f0-9]{64}$/u.test(hash)) return new Response(null, { status: 404 });
  const chunk = manifest.chunks.find(chunk => chunk.sha256 === hash);
  if (!chunk) return new Response(null, { status: 404 });
  try {
    const bytes = await readFile(join(process.cwd(), 'data/local-analyzer', `${hash}.deflate`));
    if (bytes.length !== chunk.bytes || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Corrupt dictionary chunk');
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
