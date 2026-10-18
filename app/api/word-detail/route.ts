import { readJsonBody, requestBodyErrorResponse } from '../_utils/requestBody';
import { normalizeLocale } from '../../i18n';
import { NextRequest, NextResponse } from 'next/server';
import { proxyOpenAICompatibleRequest } from '../_utils/openaiProxy';
import { ProviderConfigError, resolveProviderConfig, buildCompletionPayload } from '../_utils/providerConfig';
import { requireApiSession } from '../_utils/sessionAuth';
import { getSelectionAnalysisPrompt, getSelectionTranslationPrompt } from '../../lib/selectionToolPrompts';
import { validateCompletion } from '../../services/api';

const wordFields = ['dictionaryForm', 'explanation', 'example', 'exampleTranslation', 'pos', 'furigana'] as const;
const phraseFields = [...wordFields, 'category', 'breakdown'] as const;

function validateStrings(value: unknown, fields: readonly string[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('词语工具结果格式错误');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !fields.includes(key)) || fields.some(field => typeof record[field] !== 'string')) {
    throw new Error('词语工具结果字段无效');
  }
  return record as Record<string, string>;
}

export async function POST(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  try {
    const body = await readJsonBody(req);
    const { word, pos, sentence, furigana, model, baseUrl, caps, kind, task } = body;
    const phrase = kind === 'phrase';
    if ((task !== 'translate' && task !== 'analyze') || (kind !== 'word' && kind !== 'phrase') || typeof word !== 'string' || !word.trim() || word.length > (phrase ? 12_000 : 240)
      || typeof sentence !== 'string' || !sentence || sentence.length > 12_000 || typeof pos !== 'string' || typeof furigana !== 'string') {
      return NextResponse.json({ error: { message: '词语工具参数无效。' } }, { status: 400 });
    }
    const config = resolveProviderConfig(req, { baseUrl, model, caps });
    if (!config.apiKey) return NextResponse.json({ error: { message: '未提供API密钥，请在设置中配置API密钥' } }, { status: 400 });
    const locale = normalizeLocale(req.headers.get('X-App-Locale'));
    const structuredOutput = task === 'translate' ? 'selectionTranslation'
      : phrase ? 'selectionAnalysisPhrase' : 'selectionAnalysisWord';
    const payload = buildCompletionPayload(config.caps, {
      model: config.model,
      messages: [
        { role: 'system', content: task === 'translate' ? getSelectionTranslationPrompt(locale) : getSelectionAnalysisPrompt(locale, phrase) },
        { role: 'user', content: JSON.stringify({ selection: word, sentence, pos, furigana }) },
      ], stream: false,
    }, { structuredOutput });
    const proxied = await proxyOpenAICompatibleRequest({ url: config.baseUrl, apiKey: config.apiKey, payload, signal: req.signal, requestTimeoutMs: 120_000 });
    if (!proxied.ok) return NextResponse.json({ error: { message: proxied.error.message } }, { status: proxied.status });
    const response = await proxied.response.json(); validateCompletion(response, task === 'translate' ? '词语翻译' : '用法解析');
    const parsed = JSON.parse(response.choices[0].message.content) as unknown;
    if (task === 'translate') {
      const result = validateStrings(parsed, ['translation']);
      if (!result.translation.trim()) throw new Error('词语翻译结果为空');
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const fields = phrase ? phraseFields : wordFields;
    const result = validateStrings(parsed, fields);
    if (phrase && !['単語', '文法形式', '慣用表現', '連語'].includes(result.category)) throw new Error('短语类别无效');
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    if (error instanceof ProviderConfigError) return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : '词语工具请求失败。' } }, { status: 502 });
  }
}
