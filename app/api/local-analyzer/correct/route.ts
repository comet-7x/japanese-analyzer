import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../_utils/sessionAuth';
import { readJsonBody, requestBodyErrorResponse } from '../../_utils/requestBody';
import { buildCompletionPayload, LOCAL_CORRECTION_SCHEMA_FINGERPRINT, resolveProviderConfig, ProviderConfigError } from '../../_utils/providerConfig';
import { proxyOpenAICompatibleRequest } from '../../_utils/openaiProxy';
import { LOCAL_CORRECTION_CONTEXT_CHARS, LOCAL_CORRECTION_PROMPT, LOCAL_CORRECTION_PROTOCOL_VERSION, LocalCorrectionValidationError, applyLocalCorrections, validateLocalTokens } from '../../../lib/localCorrections';
import { LOCAL_INPUT_LIMIT } from '../../../lib/localAnalyzerTypes';
import { getResponseLanguageInstruction } from '../../../lib/languagePrompts';
import { normalizeLocale } from '../../../i18n';
import { isUpstreamTimeoutError } from '../../_utils/requestTimeout';
import { LocalCorrectionFormatError, correctionContentKind, localCorrectionCompletionContent, parseLocalCorrectionContent } from '../../../lib/localCorrectionFormat';

export async function POST(req: NextRequest) {
  const denied = requireApiSession(req); if (denied) return denied;
  const started = performance.now();
  let tokenCount = 0, inputChars = 0, outputChars = 0, reasoningChars = 0;
  let finishReason = 'missing';
  let phase = 'request';
  let upstreamChars = 0, upstreamContentType = 'missing';
  let requestedFormat = 'missing', modelContentKind = 'missing';
  let contextBeforeChars = 0, contextAfterChars = 0, upstreamRequestId = 'missing';
  let chunk: { start: number; end: number; index: number; attempt: number } | undefined;
  const diagnostic = (details: Record<string, unknown>) => console.warn('[local-correction-diagnostic]', JSON.stringify({
    protocolVersion: LOCAL_CORRECTION_PROTOCOL_VERSION, schemaFingerprint: LOCAL_CORRECTION_SCHEMA_FINGERPRINT,
    tokenCount, targetTokenCount: tokenCount, inputChars, contextBeforeChars, contextAfterChars, outputChars, reasoningChars,
    finishReason, phase, upstreamChars, upstreamContentType, upstreamRequestId, requestedFormat, modelContentKind,
    elapsedMs: Math.round(performance.now() - started), ...(chunk ? { chunk } : {}), ...details,
  }));
  try {
    const body = await readJsonBody(req);
    if (typeof body.source !== 'string' || !body.source.trim() || body.source.length > LOCAL_INPUT_LIMIT) return NextResponse.json({ error: { message: '本地初稿参数无效。' } }, { status: 400 });
    let tokens;
    try { tokens = validateLocalTokens(body.source, body.tokens); }
    catch { return NextResponse.json({ error: { message: '本地初稿参数无效。' } }, { status: 400 }); }
    tokenCount = tokens.length; inputChars = body.source.length;
    const readContext = (value: unknown) => typeof value === 'string' && value.normalize('NFC').length <= LOCAL_CORRECTION_CONTEXT_CHARS ? value.normalize('NFC') : '';
    const contextBefore = readContext(body.contextBefore);
    const contextAfter = readContext(body.contextAfter);
    contextBeforeChars = contextBefore.length; contextAfterChars = contextAfter.length;
    const context = body.chunkContext;
    if (context && typeof context === 'object' && !Array.isArray(context)) {
      const values = ['start', 'end', 'index', 'attempt'].map(key => (context as Record<string, unknown>)[key]);
      if (values.every((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) {
        const [start, end, index, attempt] = values;
        if (end - start === inputChars && attempt > 0) chunk = { start, end, index, attempt };
      }
    }
    const config = resolveProviderConfig(req, body);
    if (!config.apiKey) throw new ProviderConfigError('未提供API密钥，请在设置中配置API密钥', 400);
    requestedFormat = config.caps.structuredOutput === 'json_schema' ? 'json_schema' : 'json_object';
    phase = 'provider_request';
    const response = await proxyOpenAICompatibleRequest({ url: config.baseUrl, apiKey: config.apiKey, signal: req.signal, requestTimeoutMs: 120_000,
      payload: buildCompletionPayload(config.caps, { model: config.model, stream: false, max_tokens: 8192, messages: [
        { role: 'system', content: LOCAL_CORRECTION_PROMPT + '\n' + getResponseLanguageInstruction(normalizeLocale(req.headers.get('X-App-Locale'))) },
        { role: 'user', content: JSON.stringify({ protocolVersion: LOCAL_CORRECTION_PROTOCOL_VERSION,
          contextBefore, targetSource: body.source.normalize('NFC'), contextAfter,
          targetTokenCount: tokenCount, targetTokens: tokens.map((t, id) => ({ id, word: t.word.normalize('NFC'), pos: t.pos, furigana: (t.furigana ?? '').normalize('NFC') })) }) },
      ] }, { structuredOutput: 'localCorrection', enableThinking: body.thinkingEnabled === true }) });
    if (!response.ok) {
      const schemaUnsupported = requestedFormat === 'json_schema' && [400, 404, 422].includes(response.status);
      diagnostic({ outcome: 'rejected', reason: schemaUnsupported ? 'schema_unsupported' : 'upstream_http_error', status: response.status });
      return NextResponse.json({ error: { message: schemaUnsupported ? '该模型或网关不支持严格结构化输出，请在模型设置中改用 JSON 模式。' : response.error.message,
        code: schemaUnsupported ? 'schema_unsupported' : 'upstream_http_error' } }, { status: response.status });
    }
    const rawRequestId = response.response.headers.get('x-request-id')
      ?? response.response.headers.get('x-tt-logid') ?? response.response.headers.get('request-id');
    upstreamRequestId = rawRequestId && /^[A-Za-z0-9._:-]{1,200}$/.test(rawRequestId) ? rawRequestId : 'missing';
    phase = 'upstream_response';
    const rawContentType = response.response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    upstreamContentType = rawContentType == null ? 'missing' : ['application/json', 'text/event-stream', 'text/html', 'text/plain'].includes(rawContentType) ? rawContentType : 'other';
    const upstreamBody = await response.response.text();
    upstreamChars = upstreamBody.length;
    let result;
    try { result = JSON.parse(upstreamBody); }
    catch { throw new LocalCorrectionFormatError({ stage: 'upstream_response', reason: 'invalid_upstream_json', contentChars: upstreamChars, contentKind: correctionContentKind(upstreamBody) }); }
    phase = 'completion';
    const rawReason = result?.choices?.[0]?.finish_reason;
    finishReason = ['stop', 'length', 'content_filter', 'tool_calls', 'function_call', 'insufficient_system_resource'].includes(rawReason) ? rawReason : rawReason == null ? 'missing' : 'unknown';
    const modelContent = result?.choices?.[0]?.message?.content;
    modelContentKind = correctionContentKind(modelContent);
    if (typeof modelContent === 'string') outputChars = modelContent.length;
    const reasoningContent = result?.choices?.[0]?.message?.reasoning_content;
    if (typeof reasoningContent === 'string') reasoningChars = reasoningContent.length;
    const content = localCorrectionCompletionContent(result);
    phase = 'model_content';
    const parsed = parseLocalCorrectionContent(content);
    phase = 'edits';
    const corrected = applyLocalCorrections(body.source, tokens, parsed.value, { onValidated: ({ editCount, normalizedPosAliases }) => {
      diagnostic({ outcome: 'accepted', editCount, normalizedPosAliases, wrapper: parsed.format });
    } });
    return NextResponse.json({ tokens: corrected }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error); if (bodyError) return bodyError;
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (error instanceof LocalCorrectionValidationError) {
      const schemaReasons = new Set(['invalid_edits', 'invalid_edit', 'invalid_source_ids', 'invalid_pos', 'unexpected_field']);
      const category = requestedFormat === 'json_schema' && schemaReasons.has(error.details.reason)
        ? 'schema_contract_violation' : schemaReasons.has(error.details.reason)
          || ['non_contiguous_ids', 'out_of_bounds', 'overlapping_source_ids'].includes(error.details.reason)
          ? 'local_protocol_invalid' : 'semantic_validation_failed';
      diagnostic({ outcome: 'rejected', category, ...error.details });
      return NextResponse.json({ error: { message: error.message, code: category, details: error.details } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof LocalCorrectionFormatError) {
      diagnostic({ outcome: 'rejected', ...error.details });
      return NextResponse.json({ error: { message: error.message, code: error.details.reason, details: error.details } }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!(error instanceof ProviderConfigError)) diagnostic({ outcome: 'rejected', reason: isUpstreamTimeoutError(error) ? 'timeout' : phase === 'completion' ? 'invalid_completion' : 'request_failed' });
    const status = error instanceof ProviderConfigError ? error.status : isUpstreamTimeoutError(error) ? 504 : 502;
    return NextResponse.json({ error: { message: isUpstreamTimeoutError(error) ? '校正请求超时，请重试。'
      : error instanceof SyntaxError ? '模型校正返回格式无效。' : error instanceof Error ? error.message : '模型校正失败，请重试。',
      code: isUpstreamTimeoutError(error) ? 'correction_timeout' : 'request_failed' } }, { status });
  }
}
