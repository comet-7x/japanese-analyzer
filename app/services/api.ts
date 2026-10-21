import { getClientLocale } from '../i18n';
import type { ChatRequestMessage } from '../lib/chatMessages';
import type { SpeechProtocol } from '../lib/speechServices';
// API与分析相关的服务函数
import {
  sanitizeProfiles,
  resolveModelSelection,
  createCustomModelId,
  supportsImageInput,
  migrateModelPreferences,
  type ModelCaps,
  type ModelEndpoint,
  type ProviderCaps,
  type ProviderProfile,
} from '../lib/aiModels';
import { splitJapaneseText, type JapaneseTextChunk } from '../utils/japaneseChunking';
import { normalizeEscapedLineBreaks } from '../utils/markdown';
import { getLocalRomaji } from '../utils/romaji';
import { ApiRequestError, InvalidResponseError, AnalysisValidationError, type AnalysisErrorCode } from '../utils/requestErrors';
import { AnalysisSession, type AnalysisProgress, type AnalysisChunkProgress } from '../utils/analysisSession';
import type { JapaneseChunkingOptions } from '../utils/japaneseChunking';
export { AnalysisSession };
export type { AnalysisProgress } from '../utils/analysisSession';
import { protectAnalysisUrls } from '../utils/analysisUrls';
import { buildAnalyzePrompt } from '../lib/analyzePrompt';
import { AnalyzeStreamParser } from '../utils/analyzeStreamParser';
import { restoreCanonicalWords } from '../utils/canonicalSurface';

export { PRESETS, sanitizeProfiles, normalizeEndpointUrl, createCustomProfileId, createCustomModelId, effectiveCaps } from '../lib/aiModels';
export type { ModelConfig, ModelCaps, ModelEndpoint, ProviderProfile, ProviderCaps, ProviderPreset } from '../lib/aiModels';

export interface TokenData {
  word: string;
  pos: string;
  furigana?: string;
  romaji?: string;
}

export interface WordDetail {
  originalWord: string;
  chineseTranslation: string;
  pos: string;
  furigana?: string;
  romaji?: string;
  dictionaryForm?: string;
  explanation: string;
  conjugation?: string;
  example?: string;
  exampleTranslation?: string;
  /** phrase：用户圈选的多词短语 */
  kind?: WordDetailKind;
  /** 短语类别：単語（被拆开的一个词）| 文法形式 | 慣用表現 | 連語 */
  category?: string;
  /** 短语的构成拆解 */
  breakdown?: string;
  /** 短语被判断为一个词时，AI 给出的整词读音（用于合并，可处理连浊等） */
  mergeReading?: string;
}

export type WordDetailKind = 'word' | 'phrase' | 'lookup';

/** 短语类别（与短语提示词约定的日文标签一致） */
export const PHRASE_CATEGORIES: readonly string[] = ['単語', '文法形式', '慣用表現', '連語'];

export type ChatMessage = ChatRequestMessage;

export type TTSProvider = SpeechProtocol;
export interface SpeechRequestOptions { gender?: 'male' | 'female'; voice?: string; rate?: number; pitch?: number; model?: string; baseUrl?: string; speed?: number; signal?: AbortSignal }

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface StoredAISettings {
  /** 服务商列表，每个服务商可挂多个模型 */
  services: ProviderProfile[];
  activeServiceId: string;
  activeModelId: string;
  /** Gemini TTS 专用密钥（与主模型配置分离） */
  geminiApiKey: string;
  /** @deprecated Read/write compatibility for pre-model preferences. */
  thinkingEnabled?: boolean;
}

export interface AnalyzeRequestOptions {
  thinkingEnabled?: boolean;
  onReasoning?: (text: string, done: boolean) => void;
  onContentStart?: () => void;
  signal?: AbortSignal;
  onDiagnostics?: (event: AnalysisDiagnosticEvent) => void;
  onProgress?: (progress: AnalysisProgress) => void;
  /** Experiments/tests can disable recovery without changing the default. */
  automaticRecovery?: boolean;
  chunking?: JapaneseChunkingOptions;
  compactJson?: boolean;
  requestTimeoutMs?: number;
}

export interface AnalysisDiagnosticEvent {
  stage: 'start' | 'headers' | 'content' | 'reasoning' | 'complete' | 'error' | 'cancel';
  model: string;
  chunkIndex: number;
  chunkCount: number;
  inputChars: number;
  outputChars: number;
  reasoningChars: number;
  elapsedMs: number;
  status?: number;
  start?: number;
  end?: number;
  attempt?: number;
  recovery?: boolean;
  errorCode?: AnalysisErrorCode | 'http' | 'network';
  finishReason?: string;
  mismatchOffset?: number;
  expectedChars?: number;
  actualChars?: number;
}

/** Development diagnostics contain counts/timings only, never text, endpoints or credentials. */
function createAnalysisDiagnostics(
  text: string,
  model: string,
  options: AnalyzeRequestOptions,
  context: { chunkIndex: number; chunkCount: number; start: number; end: number; attempt: number; recovery: boolean },
) {
  const started = performance.now();
  const inputChars = Array.from(text).length;
  let outputChars = 0;
  let reasoningChars = 0;
  let lastProgress = -Infinity;
  let ended = false;
  let sawContent = false;
  let sawReasoning = false;
  let failure: Partial<AnalysisDiagnosticEvent> = {};
  let finishReason: string | undefined;
  const report = (stage: AnalysisDiagnosticEvent['stage'], status?: number) => {
    if (ended) return;
    const event: AnalysisDiagnosticEvent = {
      stage, model, ...context, inputChars, outputChars, reasoningChars, finishReason, ...failure,
      elapsedMs: Math.round(performance.now() - started),
      ...(status === undefined ? {} : { status }),
    };
    if (options.onDiagnostics) options.onDiagnostics(event);
    else if (process.env.NODE_ENV === 'development') console.debug('[analysis-diagnostic]', JSON.stringify(event));
  };
  report('start');
  return {
    headers(status: number) { report('headers', status); },
    terminal(reason: string) { finishReason = reason; },
    error(error: unknown) {
      failure = error instanceof AnalysisValidationError
        ? { errorCode: error.code, ...error.details }
        : { errorCode: error instanceof ApiRequestError ? 'http' : 'network' };
      this.finish('error');
    },
    progress(stage: 'content' | 'reasoning', length: number) {
      const first = stage === 'content' ? !sawContent : !sawReasoning;
      if (stage === 'content') {
        outputChars = length;
        sawContent = true;
      } else {
        reasoningChars = length;
        sawReasoning = true;
      }
      if (first || performance.now() - lastProgress >= 5000) {
        report(stage);
        lastProgress = performance.now();
      }
    },
    finish(stage: 'complete' | 'error' | 'cancel') {
      report(stage);
      ended = true;
    },
  };
}

