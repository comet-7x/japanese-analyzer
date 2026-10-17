// Optional developer rebuild. Normal web/desktop builds use the checked-in,
// checksummed WASM and do not need a Rust toolchain or Python runtime.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const lock = JSON.parse(await readFile(join(root, 'local-analyzer.lock.json'), 'utf8'));
const cache = join(root, '.codex-dev/sudachi-web');
const sha = data => createHash('sha256').update(data).digest('hex');
await mkdir(cache, { recursive: true });
const archive = join(cache, 'source.tar.gz');
let bytes = await readFile(archive).catch(() => null);
if (!bytes || sha(bytes) !== lock.engine.sourceSha256) {
  const response = await fetch(lock.engine.sourceUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error('Sudachi source download failed');
  bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== lock.engine.sourceSha256) throw new Error('Sudachi source checksum mismatch');
  await writeFile(archive, bytes);
}
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/tar.exe') : 'tar';
// Re-extract only the pinned, verified upstream archive into its dedicated cache.
run(tar, ['-xzf', archive, '-C', cache]);
const source = join(cache, 'sudachi.rs-0.7.0/sudachi/src');
async function patch(name, from, to) {
  const path = join(source, name); const text = await readFile(path, 'utf8');
  if (text.split(from).length !== 2) throw new Error(`Sudachi portability patch no longer applies: ${name}`);
  await writeFile(path, text.replace(from, to));
}
// Portability only: no tokenizer, dictionary, normalization or plugin algorithms change.
await patch('dic.rs', 'pub mod build;', '#[cfg(not(target_arch = "wasm32"))]\npub mod build;');
await patch('error.rs', 'use crate::dic::build::error::DicBuildError;', '#[cfg(not(target_arch = "wasm32"))]\nuse crate::dic::build::error::DicBuildError;');
await patch('error.rs', '    #[error(transparent)]\n    DictionaryCompilationError', '    #[cfg(not(target_arch = "wasm32"))]\n    #[error(transparent)]\n    DictionaryCompilationError');
await patch('plugin/loader.rs', 'target_os = "visionos"\n', 'target_os = "visionos",\n    target_arch = "wasm32"\n');
await patch('util/fxhash.rs', 'const SEED32: u32 = 0x9e_37_79_b9;', 'const SEED32: u32 = 0x9e_37_79_b9;\n\n#[cfg(target_pointer_width = "32")]\nconst SEED: usize = SEED32 as usize;');
run('cargo', ['build', '--manifest-path', 'crates/sudachi-web/Cargo.toml', '--target', 'wasm32-unknown-unknown', '--release', '--locked']);
const bindgen = process.env.SUDACHI_WASM_BINDGEN ?? 'wasm-bindgen';
const version = spawnSync(bindgen, ['--version'], { encoding: 'utf8' });
if (!version.stdout?.includes(` ${lock.engine.wasmBindgen}`)) throw new Error(`Install wasm-bindgen-cli ${lock.engine.wasmBindgen} or set SUDACHI_WASM_BINDGEN`);
run(bindgen, ['crates/sudachi-web/target/wasm32-unknown-unknown/release/japanese_analyzer_sudachi_web.wasm', '--target', 'web', '--out-name', 'sudachi', '--out-dir', 'public/local-analyzer/sudachi-0.7.0']);
if (process.argv.includes('--update-lock')) {
  for (const name of Object.keys(lock.engine.assets)) lock.engine.assets[name] = sha(await readFile(join(root, 'public/local-analyzer/sudachi-0.7.0', name)));
  await writeFile(join(root, 'local-analyzer.lock.json'), JSON.stringify(lock, null, 2) + '\n');
} else {
  for (const [name, hash] of Object.entries(lock.engine.assets)) if (sha(await readFile(join(root, 'public/local-analyzer/sudachi-0.7.0', name))) !== hash) throw new Error('Rebuilt binary differs. Review and explicitly use --update-lock to accept the new build.');
}
await import('./notices.mjs');
