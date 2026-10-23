import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const downloadPage = 'https://www.live2d.com/en/sdk/download/web/';
export const licenseUrls = [
  'https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
  'https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html',
];
const filename = 'live2dcubismcore.min.js';
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function validateLock(lock) {
  const url = new URL(lock.url);
  if (lock.schemaVersion !== 1 || !/^5-r\.\d+$/.test(lock.sdkVersion)
    || !/^5\.\d+$/.test(lock.coreSeries)
    || !Number.isSafeInteger(lock.bytes) || lock.bytes < 1 || lock.bytes > 4 * 1024 * 1024
    || !/^[a-f0-9]{64}$/.test(lock.sha256)
    || url.protocol !== 'https:' || url.hostname !== 'cubism.live2d.com'
    || url.port || url.username || url.password || url.search || url.hash
    || !/^\/sdk-web\/core\/\d{2}\/live2dcubismcore\.min\.js$/.test(url.pathname)
    || lock.downloadPage !== downloadPage || JSON.stringify(lock.licenseUrls) !== JSON.stringify(licenseUrls)) {
    throw new Error('Invalid live2d-core.lock.json: use a reviewed official version and SHA-256; floating Latest URLs are not supported.');
  }
  return lock;
}

async function verifiedFile(path, lock) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size !== lock.bytes) return null;
    const data = await readFile(path);
    return sha256(data) === lock.sha256 ? data : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function downloadCore(lock, fetchImpl) {
  try {
    const response = await fetchImpl(lock.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: { 'User-Agent': 'Japanese-Analyzer-Core-Prepare', Referer: downloadPage },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > lock.bytes) throw new Error('download exceeds the pinned byte length');
      chunks.push(Buffer.from(chunk));
    }
    const data = Buffer.concat(chunks);
    if (data.length !== lock.bytes || sha256(data) !== lock.sha256) {
      throw new Error('SHA-256 or byte length mismatch; the official content may have changed');
    }
    return data;
  } catch (error) {
    throw new Error(
      `Cubism Core download failed: ${error.message}. No unverified file was installed.\n`
      + `Obtain SDK ${lock.sdkVersion} from ${downloadPage}, then use --source <path/to/${filename}>.\n`
      + 'Do not bypass verification or replace the pinned hash without reviewing the SDK update.',
      { cause: error },
    );
  }
}

/** Prepare only the runtime Core, without executing it or downloading sample models. */
export async function prepareCore({ root = projectRoot, acceptLicense = false, sourcePath, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const lock = validateLock(JSON.parse(await readFile(join(root, 'live2d-core.lock.json'), 'utf8')));
  const target = join(root, 'public/live2d/core', filename);
  const cache = join(root, '.desktop-cache/live2d-core', lock.sha256, filename);
  let data;
  let source;
  if (sourcePath) {
    data = await verifiedFile(resolve(sourcePath), lock);
    if (!data) throw new Error(`Local Core does not match the pinned SDK ${lock.sdkVersion} byte length and SHA-256: ${sourcePath}`);
    source = 'local source';
  } else {
    data = await verifiedFile(target, lock);
    if (data) source = 'installed file';
    else {
      data = await verifiedFile(cache, lock);
      if (data) source = 'verified cache';
    }
  }
  if (!data) {
    if (!acceptLicense) {
      throw new Error(
        'A verified Cubism Core file is missing. Before downloading, read and agree to the Live2D software licenses:\n'
        + `${licenseUrls.join('\n')}\n`
        + 'Then pass --accept-license or set LIVE2D_ACCEPT_LICENSE=1, or supply an already obtained file with --source <path>.\n'
        + 'This acknowledges the software terms; it does not grant a Publication License.',
      );
    }
    log(`Downloading Cubism Core ${lock.coreSeries} (SDK ${lock.sdkVersion}) from the official host…`);
    data = await downloadCore(lock, fetchImpl);
    source = 'official download';
  }
  // Verify every reuse, including offline caches; replace files only with verified data.
  if (!await verifiedFile(cache, lock)) await atomicWrite(cache, data);
  if (!await verifiedFile(target, lock)) await atomicWrite(target, data);
  log(`Cubism Core ready (${source}); SHA-256 ${lock.sha256}.`);
  return { target, cache, source, sha256: lock.sha256 };
}

export function parseOptions(args, env = process.env) {
  const options = { acceptLicense: env.LIVE2D_ACCEPT_LICENSE === '1', sourcePath: env.LIVE2D_CORE_PATH || undefined, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--accept-license') options.acceptLicense = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--source') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('--source requires a local Core file path.');
      options.sourcePath = args[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export const help = `Prepare the pinned Live2D Cubism Core (not the complete SDK or character models).
Usage: npm run live2d:prepare -- [--accept-license] [--source <local Core file>]
  --accept-license            Confirm you have read and agree to the software terms before download.
  --source <file>              Install an already obtained, matching Core file (offline).
  LIVE2D_ACCEPT_LICENSE=1      Equivalent explicit confirmation for CI.
  LIVE2D_CORE_PATH             Equivalent local file path.
Verified installed files and caches are reused without network access.
Software terms: ${licenseUrls.join('\n                ')}
Publication licensing is separate: https://www.live2d.com/en/sdk/license/`;

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log(help);
    else await prepareCore(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
