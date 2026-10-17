export type CorrectionResponseStage = 'upstream_response' | 'completion' | 'model_content';
export type CorrectionContentKind = 'empty' | 'non_text' | 'code_fence' | 'reasoning' | 'json_like' | 'other';
export interface CorrectionFormatDetails {
  stage: CorrectionResponseStage;
  reason: 'invalid_upstream_json' | 'invalid_json' | 'incomplete_json' | 'non_json_content' | 'reasoning_in_content' | 'empty_content'
    | 'invalid_completion' | 'truncated' | 'content_filter' | 'missing_finish' | 'abnormal_finish';
  contentKind?: CorrectionContentKind;
  contentChars?: number;
  jsonErrorOffset?: number;
}

/** Never propagate JSON.parse's message: it can contain the model/source text. */
export class LocalCorrectionFormatError extends Error {
  readonly code = 'local_correction_format';
  constructor(readonly details: CorrectionFormatDetails) {
    const message = details.reason === 'invalid_upstream_json' ? '校正服务返回的外层响应不是有效 JSON。'
      : details.reason === 'invalid_completion' ? '模型校正结果格式错误'
      : details.reason === 'truncated' ? '模型校正被上游模型截断（finish_reason: length），请重新生成。'
      : details.reason === 'content_filter' ? '模型校正被上游内容安全策略中止（finish_reason: content_filter）。'
      : details.reason === 'missing_finish' || details.reason === 'abnormal_finish' ? '模型校正未正常结束，请重试。'
      : details.reason === 'empty_content' ? '模型校正返回了空正文。'
      : details.reason === 'reasoning_in_content' ? '模型将思考内容混入校正正文，未应用本段修改。'
      : details.reason === 'non_json_content' ? '模型校正正文包含 JSON 以外的内容，未应用本段修改。'
      : details.reason === 'incomplete_json' ? `模型校正 JSON 不完整（长度 ${details.contentChars}），未应用本段修改。`
      : details.jsonErrorOffset !== undefined ? `模型校正正文不是有效 JSON（位置 ${details.jsonErrorOffset}，长度 ${details.contentChars}）。`
      : '模型校正正文不是有效 JSON。';
    super(message);
    this.name = 'LocalCorrectionFormatError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function localCorrectionCompletionContent(value: unknown): string {
  const fail = (reason: CorrectionFormatDetails['reason']): never => { throw new LocalCorrectionFormatError({ stage: 'completion', reason }); };
  if (!record(value) || !Array.isArray(value.choices) || !record(value.choices[0])) return fail('invalid_completion');
  const choice = value.choices[0];
  // Check termination before attempting to unwrap or parse any partial content.
  if (choice.finish_reason === 'length') return fail('truncated');
  if (choice.finish_reason === 'content_filter') return fail('content_filter');
  if (choice.finish_reason == null) return fail('missing_finish');
  if (choice.finish_reason !== 'stop') return fail('abnormal_finish');
  if (!record(choice.message) || typeof choice.message.content !== 'string') return fail('invalid_completion');
  return choice.message.content;
}

export function correctionContentKind(content: unknown): CorrectionContentKind {
  if (typeof content !== 'string') return 'non_text';
  const text = content.trim();
  if (!text) return 'empty';
  if (text.startsWith('```')) return 'code_fence';
  if (/^<(?:think|thinking|analysis)(?:\s|>)/i.test(text)) return 'reasoning';
  return text.startsWith('{') || text.startsWith('[') ? 'json_like' : 'other';
}

// Diagnosis only. Unclosed structures are never completed or used as results.
function unclosedJson(text: string): boolean {
  const stack: string[] = [];
  let quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) return false;
    }
  }
  return quoted || stack.length > 0;
}

/** Accept exact JSON, or exactly one complete enclosing Markdown JSON fence.
 * Never crop prose, strip reasoning, repair syntax or salvage a partial object. */
export function parseLocalCorrectionContent(content: unknown): { value: unknown; format: 'json' | 'fenced_json' } {
  const contentKind = correctionContentKind(content);
  const details = { stage: 'model_content' as const, contentKind, contentChars: typeof content === 'string' ? content.length : 0 };
  if (typeof content !== 'string' || !content.trim()) throw new LocalCorrectionFormatError({ ...details, reason: 'empty_content' });
  if (contentKind === 'reasoning') throw new LocalCorrectionFormatError({ ...details, reason: 'reasoning_in_content' });
  let text = content.trim();
  let format: 'json' | 'fenced_json' = 'json';
  if (contentKind === 'code_fence') {
    const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
    if (!fence) throw new LocalCorrectionFormatError({ ...details, reason: 'non_json_content' });
    text = fence[1].trim(); format = 'fenced_json';
  }
  try { return { value: JSON.parse(text), format }; }
  catch (error) {
    const match = error instanceof SyntaxError ? /\bposition (\d+)\b/.exec(error.message) : null;
    const offset = match ? Number(match[1]) : undefined;
    const jsonLike = text.startsWith('{') || text.startsWith('[');
    throw new LocalCorrectionFormatError({ ...details,
      reason: jsonLike ? unclosedJson(text) ? 'incomplete_json' : 'invalid_json' : 'non_json_content',
      ...(offset !== undefined && offset <= text.length ? { jsonErrorOffset: offset } : {}),
    });
  }
}
