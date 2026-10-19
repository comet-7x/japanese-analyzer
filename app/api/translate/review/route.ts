import { NextRequest, NextResponse } from 'next/server';
import { normalizeLocale } from '../../../i18n';
import { getTranslationReviewPrompt } from '../../../lib/translationReviewPrompt';
import { buildCompletionPayload, ProviderConfigError, resolveProviderConfig } from '../../_utils/providerConfig';
import { proxyOpenAICompatibleRequest } from '../../_utils/openaiProxy';
import { readJsonBody, requestBodyErrorResponse } from '../../_utils/requestBody';
import { requireApiSession } from '../../_utils/sessionAuth';
import { validateCompletion } from '../../../services/api';

function lineBreakCount(value: string): number { return value.match(/\r\n|\n|\r/g)?.length ?? 0; }

export async function POST(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    const body = await readJsonBody(req);
    const { text, draft, provider, model, baseUrl, caps, thinkingEnabled } = body;
    if (typeof text !== 'string' || !text.trim() || text.length > 12_000 || typeof draft !== 'string' || !draft.trim()
      || draft.length > 50_000 || provider !== 'mymemory') {
      return NextResponse.json({ error: { message: '译文校正参数无效。' } }, { status: 400 });
    }
    const config = resolveProviderConfig(req, { model, baseUrl, caps });
    if (!config.apiKey) return NextResponse.json({ error: { message: '未提供API密钥，请在设置中配置API密钥' } }, { status: 400 });
    const payload = buildCompletionPayload(config.caps, {
      model: config.model,
      messages: [
        { role: 'system', content: getTranslationReviewPrompt(normalizeLocale(req.headers.get('X-App-Locale'))) },
        { role: 'user', content: JSON.stringify({ source: text, provider, draft }) },
      ],
      stream: false,
    }, { structuredOutput: 'translationReview', enableThinking: thinkingEnabled === true });
    const proxied = await proxyOpenAICompatibleRequest({ url: config.baseUrl, apiKey: config.apiKey, payload, signal: req.signal, requestTimeoutMs: 120_000 });
    if (!proxied.ok) return NextResponse.json({ error: { message: proxied.error.message } }, { status: proxied.status });
    const value = await proxied.response.json(); validateCompletion(value, '译文校正');
    const content = JSON.parse(value.choices[0].message.content) as { translation?: unknown; summary?: unknown };
    if (typeof content.translation !== 'string' || !content.translation.trim() || typeof content.summary !== 'string'
      || lineBreakCount(content.translation) !== lineBreakCount(text)) {
      return NextResponse.json({ error: { message: '模型校正结果未保留原文段落结构。' } }, { status: 502 });
    }
    return NextResponse.json({ translation: content.translation, summary: content.summary }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    if (error instanceof ProviderConfigError) return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error('Translation review failed:', error);
    return NextResponse.json({ error: { message: '模型润色未完成，请重试。' } }, { status: 502 });
  }
}