export interface ReasoningSummaryRequestOptions {
  reasoningSnippet: string;
  endpoint: ModelEndpoint;
  userApiKey?: string;
  signal?: AbortSignal;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}


// 默认API地址 - 使用本地API路由
export const DEFAULT_API_URL = "/api";
const GEMINI_TTS_MODEL_NAME = 'gemini-3.1-flash-tts-preview';
const EDGE_TTS_MODEL_NAME = 'edge-tts';

export function getTtsModelName(provider: TTSProvider = 'edge'): string {
  return provider === 'gemini' ? GEMINI_TTS_MODEL_NAME : provider === 'openai' ? 'gpt-4o-mini-tts' : provider === 'minimax' ? 'speech-2.8-hd' : provider === 'volcengine' ? 'doubao-seed-tts-2.0' : EDGE_TTS_MODEL_NAME;
}

/** 客户端随请求发送的端点信息：baseUrl + model + 能力位 */
export interface EndpointPayload extends ModelEndpoint {
  caps?: ProviderCaps;
}

export function getRequestProviderPayload(endpoint: EndpointPayload) {
  return {
    baseUrl: endpoint.baseUrl,
    model: endpoint.model,
    caps: endpoint.caps,
  };
}

/**
 * 把上一版「一个 profile = 一个模型」的平铺结构迁移成 service + models 结构。
 * 每条 profile 变成一个单模型 service；旧 jsonSchema 能力迁移到模型级 structuredOutput。
 */
function migrateFlatProfiles(raw: unknown): ProviderProfile[] {
  if (!Array.isArray(raw)) return [];
  const services: ProviderProfile[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '';
    const model = typeof item.model === 'string' ? item.model.trim() : '';
    if (!baseUrl || !model) continue;
    const rawCaps = item.caps && typeof item.caps === 'object' ? (item.caps as Record<string, unknown>) : {};
    const caps: ModelCaps = {
      structuredOutput: rawCaps.jsonSchema !== false ? 'json_schema' : 'json_object',
    };
    if (typeof rawCaps.thinking === 'boolean') caps.thinking = rawCaps.thinking;
    if (typeof rawCaps.vision === 'boolean') caps.vision = rawCaps.vision;
    if (typeof rawCaps.reasoningEffort === 'string' && rawCaps.reasoningEffort.trim()) {
      caps.reasoningEffort = rawCaps.reasoningEffort.trim();
    }
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id || baseUrl;
    services.push({
      id,
      name,
      baseUrl,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
      models: [{ id: createCustomModelId(), name: model, model, caps }],
    });
  }
  return services;
}

/** 把旧的「aiProvider/aiModel/geminiApiKey/deepseekApiKey」迁移成 service + models 结构 */
function migrateLegacyProfile(storage: StorageLike): { services: ProviderProfile[]; activeServiceId: string; activeModelId: string; geminiApiKey: string } {
  const legacyApiKey = storage.getItem('userApiKey') || '';
  let geminiApiKey = storage.getItem('geminiApiKey');
  if (geminiApiKey === null && legacyApiKey) {
    geminiApiKey = legacyApiKey;
    storage.setItem('geminiApiKey', legacyApiKey);
  }

  const provider = storage.getItem('aiProvider');
  const model = storage.getItem('aiModel');
  const deepseekKey = storage.getItem('deepseekApiKey') || '';

  let service: ProviderProfile | null = null;
  if (provider === 'deepseek' && deepseekKey) {
    const modelName = model || 'deepseek-chat';
    service = {
      id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: deepseekKey,
      models: [{ id: createCustomModelId(), name: modelName, model: modelName, caps: { structuredOutput: 'json_object', thinking: true } }],
    };
  } else if (provider === 'gemini' && geminiApiKey) {
    const modelName = model || 'gemini-flash-latest';
    service = {
      id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: geminiApiKey,
      models: [{ id: createCustomModelId(), name: modelName, model: modelName, caps: { structuredOutput: 'json_object' } }],
    };
  }

  const services = service ? [service] : [];
  return {
    services,
    activeServiceId: service?.id || '',
    activeModelId: service?.models[0].id || '',
    geminiApiKey: geminiApiKey || '',
  };
}

function resolveActiveIds(services: ProviderProfile[], serviceId: unknown, modelId: unknown): { activeServiceId: string; activeModelId: string } {
  const { service, model } = resolveModelSelection(services, serviceId, modelId);
  return { activeServiceId: service?.id ?? '', activeModelId: model?.id ?? '' };
}

export function loadAISettingsFromStorage(storage: StorageLike): StoredAISettings {
  const geminiApiKey = storage.getItem('geminiApiKey') || '';
  const thinkingEnabled = storage.getItem('thinkingEnabled') === 'true';
  const preferences = { thinkingEnabled, stream: storage.getItem('useStream') !== 'false' };

  const rawSettings = storage.getItem('providerSettings');
  if (rawSettings) {
    try {
      const parsed = JSON.parse(rawSettings) as { services?: unknown; profiles?: unknown; activeId?: unknown; activeServiceId?: unknown; activeModelId?: unknown };
      // 新结构：services（含 models）
      if (parsed.services !== undefined) {
        const services = migrateModelPreferences(sanitizeProfiles(parsed.services), preferences);
        if (services.length > 0) {
          const { activeServiceId, activeModelId } = resolveActiveIds(services, parsed.activeServiceId, parsed.activeModelId);
          return { services, activeServiceId, activeModelId, geminiApiKey, thinkingEnabled };
        }
      }
      // 上一版平铺结构：profiles（一个 profile = 一个模型）
      const services = migrateModelPreferences(migrateFlatProfiles(parsed.profiles), preferences);
      if (services.length > 0) {
        // 旧 activeId 指向 service id
        const byId = typeof parsed.activeId === 'string' && services.find((s) => s.id === parsed.activeId);
        const target = byId || services[0];
        return {
          services,
          activeServiceId: target.id,
          activeModelId: target.models[0].id,
          geminiApiKey,
          thinkingEnabled,
        };
      }
    } catch {
      // 解析失败则回退到最旧结构迁移
    }
  }

  // 最旧结构迁移
  const legacy = migrateLegacyProfile(storage);
  if (legacy.services.length > 0) {
    return {
      ...legacy,
      services: migrateModelPreferences(legacy.services, { ...preferences, thinkingEnabled: thinkingEnabled || storage.getItem('deepseekThinkingEnabled') === 'true' }),
      thinkingEnabled: thinkingEnabled || storage.getItem('deepseekThinkingEnabled') === 'true',
    };
  }

  return {
    services: [],
    activeServiceId: '',
    activeModelId: '',
    geminiApiKey,
    thinkingEnabled,
  };
}

