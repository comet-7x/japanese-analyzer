/// <reference lib="webworker" />
import { Inflate } from 'fflate';
import manifest from '../lib/localAnalyzerManifest.json';
import { LOCAL_INPUT_LIMIT, type LocalReply } from '../lib/localAnalyzerTypes';
import { schoolTokens, type RawToken } from '../utils/localTokens';
import { getLocalRomaji } from '../utils/romaji';
import { splitJapaneseText } from '../utils/japaneseChunking';
import type { TokenData } from '../services/api';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const send = (value: LocalReply) => worker.postMessage(value);
interface Tokenizer { tokenize(text: string): RawToken[]; }
interface Binding { default(): Promise<unknown>; SudachiTokenizer: new (bytes: Uint8Array) => Tokenizer; }
let tokenizer: Promise<Tokenizer> | undefined;

async function digest(data: Uint8Array) {
  if (!crypto.subtle) throw new Error('本地解析需要 HTTPS 或 localhost。');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>))].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function openCache(): Promise<IDBDatabase | null> {
  try {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open('japaneseAnalyzer-localDictionary', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('chunks');
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve(null);
      request.onsuccess = () => resolve(request.result);
    });
  } catch { return null; }
}
async function cached(db: IDBDatabase | null, key: string): Promise<Uint8Array | null> {
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('chunks').objectStore('chunks').get(key);
      request.onsuccess = () => resolve(request.result instanceof Uint8Array ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}
async function save(db: IDBDatabase | null, key: string, bytes: Uint8Array) {
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('chunks', 'readwrite');
      transaction.objectStore('chunks').put(bytes, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* Storage denial/quota affects reuse, not source parsing. */ }
}

async function initialize(): Promise<Tokenizer> {
  const moduleUrl = new URL('/local-analyzer/sudachi-0.7.0/sudachi.js', worker.location.origin).href;
  const binding = await import(/* webpackIgnore: true */ moduleUrl) as Binding;
  await binding.default();
  const db = await openCache();
  const bytes = new Uint8Array(manifest.rawBytes);
  let written = 0, downloaded = 0, reused = 0;
  const inflater = new Inflate(part => {
    if (written + part.length > bytes.length) throw new Error('本地词典校验失败，请重试。');
    bytes.set(part, written); written += part.length;
  });
  try {
    send({ type: 'progress', progress: { stage: 'download', loaded: 0, total: manifest.compressedBytes, cached: 0 } });
    for (const [index, chunk] of manifest.chunks.entries()) {
      let part = await cached(db, chunk.sha256);
      const valid = part?.length === chunk.bytes && await digest(part) === chunk.sha256;
      if (valid) reused += chunk.bytes;
      else {
        try {
          const response = await fetch(`/api/local-analyzer/dictionary/${chunk.sha256}`, { credentials: 'same-origin', signal: AbortSignal.timeout(90_000) });
          if (!response.ok) throw new Error('download');
          part = new Uint8Array(await response.arrayBuffer());
        } catch { throw new Error('本地词典下载失败，请检查网络或登录状态后重试。'); }
        if (part.length !== chunk.bytes || await digest(part) !== chunk.sha256) throw new Error('本地词典校验失败，请重试。');
        await save(db, chunk.sha256, part);
      }
      inflater.push(part!, index === manifest.chunks.length - 1);
      downloaded += chunk.bytes;
      send({ type: 'progress', progress: { stage: 'download', loaded: downloaded, total: manifest.compressedBytes, cached: reused } });
    }
    if (written !== bytes.length || await digest(bytes) !== manifest.rawSha256) throw new Error('本地词典校验失败，请重试。');
    send({ type: 'progress', progress: { stage: 'load', loaded: downloaded, total: downloaded, cached: reused } });
    return new binding.SudachiTokenizer(bytes);
  } finally { db?.close(); }
}

worker.onmessage = async (event: MessageEvent<{ text: string }>) => {
  try {
    const { text } = event.data;
    if (typeof text !== 'string' || !text.trim() || text.length > LOCAL_INPUT_LIMIT) throw new Error('本地解析每次最多支持 12000 个字符。');
    tokenizer ??= initialize().catch(error => { tokenizer = undefined; throw error; });
    const engine = await tokenizer;
    send({ type: 'progress', progress: { stage: 'parse', loaded: 0, total: text.length, cached: 0 } });
    const tokens: TokenData[] = [];
    for (const chunk of splitJapaneseText(text)) {
      let converted;
      try { converted = schoolTokens(chunk.text, engine.tokenize(chunk.text)); }
      catch { throw new Error('本地初稿未能完整还原原文。'); }
      tokens.push(...converted.map(t => ({ word: t.word, pos: t.pos, furigana: t.reading, romaji: getLocalRomaji(t.word, t.reading, t.pos) })));
      send({ type: 'partial', tokens });
    }
    if (tokens.map(t => t.word).join('') !== text) throw new Error('解析结果未能完整还原原文。');
    send({ type: 'complete', tokens });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : '本地解析失败，请重试或切换模型解析。' });
  }
};
