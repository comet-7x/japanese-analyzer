// 保留 HTTP 状态用于本地分类；错误正文仅供界面提示，统计不读取它。
export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResponseError';
  }
}

export type AnalysisErrorCode = 'invalid_json' | 'invalid_tokens' | 'source_mismatch' | 'truncated' | 'interrupted' | 'timeout' | 'content_filter';

const analysisMessages: Record<AnalysisErrorCode, string> = {
  invalid_json: '解析结果不是完整有效的 JSON。',
  invalid_tokens: '解析结果包含无效词项。',
  source_mismatch: '解析结果未能完整还原原文。',
  truncated: '解析结果被上游截断（finish_reason: length）。',
  interrupted: '解析连接中断或缺少正常结束信号。',
  timeout: '解析请求超时，请重试。',
  content_filter: '解析被上游内容安全策略中止。',
};

export class AnalysisValidationError extends InvalidResponseError {
  constructor(
    readonly code: AnalysisErrorCode,
    readonly details: { finishReason?: string; mismatchOffset?: number; expectedChars?: number; actualChars?: number } = {},
  ) {
    super(analysisMessages[code]);
    this.name = 'AnalysisValidationError';
  }
}

export function canRecoverAnalysis(error: unknown): boolean {
  return error instanceof AnalysisValidationError
    && ['invalid_json', 'invalid_tokens', 'source_mismatch', 'truncated', 'interrupted'].includes(error.code);
}
