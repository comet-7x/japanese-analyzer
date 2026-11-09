import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../_utils/sessionAuth';
import { getCoreStatus } from '../../../_utils/live2dCore';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    return NextResponse.json(await getCoreStatus(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: { message: 'Cubism Core 状态读取失败。' } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
