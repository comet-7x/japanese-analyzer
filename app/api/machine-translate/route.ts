import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { normalizeLocale } from '../../i18n';
import { machineTranslate, MachineTranslationError } from '../_utils/machineTranslation';
import { readJsonBody, requestBodyErrorResponse } from '../_utils/requestBody';
import { requireApiSession } from '../_utils/sessionAuth';
import { isValidMyMemoryEmail } from '../../lib/translationServices';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    const body = await readJsonBody(req);
    const { provider, text } = body;
    if (provider !== 'mymemory' || typeof text !== 'string' || !text.trim() || text.length > 12_000) {
      return NextResponse.json({ error: { message: '机器翻译参数无效。' } }, { status: 400 });
    }
    if (body.email !== undefined && (typeof body.email !== 'string' || (body.email.trim() && !isValidMyMemoryEmail(body.email.trim())))) {
      return NextResponse.json({ error: { message: '请输入有效的 MyMemory 联系邮箱，或留空使用匿名翻译。', code: 'MYMEMORY_EMAIL_INVALID' } }, { status: 400 });
    }
    const email = typeof body.email === 'string' ? body.email.trim() : undefined;
    // Opt-in only: the deployment proxy must overwrite this header with one real client IP.
    // Do not trust arbitrary browser-supplied forwarding headers or body fields.
    const ipHeader = process.env.MYMEMORY_CLIENT_IP_HEADER;
    const forwardedIp = ipHeader ? req.headers.get(ipHeader)?.trim() : undefined;
    const clientIp = forwardedIp && isIP(forwardedIp) ? forwardedIp : undefined;
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]);
    const translation = await machineTranslate(text, provider, normalizeLocale(req.headers.get('X-App-Locale')), signal, email, clientIp);
    if (!translation.trim()) throw new MachineTranslationError('机器翻译返回了空译文。');
    return NextResponse.json({ provider, translation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    if (req.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return new Response(null, { status: 499 });
    if (error instanceof DOMException && error.name === 'TimeoutError') return NextResponse.json({ error: { message: '机器翻译请求超时，请重试。' } }, { status: 504 });
    const status = error instanceof MachineTranslationError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : '机器翻译失败。',
      ...(error instanceof MachineTranslationError && error.code ? { code: error.code } : {}) } }, { status });
  }
}
