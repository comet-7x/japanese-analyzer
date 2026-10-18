// 模型服务的通用类型与预设。任意 OpenAI 兼容厂商都以「服务商（base URL + 密钥 + 模型列表）」描述，
// 不再用固定的厂商枚举。结构化输出、thinking / reasoningEffort 都是模型能力。

export type StructuredOutputMode = 'json_schema' | 'json_object';

/** 模型级能力位，决定该模型请求体里附加哪些字段 */
export interface ModelCaps {
  /** Chat Completions 的结构化输出方式。自定义模型默认使用兼容性更好的 json_object。 */
  structuredOutput?: StructuredOutputMode;
  /** 该模型支持 DeepSeek 风格的 thinking / reasoning_effort 参数 */
  thinking?: boolean;
  /**
   * 启用深度思考时随请求发送的 reasoning_effort 取值。
   * 不同厂商接受的值不同（如 xhigh / medium / low，或 high），留空则不发送、由服务商用默认值。
   */
  reasoningEffort?: string;
}

/** 服务商下挂的一个模型 */
export interface ModelConfig {
  /** 稳定标识 */
  id: string;
  /** 展示名称（默认同模型名） */
  name: string;
  /** 上游模型名，例如 deepseek-chat / Qwen/Qwen3.8-27B */
  model: string;
  caps?: ModelCaps;
}

/** 浏览器里持久化的一个模型服务商配置（可挂多个模型） */
export interface ProviderProfile {
  /** 稳定标识：预设 id（如 'deepseek'）或自定义 slug */
  id: string;
  /** 展示名称 */
  name: string;
  /** 例如 https://api.deepseek.com 或 https://api.openai.com/v1 */
  baseUrl: string;
  /** 用户自己的 API 密钥，随请求以 Bearer 发送 */
  apiKey: string;
  /** @deprecated 只用于读取旧版浏览器配置；保存时迁移到每个模型。 */
  jsonSchema?: boolean;
  models: ModelConfig[];
}

/** 客户端发给服务端的模型能力位。 */
export interface ProviderCaps {
  structuredOutput?: StructuredOutputMode;
  /** @deprecated 接受旧客户端请求，服务端会立即换算为 structuredOutput。 */
  jsonSchema?: boolean;
  thinking?: boolean;
  reasoningEffort?: string;
}

export type ProviderPreset = Pick<ProviderProfile, 'id' | 'name' | 'baseUrl' | 'models'>;