/** 把 service + models 结构写回存储，并清理旧键 */
export function saveAISettingsToStorage(storage: StorageLike, settings: StoredAISettings): void {
  const services = migrateModelPreferences(sanitizeProfiles(settings.services), {
    stream: storage.getItem('useStream') !== 'false', thinkingEnabled: settings.thinkingEnabled === true,
  });
  // 先写新键，再清理旧键（geminiApiKey 既作新键也作旧键，最后统一写回）
  storage.setItem('providerSettings', JSON.stringify({
    services,
    activeServiceId: settings.activeServiceId,
    activeModelId: settings.activeModelId,
  }));
  for (const key of ['thinkingEnabled', 'useStream', 'aiProvider', 'aiModel', 'deepseekApiKey', 'deepseekThinkingEnabled', 'geminiApiUrl', 'deepseekApiUrl', 'userApiUrl', 'userApiKey']) {
    try { storage.removeItem(key); } catch { /* 可选清理 */ }
  }
  storage.setItem('geminiApiKey', settings.geminiApiKey);
}

// 获取API请求URL
export function getApiEndpoint(endpoint: string): string {
  return `${DEFAULT_API_URL}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
}

// 构建请求头
function getHeaders(userApiKey?: string): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json', 'X-App-Locale': getClientLocale() };
  
  // 如果用户提供了自定义API密钥，则添加到请求头
  if (userApiKey) {
    headers['Authorization'] = `Bearer ${userApiKey}`;
  }
  
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractJsonText(content: string): string {
  const jsonMatch = content.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }

  return content.trim();
}

function normalizeTokenDataArray(parsed: unknown): TokenData[] {
  const rawTokens = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.tokens : null;
  if (!Array.isArray(rawTokens) || !rawTokens.length || rawTokens.some(item =>
    !isRecord(item) || typeof item.word !== 'string' || !item.word || typeof item.pos !== 'string' || !item.pos.trim()
    || (item.furigana !== undefined && typeof item.furigana !== 'string'))) {
    throw new AnalysisValidationError('invalid_tokens');
  }
  return rawTokens.map(item => ({ word: item.word, pos: item.pos, furigana: item.furigana ?? '',
    romaji: getLocalRomaji(item.word, item.furigana ?? '', item.pos) }));
}

export function parseAnalyzeResponseContent(content: string): TokenData[] {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJsonText(content)); }
  catch { throw new AnalysisValidationError('invalid_json'); }
  return normalizeTokenDataArray(parsed);
}

export async function summarizeReasoningProgress(
  options: ReasoningSummaryRequestOptions
): Promise<string> {
  const response = await fetch(getApiEndpoint('/reasoning-summary'), {
    method: 'POST',
    headers: getHeaders(options.userApiKey),
    body: JSON.stringify({
      reasoningSnippet: options.reasoningSnippet,
      ...getRequestProviderPayload(options.endpoint),
    }),
    signal: options.signal,
  });

  const data = await response.json().catch(() => null) as {
    summary?: unknown;
    error?: { message?: unknown };
  } | null;

  if (!response.ok) {
    const message = typeof data?.error?.message === 'string'
      ? data.error.message
      : response.statusText || '思考摘要生成失败';
    throw new Error(message);
  }

  if (typeof data?.summary !== 'string' || !data.summary.trim()) {
    throw new Error('思考摘要响应格式错误');
  }

  return data.summary.trim();
}

function reconstructTokenText(tokens: TokenData[]): string {
  return tokens.map((token) => token.word).join('');
}

function alignTokenWhitespaceToSource(source: string, tokens: TokenData[], allowPartial = false): TokenData[] | null {
  const sourceWithoutWhitespace = source.replace(/\s/gu, '');
  const compactWords = tokens.map((token) => token.word.replace(/\s/gu, ''));
  const tokensWithoutWhitespace = compactWords.join('');
  if (allowPartial
    ? !sourceWithoutWhitespace.startsWith(tokensWithoutWhitespace)
    : sourceWithoutWhitespace.normalize('NFC') !== tokensWithoutWhitespace.normalize('NFC')) return null;
  const restoredCompactWords = allowPartial ? compactWords : restoreCanonicalWords(sourceWithoutWhitespace, compactWords);
  if (!restoredCompactWords) return null;

  const alignedTokens: TokenData[] = [];
  let sourceIndex = 0;

  const appendSourceWhitespace = () => {
    while (sourceIndex < source.length && /\s/u.test(source[sourceIndex])) {
      const character = source[sourceIndex];
      alignedTokens.push({
        word: character,
        pos: character === '\n' || character === '\r' ? '改行' : '記号',
        furigana: '',
        romaji: '',
      });
      sourceIndex += 1;
    }
  };

  for (const [tokenIndex, token] of tokens.entries()) {
    const normalizedWord = restoredCompactWords[tokenIndex];
    if (!normalizedWord) continue;

    let segment = '';
    let emittedSegment = false;
    const flushSegment = () => {
      if (!segment) return;
      alignedTokens.push({
        ...token,
        word: segment,
        furigana: emittedSegment ? '' : token.furigana,
        romaji: emittedSegment ? '' : token.romaji,
      });
      emittedSegment = true;
      segment = '';
    };

    appendSourceWhitespace();
    for (const character of normalizedWord) {
      if (/\s/u.test(source[sourceIndex] || '')) {
        flushSegment();
        appendSourceWhitespace();
      }
      if (!source.startsWith(character, sourceIndex)) return null;
      segment += character;
      sourceIndex += character.length;
    }
    flushSegment();
  }

  appendSourceWhitespace();
  return allowPartial || sourceIndex === source.length ? alignedTokens : null;
}

function reconcileChunkReconstruction(
  chunk: JapaneseTextChunk,
  tokens: TokenData[],
): TokenData[] {
  if (reconstructTokenText(tokens) === chunk.text) return tokens;

  const canonicalWords = restoreCanonicalWords(chunk.text, tokens.map(token => token.word));
  if (canonicalWords) return tokens.map((token, index) => ({ ...token, word: canonicalWords[index] }));

  const whitespaceAlignedTokens = alignTokenWhitespaceToSource(chunk.text, tokens);
  if (whitespaceAlignedTokens) return whitespaceAlignedTokens;

  const reconstructed = reconstructTokenText(tokens);
  let mismatchOffset = 0;
  while (mismatchOffset < chunk.text.length && chunk.text[mismatchOffset] === reconstructed[mismatchOffset]) mismatchOffset++;
  throw new AnalysisValidationError('source_mismatch', {
    mismatchOffset: chunk.start + mismatchOffset, expectedChars: chunk.text.length, actualChars: reconstructed.length,
  });
}

const requiredWordDetailFields = ['chineseTranslation', 'dictionaryForm', 'explanation'] as const;
const optionalWordDetailFields = ['originalWord', 'pos', 'furigana', 'romaji', 'conjugation', 'example', 'exampleTranslation', 'category', 'breakdown'] as const;
const wordDetailFields = [...requiredWordDetailFields, ...optionalWordDetailFields] as const;

type WordDetailField = typeof wordDetailFields[number];

function decodeLooseJsonStringValue(value: string): string {
  let decoded = '';

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== '\\') {
      decoded += char;
      continue;
    }

    const next = value[++i];
    if (next === undefined) {
      decoded += char;
      break;
    }

    if (next === 'n') decoded += '\n';
    else if (next === 'r') decoded += '\r';
    else if (next === 't') decoded += '\t';
    else if (next === 'b') decoded += '\b';
    else if (next === 'f') decoded += '\f';
    else if (next === '"' || next === '\\' || next === '/') decoded += next;
    else if (next === 'u') {
      const hex = value.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        decoded += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        decoded += `\\${next}`;
      }
    } else {
      decoded += next;
    }
  }

  return decoded;
}

function parseLooseWordDetailObject(content: string): Record<WordDetailField, string> {
  const jsonText = extractJsonText(content);
  const objectStart = jsonText.indexOf('{');
  const objectEnd = jsonText.lastIndexOf('}');
  if (objectStart === -1 || objectEnd <= objectStart) {
    throw new Error('释义结果不是有效 JSON 对象');
  }

  const values: Partial<Record<WordDetailField, string>> = {};
  // 按实际字段顺序恢复，兼容精简响应和旧版词条。
  const fields = wordDetailFields.filter((field) =>
    (requiredWordDetailFields as readonly string[]).includes(field)
    || new RegExp(`"${field}"\\s*:`).test(jsonText))
    .sort((a, b) => jsonText.indexOf(`"${a}"`) - jsonText.indexOf(`"${b}"`));

  fields.forEach((field, index) => {
    const fieldPattern = new RegExp(`"${field}"\\s*:\\s*"`, 'm');
    const searchFrom = index === 0
      ? objectStart + 1
      : Math.max(
        objectStart + 1,
        ...fields
          .slice(0, index)
          .map((previousField) => jsonText.indexOf(`"${previousField}"`))
      );
    const fieldMatch = fieldPattern.exec(jsonText.slice(searchFrom));
    if (!fieldMatch || fieldMatch.index === undefined) {
      throw new Error(`释义结果缺少 ${field} 字段`);
    }

    const valueStart = searchFrom + fieldMatch.index + fieldMatch[0].length;
    let valueEnd = -1;

    if (index < fields.length - 1) {
      const nextFieldPattern = new RegExp(`"\\s*,\\s*"${fields[index + 1]}"\\s*:`, 'm');
      const nextFieldMatch = nextFieldPattern.exec(jsonText.slice(valueStart));
      if (nextFieldMatch && nextFieldMatch.index !== undefined) {
        valueEnd = valueStart + nextFieldMatch.index;
      }
    } else {
      valueEnd = jsonText.lastIndexOf('"', objectEnd);
    }

    if (valueEnd < valueStart) {
      throw new Error(`释义结果 ${field} 字段不完整`);
    }

    values[field] = decodeLooseJsonStringValue(jsonText.slice(valueStart, valueEnd));
  });

  const missingField = requiredWordDetailFields.find((field) => typeof values[field] !== 'string');
  if (missingField) {
    throw new Error(`释义结果缺少 ${missingField} 字段`);
  }

  return values as Record<WordDetailField, string>;
}

