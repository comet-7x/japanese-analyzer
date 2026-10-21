import { importLive2DZip } from './zipImport';
import { CAPABILITY_VERSION, type Live2DCapabilities } from './capabilities';

const DATABASE_NAME = 'japaneseAnalyzer-live2dModels';
const STORE_NAME = 'models';

export interface StoredLive2DModel {
  id: string;
  name: string;
  modelPath: string;
  importedAt: number;
  byteLength: number;
}

interface StoredRecord extends StoredLive2DModel {
  zip: Blob;
  capabilities?: Live2DCapabilities;
}
const capabilityCache = new Map<string, Live2DCapabilities>();

function storageError(): Error {
  return new Error('无法访问本地模型库，请检查浏览器存储权限或可用空间。');
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(storageError());
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(DATABASE_NAME, 1); }
    catch { reject(storageError()); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => { if (!settled) { settled = true; reject(storageError()); } };
    request.onblocked = () => { if (!settled) { settled = true; reject(storageError()); } };
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, value: (result: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let hasResult = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      db.close();
      if (error) reject(error);
      else if (hasResult) resolve(result);
      else reject(storageError());
    };
    try {
      const tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => finish();
      tx.onerror = tx.onabort = () => finish(storageError());
      operation(tx.objectStore(STORE_NAME), value => { result = value; hasResult = true; });
    } catch { finish(storageError()); }
  });
}

function metadata(record: StoredRecord): StoredLive2DModel {
  const { id, name, modelPath, importedAt, byteLength } = record;
  return { id, name, modelPath, importedAt, byteLength };
}

function newId(): string {
  if (typeof crypto === 'undefined') throw new Error('当前环境无法生成安全的模型 ID。');
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Validate and persist a user ZIP. A ZIP with several models requires options.modelPath. */
export async function importLive2DModel(
  file: File,
  options: { name?: string; modelPath?: string } = {},
): Promise<StoredLive2DModel> {
  const imported = await importLive2DZip(file, options.modelPath);
  const fallbackName = imported.modelPath.split('/').pop()!.replace(/\.model3\.json$/i, '');
  const record: StoredRecord = {
    id: newId(),
    name: options.name?.trim().slice(0, 80) || fallbackName,
    modelPath: imported.modelPath,
    importedAt: Date.now(),
    byteLength: file.size,
    zip: file,
    capabilities: imported.capabilities,
  };
  await transact<void>('readwrite', (store, setResult) => {
    store.put(record);
    setResult(undefined);
  });
  capabilityCache.set(record.id, imported.capabilities);
  return metadata(record);
}

export async function listLive2DModels(): Promise<StoredLive2DModel[]> {
  const records = await transact<StoredRecord[]>('readonly', (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => setResult(request.result as StoredRecord[]);
  });
  return records.map(metadata).sort((a, b) => b.importedAt - a.importedAt);
}

export async function getLive2DModelFiles(id: string): Promise<{ model: StoredLive2DModel; files: File[]; capabilities: Live2DCapabilities } | null> {
  const record = await transact<StoredRecord | undefined>('readonly', (store, setResult) => {
    const request = store.get(id);
    request.onsuccess = () => setResult(request.result as StoredRecord | undefined);
  });
  if (!record) return null;
  const { files, capabilities } = await importLive2DZip(record.zip, record.modelPath);
  capabilityCache.set(id, capabilities);
  // The renderer's File[] loader discovers a manifest from the supplied files.
  // Keep only the user's selected manifest when one archive contains several models.
  const selectedFiles = files.filter(file =>
    !/\.model3\.json$/i.test(file.webkitRelativePath) || file.webkitRelativePath === record.modelPath);
  return { model: metadata(record), files: selectedFiles, capabilities };
}

/** Old imports are inspected lazily; new imports already contain a versioned capability inventory. */
export async function getLive2DModelCapabilities(id: string): Promise<Live2DCapabilities | null> {
  const record = await transact<StoredRecord | undefined>('readonly', (store, setResult) => {
    const request = store.get(id);
    request.onsuccess = () => setResult(request.result as StoredRecord | undefined);
  });
  if (!record) return null;
  if (record.capabilities?.version === CAPABILITY_VERSION) return record.capabilities;
  const cached = capabilityCache.get(id);
  if (cached?.version === CAPABILITY_VERSION) return cached;
  const { capabilities } = await importLive2DZip(record.zip, record.modelPath);
  capabilityCache.set(id, capabilities);
  return capabilities;
}

export async function removeLive2DModel(id: string): Promise<void> {
  await transact<void>('readwrite', (store, setResult) => {
    store.delete(id);
    setResult(undefined);
  });
  capabilityCache.delete(id);
}
