import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { importLive2DZip, Live2DZipError } from '../app/plugins/live2d/zipImport';
import { getLive2DModelCapabilities, getLive2DModelFiles, importLive2DModel, listLive2DModels, removeLive2DModel } from '../app/plugins/live2d/modelLibrary';

const manifest = (moc = 'model.moc3') => JSON.stringify({
  Version: 3,
  FileReferences: {
    Moc: moc,
    Textures: ['texture.png'],
    Physics: 'physics3.json',
    Expressions: [{ Name: 'smile', File: 'expressions/smile.exp3.json' }],
    Motions: { Idle: [{ File: 'motions/idle.motion3.json', Sound: 'sounds/idle.wav' }] },
  },
});

function archive(extra: Record<string, Uint8Array> = {}, model = manifest()): File {
  const entries = {
    'hiyori/hiyori.model3.json': strToU8(model),
    'hiyori/model.moc3': new Uint8Array([1, 2, 3]),
    'hiyori/texture.png': new Uint8Array([4, 5, 6]),
    'hiyori/physics3.json': strToU8('{}'),
    'hiyori/expressions/smile.exp3.json': strToU8('{}'),
    'hiyori/motions/idle.motion3.json': strToU8('{}'),
    'hiyori/sounds/idle.wav': new Uint8Array([7, 8]),
    ...extra,
  };
  return new File([Uint8Array.from(zipSync(entries))], 'hiyori.zip', { type: 'application/zip' });
}

async function rejectsCode(file: Blob, code: Live2DZipError['code'], path?: string) {
  await assert.rejects(importLive2DZip(file, path), error => {
    assert.ok(error instanceof Live2DZipError);
    assert.equal(error.code, code);
    return true;
  });
}

function installFakeIndexedDB(seed: Array<{ id: string; [key: string]: unknown }> = []): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const rows = new Map<string, unknown>(seed.map(row => [row.id, row]));
  let created = false;
  const database = {
    objectStoreNames: { contains: () => created },
    createObjectStore: () => { created = true; },
    close() {},
    onversionchange: null,
    transaction() {
      const transaction = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore() {
          const complete = () => queueMicrotask(() => transaction.oncomplete?.());
          return {
            put(value: { id: string }) { rows.set(value.id, value); complete(); },
            delete(id: string) { rows.delete(id); complete(); },
            get(id: string) {
              const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
              queueMicrotask(() => { request.result = rows.get(id); request.onsuccess?.(); complete(); });
              return request;
            },
            getAll() {
              const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
              queueMicrotask(() => { request.result = [...rows.values()]; request.onsuccess?.(); complete(); });
              return request;
            },
          };
        },
      };
      return transaction;
    },
  };
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open() {
      const request = {
        result: database,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      };
      queueMicrotask(() => { if (!created) request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  } });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  };
}

async function main() {
  const source = archive();
  const imported = await importLive2DZip(source);
  assert.equal(imported.modelPath, 'hiyori/hiyori.model3.json');
  assert.equal(imported.files.length, 7);
  assert.deepEqual(imported.files.map(file => file.webkitRelativePath), [
    'hiyori/hiyori.model3.json', 'hiyori/model.moc3', 'hiyori/texture.png',
    'hiyori/physics3.json', 'hiyori/expressions/smile.exp3.json',
    'hiyori/motions/idle.motion3.json', 'hiyori/sounds/idle.wav',
  ]);
  assert.equal(imported.files[2].type, 'image/png');
  assert.deepEqual(new Uint8Array(await imported.files[1].arrayBuffer()), new Uint8Array([1, 2, 3]));

  await rejectsCode(archive({}, manifest('https://example.com/model.moc3')), 'invalid_path');
  await rejectsCode(archive({}, manifest('../model.moc3')), 'invalid_path');
  await rejectsCode(archive({}, manifest('absent.moc3')), 'asset_missing');
  await rejectsCode(new File([Uint8Array.from(zipSync({ 'model.model3.json': strToU8('{}') }))], 'empty.zip'), 'invalid_model');
  await rejectsCode(new File([Uint8Array.from(zipSync({ 'hiyori/../escape.model3.json': strToU8(manifest()) }))], 'bad.zip'), 'invalid_path');
  await rejectsCode(new File([new Uint8Array([1, 2, 3])], 'bad.zip'), 'archive_invalid');
  const manyFiles = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`files/${i}.txt`, new Uint8Array([1])])) as Record<string, Uint8Array>;
  await rejectsCode(new File([Uint8Array.from(zipSync(manyFiles))], 'many.zip'), 'entry_limit');

  const multiple = archive({ 'other/other.model3.json': strToU8(manifest()) });
  await assert.rejects(importLive2DZip(multiple), error => {
    assert.ok(error instanceof Live2DZipError);
    assert.equal(error.code, 'multiple_models');
    assert.deepEqual(error.modelPaths, ['hiyori/hiyori.model3.json', 'other/other.model3.json']);
    return true;
  });
  assert.equal((await importLive2DZip(multiple, 'hiyori/hiyori.model3.json')).modelPath, 'hiyori/hiyori.model3.json');
  await rejectsCode(multiple, 'model_not_found', 'unknown.model3.json');

  const restore = installFakeIndexedDB();
  try {
    const saved = await importLive2DModel(source, { name: '  小春  ' });
    assert.equal(saved.name, '小春');
    assert.equal(saved.byteLength, source.size);
    assert.deepEqual(await listLive2DModels(), [saved]);
    const loaded = await getLive2DModelFiles(saved.id);
    assert.deepEqual(loaded?.model, saved);
    assert.equal(loaded?.files[0].webkitRelativePath, saved.modelPath);
    assert.deepEqual(await getLive2DModelCapabilities(saved.id), loaded?.capabilities);
    assert.equal(loaded?.capabilities.moods.success.expression, 'smile');
    const multiSameFolder = archive({ 'hiyori/alternate.model3.json': strToU8(manifest()) });
    const alternate = await importLive2DModel(multiSameFolder, { modelPath: 'hiyori/alternate.model3.json' });
    const alternateFiles = (await getLive2DModelFiles(alternate.id))?.files ?? [];
    assert.deepEqual(
      alternateFiles.filter(file => file.name.endsWith('.model3.json')).map(file => file.webkitRelativePath),
      ['hiyori/alternate.model3.json'],
    );
    await removeLive2DModel(alternate.id);
    await removeLive2DModel(saved.id);
    assert.deepEqual(await listLive2DModels(), []);
    assert.equal(await getLive2DModelFiles(saved.id), null);
    assert.equal(await getLive2DModelCapabilities(saved.id), null, 'deletion cannot return a cached capability report');
  } finally { restore(); }
  const restoreLegacy = installFakeIndexedDB([{ id: 'legacy-import', name: '旧角色', modelPath: imported.modelPath, zip: source, importedAt: 0, byteLength: source.size }]);
  try {
    const report = await getLive2DModelCapabilities('legacy-import');
    assert.equal(report?.idle, 'Idle');
    assert.equal(report?.moods.success.expression, 'smile', 'old imports are discovered without reimporting');
    assert.deepEqual(await getLive2DModelCapabilities('legacy-import'), report);
  } finally { restoreLegacy(); }
  console.log('Live2D model ZIP validation and local model persistence passed.');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