export interface WordDetailContext { word: string; pos: string; furigana?: string; kind?: WordDetailKind; }

export function parseWordDetailResponseContent(content: string, context?: WordDetailContext): WordDetail {
  let parsed: unknown;
  try { parsed = JSON.parse(extractJsonText(content)); }
  catch { parsed = parseLooseWordDetailObject(content); }
  if (!isRecord(parsed)) throw new Error('释义结果不是有效 JSON 对象');
  for (const field of requiredWordDetailFields) {
    if (typeof parsed[field] !== 'string') throw new Error(`释义结果缺少 ${field} 字段`);
  }
  for (const field of optionalWordDetailFields) {
    if (parsed[field] !== undefined && typeof parsed[field] !== 'string') throw new Error(`释义结果 ${field} 必须是字符串`);
  }
  // DeepSeek 只保证返回 JSON 对象，不保证短语字段齐全；缺类别会让「合并为一个词」悄悄消失，按未完整生成处理
  if (context?.kind === 'phrase') {
    if (typeof parsed.category !== 'string' || !PHRASE_CATEGORIES.includes(parsed.category.trim())) {
      throw new Error('短语释义缺少有效的 category 字段');
    }
    if (typeof parsed.breakdown !== 'string') throw new Error('短语释义缺少 breakdown 字段');
  }
  const detail = parsed as Record<WordDetailField, string>;
  const originalWord = context?.word || detail.originalWord;
  if (!originalWord) throw new Error('释义结果缺少 originalWord 字段');
  const pos = detail.pos?.trim() || context?.pos || '';
  // 短语的读音用前端按词拼出的结果，比 AI 返回的更完整可靠
  const isPhrase = context?.kind === 'phrase';
  const furigana = isPhrase
    ? context?.furigana || detail.furigana?.trim() || ''
    : detail.furigana?.trim() || context?.furigana || '';
  return {
    originalWord, chineseTranslation: detail.chineseTranslation, pos, furigana,
    romaji: getLocalRomaji(originalWord, furigana, pos),
    dictionaryForm: detail.dictionaryForm,
    explanation: normalizeEscapedLineBreaks(detail.explanation),
    conjugation: normalizeEscapedLineBreaks(detail.conjugation || ''),
    example: normalizeEscapedLineBreaks(detail.example || ''),
    exampleTranslation: normalizeEscapedLineBreaks(detail.exampleTranslation || ''),
    ...(isPhrase ? {
      kind: 'phrase' as const,
      category: detail.category?.trim() || '',
      breakdown: normalizeEscapedLineBreaks(detail.breakdown || ''),
      mergeReading: detail.furigana?.trim() || '',
    } : {}),
  };
}

function getMessageFromUnknownStreamError(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  if ('error' in value) {
    const error = value.error;
    if (typeof error === 'string') return error;
    if (isRecord(error) && typeof error.message === 'string') return error.message;
  }

  if (typeof value.message === 'string') return value.message;
  return undefined;
}

