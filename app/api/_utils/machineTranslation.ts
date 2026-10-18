import type { Locale } from '../../i18n';
import type { MachineTranslationProviderId } from '../../lib/translationServices';

export class MachineTranslationError extends Error {
  constructor(message: string, readonly status = 502, readonly code?: string) { super(message); }
}

const targetLanguages: Record<Locale, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  en: 'en',
  ko: 'ko',
};

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

async function requestMyMemory(text: string, target: string, signal: AbortSignal, email?: string, clientIp?: string): Promise<string> {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text); url.searchParams.set('langpair', `ja|${target}`);
  if (email) url.searchParams.set('de', email);
  if (clientIp) url.searchParams.set('ip', clientIp);
  const response = await fetch(url.toString(), {
    method: 'GET', signal, cache: 'no-store',
  });
  const value = await response.json().catch(() => null) as { responseData?: { translatedText?: string }; responseStatus?: number | string; responseDetails?: string; quotaFinished?: boolean } | null;
  const translated = value?.responseData?.translatedText;
  const providerStatus = Number(value?.responseStatus);
  if (value?.quotaFinished === true || response.status === 429 || providerStatus === 429
    || (providerStatus !== 200 && /quota|used all available free translations|next available in/i.test(value?.responseDetails || translated || ''))) {
    throw new MachineTranslationError('MyMemory 翻译额度已用完，请稍后重试或手动切换翻译来源。', 429, 'MYMEMORY_QUOTA_EXCEEDED');
  }
  if (!response.ok || providerStatus !== 200 || typeof translated !== 'string' || !translated.trim()) {
    if (email && /(?:invalid.*e-?mail|e-?mail.*invalid)/i.test(value?.responseDetails || translated || '')) {
      throw new MachineTranslationError('MyMemory 未接受此邮箱，请检查邮箱地址或留空使用匿名翻译。', 400, 'MYMEMORY_EMAIL_INVALID');
    }
    const status = !response.ok ? response.status : Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599 ? providerStatus : 502;
    throw new MachineTranslationError(value?.responseDetails || `MyMemory 翻译请求失败（HTTP ${status}）`, status);
  }
  return decodeHtmlEntities(translated);
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
  signal: AbortSignal, email?: string, clientIp?: string): Promise<string> {
  if (provider !== 'mymemory') throw new MachineTranslationError('机器翻译参数无效。', 400);
  const target = targetLanguages[locale];
  const parts = text.split(/(\r\n|\n|\r)/);
  const translated: string[] = [];
  for (const part of parts) {
    signal.throwIfAborted();
    if (/^(?:\r\n|\n|\r)$/.test(part) || !part.trim()) { translated.push(part); continue; }
    const chunks = splitLongLine(part, 450);
    const values: string[] = [];
    for (const chunk of chunks) {
      values.push(await requestMyMemory(chunk, target, signal, email, clientIp));
    }
    translated.push(values.join(''));
  }
  return translated.join('');
}
