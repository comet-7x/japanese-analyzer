import { createHash, randomBytes } from 'crypto';
import type { Locale } from '../../i18n';
import type { MachineTranslationProviderId } from '../../lib/translationServices';

export class MachineTranslationError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export interface MachineTranslationCredentials {
  googleApiKey?: string;
  baiduAppId?: string;
  baiduSecret?: string;
}

const targetLanguages: Record<Locale, { google: string; baidu: string }> = {
  'zh-CN': { google: 'zh-CN', baidu: 'zh' },
  'zh-TW': { google: 'zh-TW', baidu: 'cht' },
  en: { google: 'en', baidu: 'en' },
  ko: { google: 'ko', baidu: 'kor' },
};

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function providerMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.error_msg === 'string') return record.error_msg;
  if (typeof record.message === 'string') return record.message;
  if (record.error && typeof record.error === 'object' && typeof (record.error as Record<string, unknown>).message === 'string') {
    return String((record.error as Record<string, unknown>).message);
  }
  return '';
}

async function requestGoogle(text: string, target: string, apiKey: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ q: text, source: 'ja', target, format: 'text' }),
  });
  const body = await response.json().catch(() => null) as { data?: { translations?: { translatedText?: string }[] } } | null;
  const translated = body?.data?.translations?.[0]?.translatedText;
  if (!response.ok || typeof translated !== 'string') {
    throw new MachineTranslationError(providerMessage(body) || `Google 翻译请求失败（HTTP ${response.status}）`, response.ok ? 502 : response.status);
  }
  return decodeHtmlEntities(translated);
}

async function requestBaidu(text: string, target: string, appId: string, secret: string, signal: AbortSignal): Promise<string> {
  const salt = randomBytes(12).toString('hex');
  const sign = createHash('md5').update(`${appId}${text}${salt}${secret}`, 'utf8').digest('hex');
  const body = new URLSearchParams({ q: text, from: 'jp', to: target, appid: appId, salt, sign });
  const response = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' }, body,
  });
  const value = await response.json().catch(() => null) as { trans_result?: { dst?: string }[]; error_code?: string; error_msg?: string } | null;
  if (!response.ok || value?.error_code || !Array.isArray(value?.trans_result)) {
    const code = value?.error_code;
    const status = !response.ok ? response.status
      : code === '52003' || code === '54001' ? 401
      : code === '54003' || code === '54004' ? 429 : 502;
    throw new MachineTranslationError(providerMessage(value) || `百度翻译请求失败（HTTP ${response.status}）`, status);
  }
  return value.trans_result.map(item => item.dst ?? '').join('\n');
}

function splitLongLine(value: string, byteLimit: number): string[] {
  if (Buffer.byteLength(value, 'utf8') <= byteLimit) return [value];
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = start; let bytes = 0; let sentenceEnd = start;
    for (const character of value.slice(start)) {
      const nextBytes = Buffer.byteLength(character, 'utf8');
      if (bytes + nextBytes > byteLimit) break;
      bytes += nextBytes; end += character.length;
      if (/[。！？.!?]/.test(character)) sentenceEnd = end;
    }
    if (end === start) throw new MachineTranslationError('机器翻译文本包含无法切分的内容。', 400);
    if (end < value.length && sentenceEnd > start && Buffer.byteLength(value.slice(start, sentenceEnd), 'utf8') >= byteLimit / 2) end = sentenceEnd;
    chunks.push(value.slice(start, end)); start = end;
  }
  return chunks;
}

/** Translate non-empty line contents and preserve every original newline sequence. */
export async function machineTranslate(text: string, provider: MachineTranslationProviderId, locale: Locale,
  credentials: MachineTranslationCredentials, signal: AbortSignal): Promise<string> {
  const googleKey = credentials.googleApiKey?.trim();
  const baiduAppId = credentials.baiduAppId?.trim();
  const baiduSecret = credentials.baiduSecret?.trim();
  if (provider === 'google' && !googleKey) throw new MachineTranslationError('未配置 Google 翻译 API Key。', 400);
  if (provider === 'baidu' && (!baiduAppId || !baiduSecret)) throw new MachineTranslationError('未配置百度翻译 AppID 或密钥。', 400);
  const target = targetLanguages[locale][provider];
  const parts = text.split(/(\r\n|\n|\r)/);
  const translated: string[] = [];
  for (const part of parts) {
    signal.throwIfAborted();
    if (/^(?:\r\n|\n|\r)$/.test(part) || !part.trim()) { translated.push(part); continue; }
    const chunks = splitLongLine(part, provider === 'baidu' ? 5_000 : 20_000);
    const values: string[] = [];
    for (const chunk of chunks) {
      values.push(provider === 'google'
        ? await requestGoogle(chunk, target, googleKey!, signal)
        : await requestBaidu(chunk, target, baiduAppId!, baiduSecret!, signal));
    }
    translated.push(values.join(''));
  }
  return translated.join('');
}
