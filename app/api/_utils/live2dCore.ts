import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const APP_IDENTIFIER = 'ink.howen.japanese-analyzer';

export interface CoreSpec {
  filename: string;
  url: string;
  bytes: number;
  sha256: string;
  sdkVersion: string;
  coreSeries: string;
  downloadPage: string;
  licenseUrls: readonly string[];
}

// Pinned, verified Cubism Core. Keep in sync with live2d-core.lock.json (guarded
// by tests/live2dCore.test.ts). The lock file is not copied into the packaged
// server, so the runtime route embeds the same pin instead of reading it.
export const LIVE2D_CORE: CoreSpec = {
  filename: 'live2dcubismcore.min.js',
  url: 'https://cubism.live2d.com/sdk-web/core/05/live2dcubismcore.min.js',
  bytes: 207155,
  sha256: '25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f',
  sdkVersion: '5-r.4',
  coreSeries: '5.2',
  downloadPage: 'https://www.live2d.com/en/sdk/download/web/',
  licenseUrls: [
    'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
    'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html',
  ],
};

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

// The per-user data dir must be derived from ENVIRONMENT VARIABLES ONLY, never
// os.homedir(). Next's standalone file tracer (nft) constant-folds os.homedir()
// to the literal user profile and treats the result as a bundle asset — it then
// copies the ENTIRE profile (AppData, Documents, …) into the install, and hard-
// fails the build when the profile contains an unreadable reparse point (e.g.
// the localized Start Menu folder on some machines). process.env.* values are
// not folded, so this stays runtime-only.
//
// The base mirrors Tauri's app_data_dir() per platform: %APPDATA% (Windows),
// ~/Library/Application Support (macOS), and $XDG_DATA_HOME or ~/.local/share
// (Linux). The Linux branch is the XDG *data* dir, not the config dir, so a
// Rust-side reader of app_data_dir() resolves the same location.
const envValue = (name: string): string | undefined => process.env[name];

/** Per-user, writable-at-runtime directory (mirrors Tauri's app_data_dir). */
export function coreDataDir(): string {
  const base =
    process.platform === 'win32'
      ? envValue('APPDATA')
      : process.platform === 'darwin'
        ? envValue('HOME')
          ? join(envValue('HOME')!, 'Library', 'Application Support')
          : undefined
        : envValue('XDG_DATA_HOME') ?? (envValue('HOME') ? join(envValue('HOME')!, '.local', 'share') : undefined);
  if (!base) throw new Error('无法定位当前用户的配置目录。');
  return join(base, APP_IDENTIFIER, 'live2d-core');
}


/** Where an in-app install is written (a test may pass a sandbox dir as root). */
export function coreRuntimePath(root?: string, spec: CoreSpec = LIVE2D_CORE): string {
  return root ? join(root, spec.filename) : join(coreDataDir(), spec.filename);
}

/** The build-time baked copy, present only when the Core was prepared for a build. */
export function coreStaticPath(spec: CoreSpec = LIVE2D_CORE): string {
  return join(process.cwd(), 'public', 'live2d', 'core', spec.filename);
}

export interface CoreStatus {
  installed: boolean;
  sdkVersion: string;
  coreSeries: string;
  sha256: string;
  bytes: number;
}

function expectedStatus(spec: CoreSpec): CoreStatus {
  return { installed: false, sdkVersion: spec.sdkVersion, coreSeries: spec.coreSeries, sha256: spec.sha256, bytes: spec.bytes };
}

async function verifiedCoreFile(path: string, spec: CoreSpec): Promise<Uint8Array | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== spec.bytes) return null;
    const data = new Uint8Array(await readFile(path));
    return data.length === spec.bytes && sha256(data) === spec.sha256 ? data : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Resolve the verified Core from the runtime install first, then the baked copy. */
export async function resolveCore(root?: string, spec: CoreSpec = LIVE2D_CORE): Promise<{ data: Uint8Array; source: 'runtime' | 'static' } | null> {
  for (const [source, path] of [['runtime', coreRuntimePath(root, spec)], ['static', coreStaticPath(spec)]] as const) {
    const data = await verifiedCoreFile(path, spec);
    if (data) return { data, source };
  }
  return null;
}

export async function getCoreStatus(root?: string, spec: CoreSpec = LIVE2D_CORE): Promise<CoreStatus> {
  return { ...expectedStatus(spec), installed: (await resolveCore(root, spec)) !== null };
}

async function atomicWrite(path: string, data: Uint8Array) {
  await mkdir(join(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Thrown with a zh-CN i18n key as the message plus the HTTP status to return. */
export class CoreInstallError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface InstallCoreOptions {
  mode: 'download' | 'import';
  acceptLicense?: boolean;
  content?: string;
  fetchImpl?: typeof fetch;
  root?: string;
}

async function downloadCore(spec: CoreSpec, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const response = await fetchImpl(spec.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
    headers: { 'User-Agent': 'Japanese-Analyzer-Core-Prepare', Referer: spec.downloadPage },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > spec.bytes) { await reader.cancel().catch(() => undefined); throw new Error('oversized response'); }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  if (data.length !== spec.bytes || sha256(data) !== spec.sha256) throw new Error('SHA-256 or byte length mismatch');
  return data;
}

/** Download or import the pinned Core, verify it, and install it atomically. */
export async function installCore(options: InstallCoreOptions, spec: CoreSpec = LIVE2D_CORE): Promise<CoreStatus> {
  if (!options.acceptLicense) {
    throw new CoreInstallError('Cubism Core 安装需要同意软件许可。', 400);
  }
  let data: Uint8Array;
  if (options.mode === 'import') {
    if (typeof options.content !== 'string') throw new CoreInstallError('Cubism Core 安装参数无效。', 400);
    data = new TextEncoder().encode(options.content);
    if (data.length !== spec.bytes || sha256(data) !== spec.sha256) {
      throw new CoreInstallError('导入的文件与官方 Cubism Core 不一致，请从官方源重新下载。', 400);
    }
  } else {
    try {
      data = await downloadCore(spec, options.fetchImpl ?? fetch);
    } catch {
      throw new CoreInstallError('Cubism Core 下载或校验失败，请重试或改用离线导入。', 502);
    }
  }
  const path = coreRuntimePath(options.root, spec);
  await atomicWrite(path, data);
  if (!await verifiedCoreFile(path, spec)) throw new CoreInstallError('Cubism Core 安装失败。', 500);
  return { ...expectedStatus(spec), installed: true };
}