export function validateCompletion(result: unknown, label: string): void {
  if (!isRecord(result) || !Array.isArray(result.choices)) throw new InvalidResponseError(`${label}结果格式错误`);
  const choice = result.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string' || !choice.message.content.trim()) {
    throw new InvalidResponseError(`${label}结果格式错误`);
  }
  // Some compatible gateways omit the reason; explicit abnormal termination is never success.
  if (choice.finish_reason != null && choice.finish_reason !== 'stop') {
    throw new InvalidResponseError(getFinishReasonErrorMessage(String(choice.finish_reason), label));
  }
}

function getFinishReasonErrorMessage(finishReason: string, label: string): string {
  if (finishReason === 'length') {
    return `${label}被上游模型截断（finish_reason: length），请重新生成。`;
  }

  if (finishReason === 'content_filter') {
    return `${label}被上游内容安全策略中止（finish_reason: content_filter）。`;
  }

  return `${label}未正常结束（finish_reason: ${finishReason}）。`;
}

function getStreamEventFromData(
  data: string,
  parseWarning: string
): {
  content: string;
  reasoningContent: string;
  finishReason: string | null;
  errorMessage?: string;
} {
  try {
    const parsed = JSON.parse(data) as unknown;
    const errorMessage = getMessageFromUnknownStreamError(parsed);
    if (errorMessage) {
      return { content: '', reasoningContent: '', finishReason: null, errorMessage };
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.choices)) {
      return { content: '', reasoningContent: '', finishReason: null };
    }

    const firstChoice = parsed.choices[0];
    if (!isRecord(firstChoice)) {
      return { content: '', reasoningContent: '', finishReason: null };
    }

    const delta = isRecord(firstChoice.delta) ? firstChoice.delta : null;
    const message = isRecord(firstChoice.message) ? firstChoice.message : null;
    const content = typeof delta?.content === 'string'
      ? delta.content
      : typeof message?.content === 'string'
        ? message.content
        : '';
    const reasoningContent = typeof delta?.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof message?.reasoning_content === 'string'
        ? message.reasoning_content
        : '';
    const finishReason = typeof firstChoice.finish_reason === 'string'
      ? firstChoice.finish_reason
      : null;

    return { content, reasoningContent, finishReason };
  } catch {
    if (parseWarning) console.warn(parseWarning);
    return { content: '', reasoningContent: '', finishReason: null };
  }
}

