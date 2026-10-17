import { zipEntry } from './archive.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sha = data => createHash('sha256').update(data).digest('hex');

export async function prepare() {
  const lock = JSON.parse(await readFile(join(root, 'local-analyzer.lock.json'), 'utf8'));
  for (const [name, hash] of Object.entries(lock.engine.assets)) {
    if (sha(await readFile(join(root, 'public/local-analyzer/sudachi-0.7.0', name))) !== hash) throw new Error('Sudachi engine checksum mismatch');
  }
  const target = join(root, 'data/local-analyzer');
  const manifestPath = join(root, 'app/lib/localAnalyzerManifest.json');
  const existingText = await readFile(manifestPath, 'utf8').catch(() => '');
  const existing = existingText ? JSON.parse(existingText) : null;
  let valid = sha(existingText) === lock.dictionary.manifestSha256 && existing?.id === lock.id && existing?.rawSha256 === lock.dictionary.rawSha256 && existing?.chunks?.length > 0;
  if (valid) for (const chunk of existing.chunks) {
    const data = await readFile(join(target, `${chunk.sha256}.deflate`)).catch(() => null);
    if (!data || data.length !== chunk.bytes || sha(data) !== chunk.sha256) { valid = false; break; }
  }
  if (!valid) {
    const cache = join(root, '.codex-dev/sudachi-web');
    await mkdir(cache, { recursive: true });
    const path = join(cache, 'core.whl');
    let archive = await readFile(path).catch(() => null);
    if (!archive || sha(archive) !== lock.dictionary.archiveSha256) {
      const response = await fetch(lock.dictionary.url, { signal: AbortSignal.timeout(300_000) });
      if (!response.ok) throw new Error('Sudachi dictionary download failed');
      archive = Buffer.from(await response.arrayBuffer());
      if (archive.length !== lock.dictionary.archiveBytes || sha(archive) !== lock.dictionary.archiveSha256) throw new Error('Sudachi archive checksum mismatch');
      await writeFile(path, archive);
    }
    const compressed = zipEntry(archive, lock.dictionary.entry, lock.dictionary.rawBytes);
    const raw = inflateRawSync(compressed, { maxOutputLength: lock.dictionary.rawBytes });
    if (raw.length !== lock.dictionary.rawBytes || sha(raw) !== lock.dictionary.rawSha256) throw new Error('Sudachi dictionary checksum mismatch');
    const chunks = [];
    await mkdir(target, { recursive: true });
    for (let offset = 0; offset < compressed.length; offset += lock.dictionary.chunkBytes) {
      const part = compressed.subarray(offset, offset + lock.dictionary.chunkBytes);
      const hash = sha(part);
      await writeFile(join(target, `${hash}.deflate`), part);
      chunks.push({ sha256: hash, bytes: part.length });
    }
    const manifest = { id: lock.id, rawBytes: raw.length, rawSha256: lock.dictionary.rawSha256, compressedBytes: compressed.length, chunks };
    // Checked-in public metadata is deterministic. A dependency upgrade requires
    // reviewing this manifest and the pinned archive, never a floating download.
    const serialized = JSON.stringify(manifest, null, 2) + '\n';
    if (sha(serialized) !== lock.dictionary.manifestSha256) throw new Error('Generated Sudachi manifest differs from the pinned manifest');
    await writeFile(manifestPath, serialized);
  }
  const require = createRequire(import.meta.url);
  const tsxRequire = createRequire(require.resolve('tsx/package.json'));
  const { build } = tsxRequire('esbuild');
  await build({ entryPoints: [join(root, 'app/workers/localAnalyzer.worker.ts')], outfile: join(root, 'public/local-analyzer/worker.js'),
    bundle: true, minify: true, format: 'esm', platform: 'browser', target: ['es2022'], legalComments: 'eof' });
  console.log('Sudachi browser engine and dictionary verified; worker prepared.');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await prepare();
