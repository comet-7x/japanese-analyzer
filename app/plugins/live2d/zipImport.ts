import { unzip, unzipSync, type UnzipFileInfo } from 'fflate';
import { capabilitiesFromManifest, type Live2DCapabilities } from './capabilities';

export const LIVE2D_ZIP_LIMITS = {
  compressedBytes: 32 * 1024 * 1024,
  expandedBytes: 128 * 1024 * 1024,
  entryBytes: 32 * 1024 * 1024,
  entryCount: 256,
  manifestBytes: 2 * 1024 * 1024,
} as const;

export type Live2DZipErrorCode =
  | 'archive_too_large' | 'archive_invalid' | 'entry_limit' | 'entry_too_large'
  | 'expanded_too_large' | 'invalid_path' | 'duplicate_entry'
  | 'model_missing' | 'multiple_models' | 'model_not_found'
  | 'invalid_model' | 'asset_missing' | 'unsupported_format';

export class Live2DZipError extends Error {
  constructor(
    readonly code: Live2DZipErrorCode,
    message: string,
    readonly modelPaths: string[] = [],
  ) {
    super(message);
    this.name = 'Live2DZipError';
  }
}

export interface ImportedLive2DZip {
  modelPath: string;
  modelPaths: string[];
  files: File[];
  capabilities: Live2DCapabilities;
}

function cleanPath(path: string): string {
  if (!path || /[\\\u0000-\u001f\u007f?#%:]/u.test(path) || path.startsWith('/')) {
    throw new Live2DZipError('invalid_path', `模型包含无效路径：${path}`);
  }
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' ||
    part === '__proto__' || part === 'constructor' || part === 'prototype')) {
    throw new Live2DZipError('invalid_path', `模型包含无效路径：${path}`);
  }
  return parts.join('/');
}

function relativeAssetPath(modelPath: string, reference: string): string {
  const path = cleanPath(reference);
  const modelDirectory = modelPath.slice(0, modelPath.lastIndexOf('/') + 1);
  return `${modelDirectory}${path}`;
}

function inspectEntries(bytes: Uint8Array): { paths: string[]; modelPaths: string[] } {
  const paths: string[] = [];
  const seen = new Set<string>();
  let expandedBytes = 0;
  try {
    // The filter walks the ZIP central directory without allocating expanded files.
    unzipSync(bytes, { filter: (entry: UnzipFileInfo) => {
      const directory = entry.name.endsWith('/');
      const path = cleanPath(directory ? entry.name.slice(0, -1) : entry.name);
      if (seen.has(path)) throw new Live2DZipError('duplicate_entry', `模型包含重复文件：${path}`);
      seen.add(path);
      if (seen.size > LIVE2D_ZIP_LIMITS.entryCount) {
        throw new Live2DZipError('entry_limit', '模型 ZIP 的文件数量过多。');
      }
      if (directory) return false;
      if (entry.compression !== 0 && entry.compression !== 8) {
        throw new Live2DZipError('unsupported_format', `不支持的 ZIP 压缩方式：${path}`);
      }
      if (entry.compression === 0 && entry.size !== entry.originalSize) {
        throw new Live2DZipError('archive_invalid', `模型 ZIP 的文件大小不一致：${path}`);
      }
      if (entry.originalSize > LIVE2D_ZIP_LIMITS.entryBytes) {
        throw new Live2DZipError('entry_too_large', `模型文件过大：${path}`);
      }
      expandedBytes += entry.originalSize;
      if (expandedBytes > LIVE2D_ZIP_LIMITS.expandedBytes) {
        throw new Live2DZipError('expanded_too_large', '模型 ZIP 解压后的总体积过大。');
      }
      paths.push(path);
      return false;
    } });
  } catch (error) {
    if (error instanceof Live2DZipError) throw error;
    throw new Live2DZipError('archive_invalid', '模型 ZIP 无法读取或已损坏。');
  }
  const modelPaths = paths.filter(path => path.toLowerCase().endsWith('.model3.json'));
  if (!modelPaths.length) throw new Live2DZipError('model_missing', 'ZIP 中没有 Cubism 3/4/5 的 .model3.json 文件。');
  return { paths, modelPaths };
}

