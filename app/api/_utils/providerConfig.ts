import { NextRequest } from 'next/server';
import {
  normalizeEndpointUrl,
  isTokenLimit,
  type ModelEndpoint,
  type ProviderCaps,
} from '../../lib/aiModels';
import { BaseUrlError, validateBaseUrl } from './validateBaseUrl';
import { SCHOOL_POS } from '../../lib/learningTools';

export type { ProviderCaps, ModelEndpoint } from '../../lib/aiModels';

export type StructuredOutputKind = 'analysisTokens' | 'wordDetail' | 'phraseDetail' | 'selectionTranslation' | 'selectionAnalysisWord' | 'selectionAnalysisPhrase' | 'resegment' | 'conjugation' | 'dictionaryTranslation' | 'translationReview' | 'localCorrection' | 'connectionProbe';

/** 解析后的上游调用配置：端点 + 密钥 + 能力位 */
export interface ResolvedProviderConfig extends ModelEndpoint {
  apiKey: string;
  caps: ProviderCaps;
}

export class ProviderConfigError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ProviderConfigError';
    this.status = status;
  }
}

function getBearerToken(req: NextRequest): string {
  const authHeader = req.headers.get('Authorization');
  return authHeader ? authHeader.replace('Bearer ', '').trim() : '';
}

function normalizeCaps(value: unknown): ProviderCaps {
  if (!value || typeof value !== 'object') return {};
  const item = value as Record<string, unknown>;
  const caps: ProviderCaps = {};
  if (item.structuredOutput === 'json_schema' || item.structuredOutput === 'json_object') caps.structuredOutput = item.structuredOutput;
  else if (typeof item.jsonSchema === 'boolean') caps.structuredOutput = item.jsonSchema ? 'json_schema' : 'json_object';
  if (typeof item.thinking === 'boolean') caps.thinking = item.thinking;
  if (typeof item.vision === 'boolean') caps.vision = item.vision;
  if (isTokenLimit(item.contextWindow)) caps.contextWindow = item.contextWindow;
  if (isTokenLimit(item.maxOutputTokens)) caps.maxOutputTokens = item.maxOutputTokens;
  if (typeof item.reasoningEffort === 'string' && item.reasoningEffort.trim()) caps.reasoningEffort = item.reasoningEffort.trim();
  return caps;
}

/**
 * 解析用户请求的模型端点。端点（baseUrl + model）与能力位由客户端提供，密钥来自 Bearer。
 * 不再支持服务端预设密钥，也不再允许服务端代客选择端点。
 */
export function resolveProviderConfig(
  req: NextRequest,
  options: {
    baseUrl?: unknown;
    model?: unknown;
    caps?: unknown;
  } = {}
): ResolvedProviderConfig {
  let baseUrl: string;
  try {
    baseUrl = validateBaseUrl(options.baseUrl);
  } catch (error) {
    if (error instanceof BaseUrlError) throw new ProviderConfigError(error.message, error.status);
    throw error;
  }

  const model = typeof options.model === 'string' ? options.model.trim() : '';
  if (!model) {
    throw new ProviderConfigError('缺少模型名称，请在设置中填写模型');
  }

  return {
    baseUrl: normalizeEndpointUrl(baseUrl),
    apiKey: getBearerToken(req),
    model,
    caps: normalizeCaps(options.caps),
  };
}

const analysisTokensSchema = {
  type: 'object',
  properties: {
    tokens: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          pos: { type: 'string' },
          furigana: { type: 'string' },
        },
        required: ['word', 'pos', 'furigana'],
        additionalProperties: false,
      },
    },
  },
  required: ['tokens'],
  additionalProperties: false,
} as const;

const wordDetailFields = [
  'chineseTranslation',
  'dictionaryForm',
  'explanation',
  'conjugation',
  'example',
  'exampleTranslation',
  'pos',
  'furigana',
] as const;

const wordDetailSchema = {
  type: 'object',
  // Keep both schema lists in the same order promised by the prompt. Although
  // JSON object order is not semantic, structured-output models commonly emit
  // properties in schema order and the UI progressively renders that stream.
  properties: Object.fromEntries(wordDetailFields.map((field) => [field, { type: 'string' }])),
  required: [...wordDetailFields],
  additionalProperties: false,
} as const;

const phraseDetailFields = [
  'chineseTranslation',
  'category',
  'dictionaryForm',
  'explanation',
  'breakdown',
  'example',
  'exampleTranslation',
  'pos',
  'furigana',
] as const;

const phraseDetailSchema = {
  type: 'object',
  properties: Object.fromEntries(phraseDetailFields.map((field) => [field, { type: 'string' }])),
  required: [...phraseDetailFields],
  additionalProperties: false,
} as const;

const textSchema = { type: 'string' } as const;
const objectSchema = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arraySchema = (items: unknown) => ({ type: 'array', items });
const toolSchemas = {
  resegment: objectSchema({ candidates: arraySchema(objectSchema({ tokens: analysisTokensSchema.properties.tokens })) }),
  conjugation: objectSchema({ analyses: arraySchema(objectSchema({ dictionaryForm: textSchema, steps: arraySchema(objectSchema({ form: textSchema, label: textSchema })), note: textSchema })), insufficient: { type: 'boolean' } }),
  dictionaryTranslation: objectSchema({ translations: arraySchema(objectSchema({ id: textSchema, text: textSchema })) }),
};

