import { LOCAL_INPUT_LIMIT, type LocalProgress, type LocalReply } from '../lib/localAnalyzerTypes';
import type { TokenData } from './api';
import { validateLocalTokens } from '../lib/localCorrections';
import localAnalyzerManifest from '../lib/localAnalyzerManifest.json';

let instance: Worker | null = null;
let busy = false;
const WORKER_IDLE_TIMEOUT_MS = 120_000;
const WORKER_TOTAL_TIMEOUT_MS = 600_000;
/** One reusable engine per tab. Aborting terminates it, including active download/CPU work. */
export function analyzeLocally(text: string, options: { signal: AbortSignal; onProgress?: (progress: LocalProgress) => void; onPartial?: (tokens: TokenData[]) => void }): Promise<TokenData[]> {
  options.signal.throwIfAborted();
  if (text.length > LOCAL_INPUT_LIMIT) return Promise.reject(new Error('本地解析每次最多支持 12000 个字符。'));
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return Promise.reject(new Error('当前浏览器不支持本地解析，请使用模型解析。'));
  if (busy) return Promise.reject(new Error('本地解析正在运行，请先停止当前任务。'));
  return new Promise((resolve, reject) => {
    try { instance ??= new Worker('/local-analyzer/worker.js', { type: 'module', name: 'sudachi-local' }); }
    catch { reject(new Error('本地解析加载失败，请刷新页面或切换模型解析。')); return; }
    const worker = instance;
    busy = true;
    let settled = false;
    let idleTimeout: ReturnType<typeof setTimeout>;
    const totalTimeout = setTimeout(() => stop(new Error('本地解析超时，请重试或切换模型解析。')), WORKER_TOTAL_TIMEOUT_MS);
    const resetIdleTimeout = () => {
      clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => stop(new Error('本地解析超时，请重试或切换模型解析。')), WORKER_IDLE_TIMEOUT_MS);
    };
    const cleanup = () => { settled = true; clearTimeout(idleTimeout); clearTimeout(totalTimeout); busy = false; worker.onmessage = null; worker.onerror = null; options.signal.removeEventListener('abort', abort); };
    const stop = (error: Error) => { if (settled) return; cleanup(); worker.terminate(); if (instance === worker) instance = null; reject(error); };
    const abort = () => stop(new DOMException('Local analysis cancelled', 'AbortError'));
    options.signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => stop(new Error('本地解析加载失败，请刷新页面或切换模型解析。'));
    worker.onmessage = (event: MessageEvent<LocalReply>) => {
      if (options.signal.aborted) return;
      resetIdleTimeout();
      const data = event.data;
      try {
        if (data.type === 'progress') options.onProgress?.(data.progress);
        else if (data.type === 'partial') {
          if (!Array.isArray(data.tokens)) throw new Error();
          const prefix = data.tokens.map(t => t?.word).join('');
          validateLocalTokens(prefix, data.tokens);
          if (!text.startsWith(prefix)) throw new Error();
          options.onPartial?.(data.tokens);
        } else if (data.type === 'error') stop(new Error(data.message));
        else if (data.type === 'complete') {
          validateLocalTokens(text, data.tokens);
          cleanup(); resolve(data.tokens);
        } else throw new Error();
      } catch { stop(new Error('本地初稿未能完整还原原文。')); }
    };
    resetIdleTimeout();
    try { worker.postMessage({ text }); }
    catch { stop(new Error('本地解析加载失败，请刷新页面或切换模型解析。')); }
  });
}

export async function clearLocalDictionaryCache() {
  if (busy) throw new Error('本地解析正在运行，请先停止当前任务。');
  instance?.terminate(); instance = null;
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('japaneseAnalyzer-localDictionary');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('无法清除本地词典缓存。'));
    request.onblocked = () => reject(new Error('请关闭其他解析页面后重试。'));
  });
}

export async function isLocalDictionaryCached(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const request = indexedDB.open('japaneseAnalyzer-localDictionary', 1);
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains('chunks')) {
            request.result.createObjectStore('chunks');
          }
        } catch {
          // Ignore
        }
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains('chunks')) {
            db.close();
            try { indexedDB.deleteDatabase('japaneseAnalyzer-localDictionary'); } catch {}
            resolve(false);
            return;
          }
          const tx = db.transaction('chunks', 'readonly');
          const store = tx.objectStore('chunks');
          const keysRequest = store.getAllKeys();
          keysRequest.onsuccess = () => {
            const keys = new Set(keysRequest.result);
            db.close();
            resolve(localAnalyzerManifest.chunks.every(chunk => keys.has(chunk.sha256)));
          };
          keysRequest.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch {
          db.close();
          resolve(false);
        }
      };
    });
  } catch {
    return false;
  }
}