function fileReferences(manifest: unknown, modelPath: string): string[] {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Live2DZipError('invalid_model', `模型配置不是对象：${modelPath}`);
  }
  const refs = (manifest as { FileReferences?: unknown }).FileReferences;
  if (!refs || typeof refs !== 'object' || Array.isArray(refs)) {
    throw new Live2DZipError('invalid_model', `模型缺少 FileReferences：${modelPath}`);
  }
  const data = refs as Record<string, unknown>;
  if (typeof data.Moc !== 'string' || !data.Moc.toLowerCase().endsWith('.moc3') ||
    !Array.isArray(data.Textures) || !data.Textures.length || !data.Textures.every(value => typeof value === 'string')) {
    throw new Live2DZipError('invalid_model', `模型缺少有效的 Moc 或纹理引用：${modelPath}`);
  }
  const referenced: string[] = [data.Moc, ...(data.Textures as string[])];
  for (const key of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) {
    const value = data[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Live2DZipError('invalid_model', `模型 ${key} 引用无效：${modelPath}`);
    if (value) referenced.push(value);
  }
  if (data.Expressions !== undefined) {
    if (!Array.isArray(data.Expressions)) throw new Live2DZipError('invalid_model', `模型表情列表无效：${modelPath}`);
    for (const item of data.Expressions) {
      if (!item || typeof item.File !== 'string') throw new Live2DZipError('invalid_model', `模型表情引用无效：${modelPath}`);
      referenced.push(item.File);
    }
  }
  if (data.Motions !== undefined) {
    if (!data.Motions || typeof data.Motions !== 'object' || Array.isArray(data.Motions)) {
      throw new Live2DZipError('invalid_model', `模型动作列表无效：${modelPath}`);
    }
    for (const motions of Object.values(data.Motions)) {
      if (!Array.isArray(motions)) throw new Live2DZipError('invalid_model', `模型动作列表无效：${modelPath}`);
      for (const motion of motions) {
        if (!motion || typeof motion.File !== 'string') throw new Live2DZipError('invalid_model', `模型动作引用无效：${modelPath}`);
        referenced.push(motion.File);
        if (motion.Sound !== undefined) {
          if (typeof motion.Sound !== 'string') throw new Live2DZipError('invalid_model', `模型音效引用无效：${modelPath}`);
          if (motion.Sound) referenced.push(motion.Sound);
        }
      }
    }
  }
  return referenced.map(path => relativeAssetPath(modelPath, path));
}

function extract(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    try {
      unzip(bytes, { filter: entry => !entry.name.endsWith('/') }, (error, files) => {
        if (error || !files) reject(new Live2DZipError('archive_invalid', '模型 ZIP 无法解压或已损坏。'));
        else resolve(files);
      });
    } catch {
      reject(new Live2DZipError('archive_invalid', '模型 ZIP 无法解压或已损坏。'));
    }
  });
}

function mimeType(path: string): string {
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.json$/i.test(path)) return 'application/json';
  return 'application/octet-stream';
}

/** Validate a local Cubism 3+ ZIP and return files for a Live2D file loader. */
export async function importLive2DZip(file: Blob, selectedModelPath?: string): Promise<ImportedLive2DZip> {
  if (file.size > LIVE2D_ZIP_LIMITS.compressedBytes) {
    throw new Live2DZipError('archive_too_large', '模型 ZIP 超过 32 MB。');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { paths, modelPaths } = inspectEntries(bytes);
  if (selectedModelPath && !modelPaths.includes(selectedModelPath)) {
    throw new Live2DZipError('model_not_found', `ZIP 中没有模型：${selectedModelPath}`, modelPaths);
  }
  if (!selectedModelPath && modelPaths.length > 1) {
    throw new Live2DZipError('multiple_models', 'ZIP 包含多个模型，请选择要导入的模型。', modelPaths);
  }
  const modelPath = selectedModelPath ?? modelPaths[0];
  const entries = await extract(bytes);
  const modelBytes = entries[modelPath];
  if (!modelBytes || modelBytes.length > LIVE2D_ZIP_LIMITS.manifestBytes) {
    throw new Live2DZipError('invalid_model', `模型配置缺失或过大：${modelPath}`);
  }
  let manifest: unknown;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(modelBytes)); }
  catch { throw new Live2DZipError('invalid_model', `模型配置不是有效 JSON：${modelPath}`); }
  const present = new Set(paths);
  for (const reference of fileReferences(manifest, modelPath)) {
    if (!present.has(reference)) throw new Live2DZipError('asset_missing', `模型缺少资源：${reference}`);
  }
  const files = paths.map(path => {
    const content = entries[path];
    if (!content) throw new Live2DZipError('archive_invalid', `模型 ZIP 缺少文件：${path}`);
    const result = new File([Uint8Array.from(content)], path.slice(path.lastIndexOf('/') + 1), { type: mimeType(path) });
    Object.defineProperty(result, 'webkitRelativePath', { value: path, configurable: false });
    return result;
  });
  return { modelPath, modelPaths, files, capabilities: capabilitiesFromManifest(manifest) };
}