const structuredOutputSchemas = {
  connectionProbe: { name: 'structured_output_probe', schema: objectSchema({ verdict: { type: 'string', enum: ['schema_enforced'] } }) },
  localCorrection: { name: 'japanese_local_corrections', schema: objectSchema({ edits: arraySchema(objectSchema({
    sourceIds: { ...arraySchema({ type: 'integer' }), minItems: 1, description: 'Non-empty ascending consecutive 0-based IDs from targetTokens. Use [5] for one token and [5,6] to merge adjacent tokens.' },
    pos: { type: 'string', enum: [...SCHOOL_POS, '固有名詞', '普通名詞', '数詞', '助数詞', '補助動詞', '句点', '読点', '補助記号'] },
    furigana: { type: 'string', description: 'Reading in kana. Must be empty for punctuation or line breaks.' },
  })) }) },
  resegment: { name: 'japanese_resegmentation', schema: toolSchemas.resegment },
  conjugation: { name: 'japanese_conjugation', schema: toolSchemas.conjugation },
  dictionaryTranslation: { name: 'dictionary_sense_translation', schema: toolSchemas.dictionaryTranslation },
  translationReview: { name: 'translation_review', schema: objectSchema({ translation: textSchema, summary: textSchema }) },
  selectionTranslation: { name: 'selection_translation', schema: objectSchema({ translation: textSchema }) },
  selectionAnalysisWord: { name: 'selection_word_analysis', schema: objectSchema({
    dictionaryForm: textSchema, explanation: textSchema, example: textSchema, exampleTranslation: textSchema, pos: textSchema, furigana: textSchema,
  }) },
  selectionAnalysisPhrase: { name: 'selection_phrase_analysis', schema: objectSchema({
    dictionaryForm: textSchema, explanation: textSchema, category: { type: 'string', enum: ['単語', '文法形式', '慣用表現', '連語'] },
    breakdown: textSchema, example: textSchema, exampleTranslation: textSchema, pos: textSchema, furigana: textSchema,
  }) },
  analysisTokens: {
    name: 'japanese_sentence_analysis',
    schema: analysisTokensSchema,
  },
  wordDetail: {
    name: 'japanese_word_detail',
    schema: wordDetailSchema,
  },
  phraseDetail: {
    name: 'japanese_phrase_detail',
    schema: phraseDetailSchema,
  },
} as const;

export const LOCAL_CORRECTION_SCHEMA_FINGERPRINT = 'local-correction-source-ids-v2';

/** 按模型能力选择结构化输出方式；未声明时使用兼容性更好的 json_object。 */
export function getStructuredResponseFormat(
  caps: ProviderCaps,
  kind: StructuredOutputKind
): Record<string, unknown> {
  if (caps.structuredOutput !== 'json_schema') {
    return { type: 'json_object' };
  }

  const structuredOutput = structuredOutputSchemas[kind];
  return {
    type: 'json_schema',
    json_schema: {
      name: structuredOutput.name,
      strict: true,
      schema: structuredOutput.schema,
    },
  };
}

/**
 * 在上游请求体上追加结构化输出 / 思考参数。
 * 仅在能力位声明支持时才附加，保证对任意 OpenAI 兼容厂商安全。
 */
export function buildCompletionPayload(
  caps: ProviderCaps,
  payload: Record<string, unknown>,
  options: {
    structuredOutput?: StructuredOutputKind;
    enableThinking?: boolean;
  } = {}
): Record<string, unknown> {
  const responseFormat = options.structuredOutput
    ? { response_format: getStructuredResponseFormat(caps, options.structuredOutput) }
    : {};
  // MiniMax otherwise places <think> blocks in content, corrupting JSON analysis
  // and translations. Its OpenAI-compatible API can return reasoning separately.
  const reasoningFormat = typeof payload.model === 'string' && /(?:^|\/)MiniMax-M[23]/i.test(payload.model)
    ? { reasoning_split: true } : {};

  let maxTokens = isTokenLimit(payload.max_tokens) ? payload.max_tokens : undefined;
  if (isTokenLimit(caps.maxOutputTokens)) maxTokens = Math.min(maxTokens ?? caps.maxOutputTokens, caps.maxOutputTokens);
  if (isTokenLimit(caps.contextWindow)) {
    // Conservative text budget: UTF-8 bytes plus schema and message framing.
    // Image tokenization varies by provider, so image requests only cap output.
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const hasImages = messages.some(message => Array.isArray(message?.content)
      && message.content.some((part: { type?: string }) => part.type === 'image_url'));
    const inputBudget = hasImages ? 0 : new TextEncoder().encode(JSON.stringify({ messages, ...responseFormat })).length + 256;
    const available = caps.contextWindow - inputBudget;
    if (available <= 0) throw new ProviderConfigError('内容超过当前模型的上下文窗口，请缩短内容或调大模型配置。');
    maxTokens = Math.min(maxTokens ?? 8192, available);
  }
  const outputLimit = maxTokens === undefined ? {} : { max_tokens: maxTokens };

  if (caps.thinking === true) {
    const thinkingEnabled = options.enableThinking === true;
    return {
      ...payload,
      ...responseFormat,
      ...reasoningFormat,
      ...outputLimit,
      thinking: { type: thinkingEnabled ? 'enabled' : 'disabled' },
      // reasoning_effort 的合法取值因厂商而异，只发送用户为该服务声明的值，
      // 未声明时省略、由服务商使用自身默认值。
      ...(thinkingEnabled && caps.reasoningEffort
        ? { reasoning_effort: caps.reasoningEffort }
        : {}),
    };
  }

  return {
    ...payload,
    ...responseFormat,
    ...reasoningFormat,
    ...outputLimit,
  };
}