export async function readOpenAIContentStream(
  response: Response,
  onChunk: (chunk: string, isDone: boolean) => void,
  onError: (error: Error) => void,
  options: {
    signal?: AbortSignal;
    debounceMs?: number;
    parseWarning?: string;
    validateFinalContent?: (content: string) => unknown;
    invalidContentMessage?: string;
    completionLabel?: string;
    onReasoning?: (text: string, done: boolean) => void;
    onContentStart?: () => void;
    reasoningDebounceMs?: number;
    analysisErrors?: boolean;
    onFinishReason?: (reason: string) => void;
  } = {}
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    onError(options.analysisErrors ? new AnalysisValidationError('interrupted') : new InvalidResponseError('无法创建流式读取器'));
    return;
  }

  const decoder = new TextDecoder();
  const debounceMs = options.debounceMs ?? 16;
  const parseWarning = options.parseWarning ?? 'Failed to parse streaming JSON chunk:';
  const completionLabel = options.completionLabel ?? '流式响应';
  const reasoningDebounceMs = options.reasoningDebounceMs ?? 32;
  let buffer = '';
  let rawContent = '';
  let rawReasoningContent = '';
  let terminalError: Error | null = null;
  let hasTerminalSignal = false;
  let hasContentStarted = false;
  let updateTimeout: ReturnType<typeof setTimeout> | null = null;
  let reasoningUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  let hasEmitted = false;

  const clearPendingUpdate = () => {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }
  };

  const clearPendingReasoningUpdate = () => {
    if (reasoningUpdateTimeout) {
      clearTimeout(reasoningUpdateTimeout);
      reasoningUpdateTimeout = null;
    }
  };

  const emitReasoning = (isComplete: boolean) => {
    if (options.signal?.aborted) return;
    if (!rawReasoningContent || !options.onReasoning) return;

    if (isComplete) {
      clearPendingReasoningUpdate();
      options.onReasoning(rawReasoningContent, true);
      return;
    }

    if (reasoningDebounceMs <= 0) {
      options.onReasoning(rawReasoningContent, false);
      return;
    }

    if (reasoningUpdateTimeout) return;
    reasoningUpdateTimeout = setTimeout(() => {
      reasoningUpdateTimeout = null;
      options.onReasoning?.(rawReasoningContent, false);
    }, reasoningDebounceMs);
  };

  const emit = (content: string, isComplete: boolean) => {
    if (options.signal?.aborted) return;

    if (isComplete) {
      clearPendingUpdate();
      onChunk(content, true);
      return;
    }

    if (debounceMs <= 0 || !hasEmitted) {
      hasEmitted = true;
      onChunk(content, false);
      return;
    }

    if (updateTimeout) return;
    updateTimeout = setTimeout(() => {
      updateTimeout = null;
      if (!options.signal?.aborted) onChunk(rawContent, false);
    }, debounceMs);
  };

  const fail = (error: Error): boolean => {
    if (options.signal?.aborted) return true;
    clearPendingUpdate();
    if (rawContent) {
      onChunk(rawContent, false);
    }
    if (rawReasoningContent) {
      emitReasoning(true);
    }
    onError(error);
    return true;
  };

  const complete = (): boolean => {
    if (options.signal?.aborted) return true;
    clearPendingUpdate();

    if (terminalError) {
      return fail(terminalError);
    }

    if (options.validateFinalContent) {
      try {
        options.validateFinalContent(rawContent);
      } catch (error) {
        if (error instanceof AnalysisValidationError) return fail(error);
        return fail(new InvalidResponseError(
          options.invalidContentMessage || `${completionLabel}没有完整生成，请重新生成。`
        ));
      }
    }

    if (rawReasoningContent) {
      emitReasoning(true);
    }
    emit(rawContent, true);
    return true;
  };

  const handleData = (data: string): boolean => {
    if (options.signal?.aborted) return true;
    if (data === '[DONE]') {
      hasTerminalSignal = true;
      return complete();
    }

    const {
      content,
      reasoningContent,
      finishReason,
      errorMessage,
    } = getStreamEventFromData(data, parseWarning);
    if (errorMessage) {
      return fail(options.analysisErrors
        ? errorMessage === '上游流式响应空闲超时，请重试。' ? new AnalysisValidationError('timeout') : new ApiRequestError(errorMessage, 502)
        : new Error(errorMessage));
    }

    if (content) {
      if (!hasContentStarted) {
        hasContentStarted = true;
        options.onContentStart?.();
      }
      rawContent += content;
      emit(rawContent, false);
    }

    if (reasoningContent) {
      rawReasoningContent += reasoningContent;
      emitReasoning(false);
    }

    if (finishReason) {
      hasTerminalSignal = true;
      options.onFinishReason?.(finishReason);
      if (finishReason.toLowerCase() !== 'stop') {
        terminalError = options.analysisErrors
          ? new AnalysisValidationError(finishReason === 'length' ? 'truncated' : finishReason === 'content_filter' ? 'content_filter' : 'interrupted', { finishReason })
          : new InvalidResponseError(getFinishReasonErrorMessage(finishReason, completionLabel));
        return fail(terminalError);
      }
    }

    return false;
  };

  const abort = () => {
    clearPendingUpdate();
    clearPendingReasoningUpdate();
    void reader.cancel().catch(() => {});
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) { abort(); return; }
    while (true) {
      const { value, done } = await reader.read();
      if (options.signal?.aborted) return;
      if (done) break;
      if (!value) continue;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;

        const trimmedLine = line.trimEnd();
        if (!trimmedLine.startsWith('data:')) continue;

        const data = trimmedLine.substring(5).trimStart();
        if (handleData(data)) return;
      }
    }

    buffer += decoder.decode();
    if (buffer.trim() !== '') {
      const trimmedBuffer = buffer.trim();
      if (trimmedBuffer.startsWith('data:')) {
        const data = trimmedBuffer.substring(5).trimStart();
        if (handleData(data)) return;
      }
    }

    if (!hasTerminalSignal && options.validateFinalContent) {
      fail(options.analysisErrors ? new AnalysisValidationError('interrupted')
        : new InvalidResponseError(`${completionLabel}连接已结束，但没有收到完整结束信号，请重新生成。`));
      return;
    }

    complete();
  } catch (error) {
    if (!options.signal?.aborted) throw error;
  } finally {
    clearPendingUpdate();
    clearPendingReasoningUpdate();
    options.signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// One bounded request. Both output modes share the same terminal/source validation.
async function requestAnalysisChunk(
  chunk: JapaneseTextChunk, context: AnalysisChunkProgress, signal: AbortSignal,
  onPartial: (tokens: TokenData[]) => void, stream: boolean, userApiKey: string | undefined,
  endpoint: EndpointPayload, options: AnalyzeRequestOptions, chunkCount: number,
): Promise<TokenData[]> {
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const diagnostics = createAnalysisDiagnostics(chunk.text, endpoint.model, options, {
    chunkIndex: context.rootIndex + 1, chunkCount, start: chunk.start, end: chunk.end,
    attempt: context.attempt, recovery: context.recovery,
  });
  const protectedInput = protectAnalysisUrls(chunk.text);
  let finalTokens: TokenData[] | undefined;
  const validate = (content: string) => reconcileChunkReconstruction(chunk, parseAnalyzeResponseContent(protectedInput.restoreContent(content)));
  const parser = new AnalyzeStreamParser();
  let previousSnapshot: TokenData[] | undefined;
  let removeAbort = () => {};
  const timeout = setTimeout(() => controller.abort(new AnalysisValidationError('timeout')), Math.min(options.requestTimeoutMs ?? 120_000, 120_000));
  const aborted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(controller.signal.aborted && !signal.aborted
      ? controller.signal.reason : new DOMException('Analysis cancelled', 'AbortError'));
    requestSignal.addEventListener('abort', abort, { once: true });
    removeAbort = () => requestSignal.removeEventListener('abort', abort);
    if (requestSignal.aborted) abort();
  });
  const request = async () => {
    if (requestSignal.aborted) throw requestSignal.reason;
    const compact = options.compactJson ? '\n使用紧凑 JSON，不要缩进；word 字符串内部的原文空白必须保留。\n' : '';
    const response = await fetch(getApiEndpoint('/analyze'), {
      method: 'POST', headers: getHeaders(userApiKey), signal: requestSignal,
      body: JSON.stringify({ prompt: buildAnalyzePrompt(protectedInput.text, protectedInput.instruction + compact),
        ...getRequestProviderPayload(endpoint), thinkingEnabled: options.thinkingEnabled === true, stream }),
    });
    if (requestSignal.aborted) { void response.body?.cancel().catch(() => {}); throw requestSignal.reason; }
    diagnostics.headers(response.status);
    if (!response.ok) {
      // Do not log the upstream body: it may echo credentials or user text.
      const body = await response.json().catch(() => null);
      throw new ApiRequestError(`解析失败：${body?.error?.message || response.statusText || '未知错误'}`, response.status);
    }
    if (!stream) {
      let result: unknown;
      try { result = await response.json(); } catch { throw new AnalysisValidationError('invalid_json'); }
      if (!isRecord(result) || !Array.isArray(result.choices) || !isRecord(result.choices[0])) throw new AnalysisValidationError('invalid_tokens');
      const choice = result.choices[0];
      const message = isRecord(choice.message) ? choice.message : null;
      if (typeof message?.content === 'string') diagnostics.progress('content', message.content.length);
      if (typeof message?.reasoning_content === 'string') diagnostics.progress('reasoning', message.reasoning_content.length);
      const reason = choice.finish_reason;
      if (typeof reason === 'string') {
        diagnostics.terminal(reason);
        if (reason !== 'stop') throw new AnalysisValidationError(reason === 'length' ? 'truncated' : reason === 'content_filter' ? 'content_filter' : 'interrupted', { finishReason: reason });
      }
      if (!isRecord(choice.message) || typeof choice.message.content !== 'string') throw new AnalysisValidationError('invalid_tokens');
      if (requestSignal.aborted) throw requestSignal.reason;
      const content = choice.message.content;
      const reasoning = choice.message.reasoning_content;
      if (typeof reasoning === 'string' && reasoning) {
        options.onReasoning?.(reasoning, true);
      }
      options.onContentStart?.();
      finalTokens = validate(content);
      return;
    }
    let streamError: Error | undefined;
    await readOpenAIContentStream(response, (content, done) => {
      if (requestSignal.aborted) return;
      diagnostics.progress('content', content.length);
      if (done) { finalTokens = validate(content); return; }
      const tokens = parser.push(protectedInput.restoreContent(content));
      if (!tokens.length || tokens === previousSnapshot) return;
      previousSnapshot = tokens;
      const aligned = chunk.text.startsWith(reconstructTokenText(tokens)) ? tokens : alignTokenWhitespaceToSource(chunk.text, tokens, true);
      if (aligned) onPartial(aligned);
    }, error => { streamError = error; }, {
      signal: requestSignal, debounceMs: 40, analysisErrors: true, parseWarning: '',
      validateFinalContent: validate, onFinishReason: reason => diagnostics.terminal(reason),
      onReasoning: (text, done) => {
        if (requestSignal.aborted) return;
        diagnostics.progress('reasoning', text.length);
        options.onReasoning?.(text, done);
      }, onContentStart: options.onContentStart,
    });
    if (streamError) throw streamError;
    if (!finalTokens) throw new AnalysisValidationError('interrupted');
  };
  try {
    await Promise.race([request(), aborted]);
    if (requestSignal.aborted) throw requestSignal.reason;
    diagnostics.finish('complete');
    return finalTokens!;
  } catch (error) {
    if (signal.aborted) { diagnostics.finish('cancel'); throw new DOMException('Analysis cancelled', 'AbortError'); }
    const classified = controller.signal.aborted ? controller.signal.reason
      : error instanceof ApiRequestError || error instanceof AnalysisValidationError ? error : new AnalysisValidationError('interrupted');
    diagnostics.error(classified);
    throw classified;
  } finally {
    clearTimeout(timeout);
    removeAbort();
  }
}

