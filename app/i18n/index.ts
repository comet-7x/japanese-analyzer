import { messages } from './messages';

export const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ko'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'zh-CN';
export const LANGUAGE_STORAGE_KEY = 'language';
export const LANGUAGE_LABELS: Record<Locale, string> = {
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ko: '한국어',
};

export function normalizeLocale(value: unknown): Locale {
  return LOCALES.includes(value as Locale) ? value as Locale : DEFAULT_LOCALE;
}

export function getClientLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  return normalizeLocale(document.documentElement.lang);
}

export type Translator = (key: string, ...values: (string | number)[]) => string;

export function createTranslator(locale: Locale): Translator {
  return (key, ...values) => {
    const entry = messages[key as keyof typeof messages];
    const text = locale === 'zh-CN' ? key : entry?.[locale] ?? key;
    return text.replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? match));
  };
}

// Match application-owned error templates, retaining unknown upstream diagnostics verbatim.
const errorTemplates = Object.keys(messages).filter(key => /\{\d+\}/.test(key)).map(key => {
  const pattern = key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
  return { key, pattern: new RegExp(`^${pattern}$`, 's') };
});

export function localizeError(message: string, locale: Locale, depth = 0): string {
  const t = createTranslator(locale);
  if (locale === 'zh-CN' || depth > 4) return message;
  if (message in messages) return t(message);
  for (const { key, pattern } of errorTemplates) {
    const match = pattern.exec(message);
    if (match) return t(key, ...match.slice(1).map(value => localizeError(value, locale, depth + 1)));
  }
  return message;
}

// UI boundary only: keep raw exceptions intact for diagnostics and recovery decisions.
const visibleMessages = new Map<string, string>();
const visibleTemplates: { key: string; pattern: RegExp }[] = [];
for (const [key, translations] of Object.entries(messages)) {
  for (const text of [key, ...Object.values(translations)]) {
    visibleMessages.set(text, key);
    if (/\{\d+\}/.test(text)) {
      const pattern = text.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
      visibleTemplates.push({ key, pattern: new RegExp(`^${pattern}$`, 's') });
    }
  }
}

export function formatUserFacingError(message: string, locale: Locale, fallback = '暂时无法完成，请重试。', depth = 0): string {
  const t = createTranslator(locale);
  const retry = () => t(fallback);
  const text = message.trim();
  if (!text || depth > 4 || text.length > 600) return retry();
  if (/```|unexpected (?:token|end|non-whitespace)|not valid json|json(?:\.parse| parse error)|unterminated|expected (?:property|double-quoted|','|':'|'}'|']')/i.test(text)) return retry();
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|ECONN(?:RESET|REFUSED)|ENOTFOUND|\boffline\b/i.test(text)) return t('网络连接失败，请检查网络后重试。');
  if (/timeout|timed out|超时|逾時/i.test(text)) return t('请求超时，请重试。');
  if (/(?:image|vision|multimodal).*(?:not support|unsupported|not allowed|text.only)|(?:does not support|unsupported|not a multimodal).*(?:image|vision)|image_url.*only supported/i.test(text)) return t('当前模型不支持图片解析，请切换到支持图片输入的多模态模型。');
  const status = /(?:\bHTTP\s*[:（(]?\s*|status(?:\s*code)?\s*[:=]?\s*|状态码[：:]?\s*)([45]\d{2})\b/i.exec(text)?.[1];
  if (status === '401' || /invalid[_\s-]*(?:api[_\s-]*)?key|incorrect.*api.?key|unauthori[sz]ed|authentication[_\s-]*(?:failed|error)/i.test(text)) return t('连接验证失败，请检查服务地址和 API 密钥。');
  if (status === '429' || /quota|rate.?limit|too many requests|insufficient[_\s-]*(?:balance|credit)/i.test(text)) return t('请求过于频繁或额度不足，请稍后重试或检查服务额度。');
  if (status === '403') return t('服务拒绝了请求，请检查访问权限或更换服务。');
  if (status === '404') return t('未找到所选模型或服务，请检查配置。');
  if (status === '413') return t('内容过长，请缩短后重试。');
  if (status === '504') return t('请求超时，请重试。');
  if (status?.startsWith('5')) return t('服务暂时不可用，请稍后重试。');
  if (/content_filter|内容安全策略/i.test(text)) return t('服务未能处理这段内容，请调整原文后重试。');
  const known = visibleMessages.get(text);
  let template: { key: string; match: RegExpExecArray } | undefined;
  if (!known) for (const { key, pattern } of visibleTemplates) {
    const match = pattern.exec(text);
    if (match) { template = { key, match }; break; }
  }
  // Classify a translated message by its canonical key, so ordinary translated status text remains stable.
  const description = known ?? template?.key ?? text;
  if (/\b(?:JSON|tokens|schema|finish_reason|SyntaxError|TypeError|ReferenceError|RangeError)\b|Cannot read propert|undefined is not an object|(?:结果|响应).*(?:字段|格式|无效|结构|拼回)|模型校正.*(?:词项|编号|范围|索引|读音|词性|修改项)|学习工具返回了无效结果|source_mismatch|invalid_(?:json|tokens)/i.test(description)) return retry();
  if (known === '未知错误' || known === '学习工具请求失败') return retry();
  if (known) return t(known);
  if (template) return t(template.key, ...template.match.slice(1).map(value => /^\d+(?:[./]\d+)*$/.test(value)
    ? value : formatUserFacingError(value, locale, fallback, depth + 1)));
  return retry();
}
