import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, requestBodyErrorResponse } from '../../_utils/requestBody';
import { requireApiSession } from '../../_utils/sessionAuth';
import { CoreInstallError, installCore, resolveCore } from '../../_utils/live2dCore';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    const resolved = await resolveCore();
    if (!resolved) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new Response(resolved.data, { headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function POST(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    const body = await readJsonBody(req);
    const { mode, acceptLicense } = body;
    const content: string | undefined = typeof body.content === 'string' ? body.content : undefined;
    if (mode !== 'download' && mode !== 'import') return NextResponse.json({ error: { message: 'Cubism Core 安装参数无效。' } }, { status: 400 });
    return NextResponse.json(await installCore({ mode, acceptLicense: acceptLicense === true, content, fetchImpl: fetch }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const body = requestBodyErrorResponse(error); if (body) return body;
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof CoreInstallError) return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    return NextResponse.json({ error: { message: 'Cubism Core 安装失败。' } }, { status: 500 });
  }
}