export function createAnalysisSession(
  sentence: string, userApiKey?: string, endpoint: EndpointPayload = { baseUrl: '', model: '' },
  options: AnalyzeRequestOptions & { stream?: boolean } = {},
): AnalysisSession {
  if (!sentence) throw new Error('缺少句子');
  const chunks = splitJapaneseText(sentence, options.chunking);
  const reasoning = new Map<string, string>();
  const reasoningText = () => [...reasoning].sort(([a], [b]) => Number(a.split(':')[0]) - Number(b.split(':')[0]))
    .map(([, value]) => value).join('\n\n');
  let reasoningComplete = false;
  return new AnalysisSession(sentence, (chunk, context, signal, onPartial) => {
    // Replace a failed attempt's reasoning rather than appending overlapping copies.
    for (const id of reasoning.keys()) {
      const [start, end] = id.split(':').map(Number);
      if (start < chunk.end && end > chunk.start) reasoning.delete(id);
    }
    return requestAnalysisChunk(chunk, context, signal, onPartial, options.stream !== false, userApiKey, endpoint, {
      ...options,
      onReasoning: options.onReasoning ? text => {
        reasoning.set(context.id, text);
        options.onReasoning?.(reasoningText(), false);
      } : undefined,
    }, chunks.length);
  }, { ...options, onProgress: progress => {
    if (progress.status === 'complete' && !reasoningComplete && reasoning.size) {
      reasoningComplete = true;
      options.onReasoning?.(reasoningText(), true);
    }
    options.onProgress?.(progress);
  } });
}

// Compatibility APIs delegate to the same recoverable three-request scheduler.
export async function analyzeSentence(
  sentence: string, userApiKey?: string, endpoint: EndpointPayload = { baseUrl: '', model: '' }, options: AnalyzeRequestOptions = {},
): Promise<TokenData[]> {
  const session = createAnalysisSession(sentence, userApiKey, endpoint, { ...options, stream: false });
  const result = await session.run();
  if (result.status === 'cancelled') throw new DOMException('Analysis cancelled', 'AbortError');
  if (result.status !== 'complete') throw result.chunks.find(chunk => chunk.error)?.error ?? new AnalysisValidationError('invalid_tokens');
  return result.confirmedTokens;
}

export async function streamAnalyzeSentence(
  sentence: string, onChunk: (chunk: string, isDone: boolean) => void, onError: (error: Error) => void,
  userApiKey?: string, endpoint: EndpointPayload = { baseUrl: '', model: '' }, options: AnalyzeRequestOptions = {},
): Promise<void> {
  if (!sentence) { onError(new Error('缺少句子')); return; }
  let previous = '';
  const session = createAnalysisSession(sentence, userApiKey, endpoint, { ...options, stream: true,
    onProgress: progress => {
      options.onProgress?.(progress);
      if (progress.status === 'cancelled') return;
      const content = JSON.stringify({ tokens: progress.tokens });
      const done = progress.status === 'complete';
      if (done || (content !== previous && (progress.tokens.length > 0 || previous !== ''))) { previous = content; onChunk(content, done); }
    },
  });
  const result = await session.run();
  if (result.status === 'failed') onError(result.chunks.find(chunk => chunk.error)?.error ?? new AnalysisValidationError('invalid_tokens'));
}