/** 前端「从预设创建」时的便利选项；密钥仍由用户自己填 */
export const PRESETS: readonly ProviderPreset[] = [
  {
    id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.cn/v1',
    models: [{ id: 'minimax-m2.7', name: 'MiniMax-M2.7', model: 'MiniMax-M2.7', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [{ id: 'deepseek-chat', name: 'deepseek-chat', model: 'deepseek-chat', caps: { structuredOutput: 'json_object', thinking: true } }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [{ id: 'gpt-4o-mini', name: 'gpt-4o-mini', model: 'gpt-4o-mini', caps: { structuredOutput: 'json_schema' } }],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [{ id: 'openai-gpt-4o-mini', name: 'openai/gpt-4o-mini', model: 'openai/gpt-4o-mini', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [{ id: 'qwen-plus', name: 'qwen-plus', model: 'qwen-plus', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn',
    models: [{ id: 'kimi-k2-0711-preview', name: 'kimi-k2-0711-preview', model: 'kimi-k2-0711-preview', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'zhipu',
    name: 'Zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [{ id: 'glm-4.5', name: 'glm-4.5', model: 'glm-4.5', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [{ id: 'qwen3-30b-a3b', name: 'Qwen/Qwen3-30B-A3B', model: 'Qwen/Qwen3-30B-A3B', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'volcengine',
    name: 'Volcengine',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [{ id: 'doubao-seed-1-6-250615', name: 'doubao-seed-1-6-250615', model: 'doubao-seed-1-6-250615', caps: { structuredOutput: 'json_schema' } }],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [{ id: 'gemini-2.5-flash', name: 'gemini-2.5-flash', model: 'gemini-2.5-flash', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [{ id: 'llama-3.3-70b-versatile', name: 'llama-3.3-70b-versatile', model: 'llama-3.3-70b-versatile', caps: { structuredOutput: 'json_object' } }],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: [{ id: 'mistral-small-latest', name: 'mistral-small-latest', model: 'mistral-small-latest', caps: { structuredOutput: 'json_object' } }],
  },
];

/** 每次请求要发给服务端的最小端点信息（apiKey 走 Authorization: Bearer，不在此列） */
export interface ModelEndpoint {
  baseUrl: string;
  model: string;
}

/** 归一化上游端点：始终以 /chat/completions 结尾（与 OpenAI 兼容接口一致） */
export function normalizeEndpointUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** 为自定义服务商生成一个稳定的本地 id（仅客户端使用） */
export function createCustomProfileId(prefix = 'custom'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 为自定义模型生成一个稳定的本地 id（仅客户端使用） */
export function createCustomModelId(prefix = 'model'): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 合并服务商与模型的能力位，得到请求要发送的完整 caps */
export function effectiveCaps(service: ProviderProfile, model: ModelConfig | null | undefined): ProviderCaps {
  const legacyMode: StructuredOutputMode = service.jsonSchema === true ? 'json_schema' : 'json_object';
  const caps: ProviderCaps = { structuredOutput: model?.caps?.structuredOutput ?? legacyMode };
  if (model?.caps?.thinking === true) caps.thinking = true;
  if (model?.caps?.reasoningEffort) caps.reasoningEffort = model.caps.reasoningEffort;
  return caps;
}

/** 清洗一个未知的模型项；缺模型名的条目返回 null */
function sanitizeModel(raw: unknown, legacyMode: StructuredOutputMode = 'json_object'): ModelConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const model = typeof item.model === 'string' ? item.model.trim() : '';
  if (!model) return null;
  const caps: ModelCaps = {};
  if (item.caps && typeof item.caps === 'object') {
    const rawCaps = item.caps as Record<string, unknown>;
    caps.structuredOutput = rawCaps.structuredOutput === 'json_schema' || rawCaps.structuredOutput === 'json_object'
      ? rawCaps.structuredOutput : legacyMode;
    if (typeof rawCaps.thinking === 'boolean') caps.thinking = rawCaps.thinking;
    if (typeof rawCaps.reasoningEffort === 'string' && rawCaps.reasoningEffort.trim()) {
      caps.reasoningEffort = rawCaps.reasoningEffort.trim();
    }
  } else caps.structuredOutput = legacyMode;
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createCustomModelId(),
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : model,
    model,
    caps,
  };
}

/** Prefer a usable model while retaining providers whose last model was deleted. */
export function resolveModelSelection(services: ProviderProfile[], serviceId: unknown, modelId: unknown) {
  const requested = services.find((service) => service.id === serviceId);
  const service = (requested?.models.length ? requested : services.find((item) => item.models.length > 0))
    ?? requested ?? services[0] ?? null;
  const model = service?.models.find((item) => item.id === modelId) ?? service?.models[0] ?? null;
  return { service, model };
}

/** 清洗服务商配置；保留显式空模型列表，避免删除最后一个模型时丢失地址和密钥。 */
export function sanitizeProfiles(raw: unknown): ProviderProfile[] {
  if (!Array.isArray(raw)) return [];
  const profiles: ProviderProfile[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    const baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '';
    if (!baseUrl) continue;
    const legacyMode: StructuredOutputMode = item.jsonSchema === true ? 'json_schema' : 'json_object';
    const models = Array.isArray(item.models)
      ? item.models.map(model => sanitizeModel(model, legacyMode)).filter((m): m is ModelConfig => m !== null)
      : [];
    if (models.length === 0 && (!Array.isArray(item.models) || item.models.length > 0)) continue;
    profiles.push({
      id,
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id,
      baseUrl,
      apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
      models,
    });
  }
  return profiles;
}
