import { NextRequest, NextResponse } from 'next/server';
import { normalizeLocale } from '../../i18n';
import { machineTranslate, MachineTranslationError } from '../_utils/machineTranslation';
import { readJsonBody, requestBodyErrorResponse } from '../_utils/requestBody';
import { requireApiSession } from '../_utils/sessionAuth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    const body = await readJsonBody(req);
    const { provider, text } = body;
    if ((provider !== 'google' && provider !== 'baidu') || typeof text !== 'string' || !text.trim() || text.length > 12_000) {
      return NextResponse.json({ error: { message: '机器翻译参数无效。' } }, { status: 400 });
    }
    const credentials = {
      googleApiKey: req.headers.get('X-Translation-Api-Key')?.trim() || process.env.GOOGLE_TRANSLATE_API_KEY?.trim(),
      baiduAppId: req.headers.get('X-Translation-App-Id')?.trim() || process.env.BAIDU_TRANSLATE_APP_ID?.trim(),
      baiduSecret: req.headers.get('X-Translation-Api-Key')?.trim() || process.env.BAIDU_TRANSLATE_SECRET?.trim(),
    };
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]);
    const translation = await machineTranslate(text, provider, normalizeLocale(req.headers.get('X-App-Locale')), credentials, signal);
    if (!translation.trim()) throw new MachineTranslationError('机器翻译返回了空译文。');
    return NextResponse.json({ provider, translation }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    if (req.signal.aborted || error instanceof DOMException && error.name === 'AbortError') return new Response(null, { status: 499 });
    if (error instanceof DOMException && error.name === 'TimeoutError') return NextResponse.json({ error: { message: '机器翻译请求超时，请重试。' } }, { status: 504 });
    const status = error instanceof MachineTranslationError ? error.status : 502;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : '机器翻译失败。' } }, { status });
  }
}