// 流式翻译文本
export async function streamTranslateText(
  japaneseText: string,
  onChunk: (chunk: string, isDone: boolean) => void,
  onError: (error: Error) => void,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal
): Promise<void> {
  try {
    const apiUrl = getApiEndpoint('/translate');
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        text: japaneseText,
        ...getRequestProviderPayload(endpoint),
        stream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error (Stream Translation):', errorData);
      onError(new Error(`流式翻译失败：${errorData.error?.message || response.statusText || '未知错误'}`));
      return;
    }
    
    await readOpenAIContentStream(response, onChunk, onError, {
      signal,
      debounceMs: 60,
      parseWarning: 'Failed to parse streaming JSON chunk:',
      validateFinalContent: content => {
        if (!content.trim()) throw new InvalidResponseError('译文为空');
      },
      invalidContentMessage: '译文为空，请重试。',
      completionLabel: '翻译结果',
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return;
    console.error('Error in stream translating text:', error);
    onError(error instanceof Error ? error : new Error('未知错误'));
  }
}

// 获取词汇详情
export async function getWordDetails(
  word: string,
  pos: string,
  sentence: string,
  furigana?: string,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal,
  kind: WordDetailKind = 'word'
): Promise<WordDetail> {
  try {
    const apiUrl = getApiEndpoint('/word-detail');
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        word,
        pos,
        sentence,
        furigana,
        kind,
        ...getRequestProviderPayload(endpoint)
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('API Error (Word Detail):', errorData);
      throw new ApiRequestError(`查询释义失败：${errorData?.error?.message || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`}`, response.status);
    }

    const result = await response.json();
    validateCompletion(result, '词语详解');
    
    if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
      const responseContent = result.choices[0].message.content;
      try {
        return parseWordDetailResponseContent(responseContent, { word, pos, furigana, kind });
      } catch (e) {
        console.error("Failed to parse JSON from word detail response:", e, responseContent);
        throw new Error('释义结果JSON格式错误');
      }
    } else {
      console.error('Unexpected API response structure (Word Detail):', result);
      throw new Error('释义结果格式错误');
    }
  }
  catch (error) {
    console.error('Error fetching word details:', error);
    throw error;
  }
}

// 流式词汇详情查询函数
export async function streamWordDetails(
  word: string,
  pos: string,
  sentence: string,
  onChunk: (chunk: string, isDone: boolean) => void,
  onError: (error: Error) => void,
  furigana?: string,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal,
  kind: WordDetailKind = 'word'
): Promise<void> {
  try {
    const apiUrl = getApiEndpoint('/word-detail');
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        word,
        pos,
        sentence,
        furigana,
        kind,
        ...getRequestProviderPayload(endpoint),
        useStream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('API Error (Stream Word Detail):', errorData);
      onError(new ApiRequestError(`流式查询释义失败：${errorData?.error?.message || `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`}`, response.status));
      return;
    }
    
    await readOpenAIContentStream(response, onChunk, onError, {
      signal,
      debounceMs: 50,
      parseWarning: '解析流式数据时出错:',
      validateFinalContent: content => parseWordDetailResponseContent(content, { word, pos, furigana, kind }),
      invalidContentMessage: '词语详解没有完整生成，请重新生成。',
      completionLabel: '词语详解',
    });
    
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return;
    console.error('Stream Word Detail error:', error);
    onError(error instanceof Error ? error : new Error('流式查询词汇详情时出错'));
  }
}

// 翻译文本
export async function translateText(
  japaneseText: string,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal
): Promise<string> {
  try {
    const apiUrl = getApiEndpoint('/translate');
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        text: japaneseText,
        ...getRequestProviderPayload(endpoint)
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error (Translation):', errorData);
      throw new Error(`翻译失败：${errorData.error?.message || response.statusText || '未知错误'}`);
    }

    const result = await response.json();
    validateCompletion(result, '翻译');
    
    if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
      return result.choices[0].message.content.trim();
    } else {
      console.error('Unexpected API response structure (Translation):', result);
      throw new Error('翻译结果格式错误');
    }
  } catch (error) {
    if (!signal?.aborted) console.error('Error translating text:', error);
    throw error;
  }
}

// 从图片提取文本
export async function extractTextFromImage(
  imageData: string,
  prompt?: string,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal
): Promise<string> {
  if (!supportsImageInput(endpoint.model, endpoint.caps)) throw new Error('当前模型不支持图片解析，请切换到支持图片输入的多模态模型。');
  try {
    const apiUrl = getApiEndpoint('/image-to-text');
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        imageData,
        prompt,
        ...getRequestProviderPayload(endpoint)
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error (Image to Text):', errorData);
      throw new Error(`图片文字提取失败：${errorData.error?.message || response.statusText || '未知错误'}`);
    }

    const result = await response.json();
    validateCompletion(result, '图片文字提取');
    
    if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
      return result.choices[0].message.content.trim();
    } else {
      console.error('Unexpected API response structure (Image to Text):', result);
      throw new Error('图片文字提取结果格式错误');
    }
  } catch (error) {
    console.error('Error extracting text from image:', error);
    throw error;
  }
}

// 从图片提取文本 - 流式版本
export async function streamExtractTextFromImage(
  imageData: string,
  onChunk: (chunk: string, isDone: boolean) => void,
  onError: (error: Error) => void,
  prompt?: string,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal
): Promise<void> {
  try {
    const apiUrl = getApiEndpoint('/image-to-text');
    if (!supportsImageInput(endpoint.model, endpoint.caps)) {
      onError(new Error('当前模型不支持图片解析，请切换到支持图片输入的多模态模型。'));
      return;
    }
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        imageData,
        prompt,
        ...getRequestProviderPayload(endpoint),
        stream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('API Error (Stream Image to Text):', errorData);
      onError(new Error(`流式图片文字提取失败：${errorData.error?.message || response.statusText || '未知错误'}`));
      return;
    }
    
    await readOpenAIContentStream(response, onChunk, onError, {
      signal,
      debounceMs: 16,
      parseWarning: 'Failed to parse streaming JSON chunk:',
      validateFinalContent: content => {
        if (!content.trim()) throw new InvalidResponseError('没有识别到图片中的文字');
      },
      invalidContentMessage: '没有识别到图片中的文字，请换一张图片重试。',
      completionLabel: '图片文字提取',
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return;
    console.error('Error in stream extracting text from image:', error);
    onError(error instanceof Error ? error : new Error('未知错误'));
  }
}

export interface SpeechSynthesisCue {
  word: string;
  startTime: number;
  endTime: number;
}

export interface SpeechSynthesisResult {
  audio: string;
  mimeType: string;
  cues?: SpeechSynthesisCue[];
}

// 合成语音
export async function synthesizeSpeech(
  text: string,
  provider: TTSProvider = 'edge',
  options: SpeechRequestOptions = {},
  userApiKey?: string
): Promise<SpeechSynthesisResult> {
  const { gender = 'female', voice, rate = 0, pitch = 0, model, baseUrl, speed } = options;

  const apiUrl = getApiEndpoint('/tts');
  const headers = getHeaders(userApiKey);

  const response = await fetch(apiUrl, {
    method: 'POST',
    signal: options.signal,
    headers,
    body: JSON.stringify({ 
      text, 
      provider,
      gender,
      voice,
      rate,
      pitch, model, baseUrl, speed
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = typeof errorData.error === 'string'
      ? errorData.error
      : errorData.error?.message || `TTS 请求失败（HTTP ${response.status}）`;
    throw new Error(message);
  }

  return response.json();
}

// 聊天API - 流式版本
export async function streamChat(
  messages: ChatMessage[],
  onChunk: (chunk: string, isDone: boolean) => void,
  onError: (error: Error) => void,
  userApiKey?: string,
  endpoint: EndpointPayload = { baseUrl: '', model: '' },
  signal?: AbortSignal,
  options?: { companion?: boolean; chatMode?: 'sentence' | 'free'; sentenceContext?: string }
): Promise<void> {
  try {
    const apiUrl = getApiEndpoint('/chat');
    const headers = getHeaders(userApiKey);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        messages,
        companion: options?.companion === true,
        chatMode: options?.chatMode,
        sentenceContext: options?.chatMode === 'sentence' ? options.sentenceContext : undefined,
        ...getRequestProviderPayload(endpoint),
        useStream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API Error (Stream Chat):', errorData);
      onError(new ApiRequestError(`聊天失败：${errorData.error?.message || response.statusText || '未知错误'}`, response.status));
      return;
    }
    
    await readOpenAIContentStream(response, onChunk, onError, {
      signal,
      debounceMs: 30,
      parseWarning: '解析聊天流式数据时出错:',
      validateFinalContent: content => {
        if (!content.trim()) throw new InvalidResponseError('聊天回复为空');
      },
      invalidContentMessage: '聊天回复为空，请重试。',
    });
    
  } catch (error) {
    if (signal?.aborted) return;
    console.error('Stream Chat error:', error);
    onError(error instanceof Error ? error : new Error('聊天时出错'));
  }
}
