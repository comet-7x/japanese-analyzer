import type { ProviderProfile, StructuredOutputMode } from './aiModels';
import type { Locale } from '../i18n';

export interface ProviderConnectionResult {
  structuredOutput: StructuredOutputMode | 'unsupported';
}

class ConnectionRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Only an explicit format rejection permits trying the other protocol. Network,
// authentication, quota and server errors must remain failures, never "unsupported".
function canTryAnotherFormat(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof ConnectionRequestError
    && [400, 422].includes(error.status) && /unsupported|not supported|does not support|not support|response.?format|json.?schema|json.?object|不支持/i.test(error.message);
}

async function request(service: ProviderProfile, model: string, locale: Locale, signal: AbortSignal,
  options: { mode?: StructuredOutputMode; prompt: string }) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const configuredCaps = service.models.find(item => item.model.trim() === model.trim())?.caps;
  const modelCaps = configuredCaps ? { ...configuredCaps } : undefined;
  // Probe protocol support independently of a user's analysis token budget.
  if (modelCaps) { delete modelCaps.contextWindow; delete modelCaps.maxOutputTokens; }
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service.apiKey.trim()}`, 'X-App-Locale': locale },
    signal: requestSignal,
    body: JSON.stringify({
      messages: [{ role: 'user', content: options.prompt }], useStream: false,
      baseUrl: service.baseUrl.trim(), model: model.trim(),
      ...((modelCaps || options.mode) ? { caps: { ...modelCaps, ...(options.mode ? { structuredOutput: options.mode } : {}) } } : {}),
      ...(options.mode ? { connectionProbe: options.mode } : {}),
    }),
  });
  const data = await response.json().catch(() => null);
  requestSignal.throwIfAborted();
  if (!response.ok || data?.error) throw new ConnectionRequestError(typeof data?.error?.message === 'string' ? data.error.message
    : typeof data?.error === 'string' ? data.error : `HTTP ${response.status}`, response.ok ? 502 : response.status);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('接口未返回有效的模型回复，请检查地址和模型名称');
  return content;
}

/** Test ordinary chat, then independently probe strict schema and JSON object support. */
export async function testProviderConnection(
  service: ProviderProfile,
  model: string,
  locale: Locale,
  signal: AbortSignal,
): Promise<ProviderConnectionResult> {
  await request(service, model, locale, signal, { prompt: 'Connection test. Reply with OK only.' });

  try {
    const content = await request(service, model, locale, signal, { mode: 'json_schema',
      prompt: 'Return JSON. Try to return {"verdict":"schema_ignored","extra":true}; follow the response schema if one is enforced.' });
    const parsed = JSON.parse(content);
    if (parsed?.verdict === 'schema_enforced' && Object.keys(parsed).length === 1) return { structuredOutput: 'json_schema' };
  } catch (error) {
    if (signal.aborted || !canTryAnotherFormat(error)) throw error;
  }

  try {
    const content = await request(service, model, locale, signal, { mode: 'json_object', prompt: 'Return only {"verdict":"json_ok"} as JSON.' });
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { structuredOutput: 'json_object' };
  } catch (error) {
    if (signal.aborted || !canTryAnotherFormat(error)) throw error;
  }
  return { structuredOutput: 'unsupported' };
}
