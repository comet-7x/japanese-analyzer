import { spawnSync } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const result = spawnSync('cargo', ['metadata', '--manifest-path', 'crates/sudachi-web/Cargo.toml', '--format-version', '1', '--locked'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (result.status !== 0) throw new Error('Cannot read locked Sudachi WASM dependency metadata');
const packages = JSON.parse(result.stdout).packages.sort((a, b) => a.name.localeCompare(b.name));
const seen = new Set();
const normalizedNotice = value => value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
let text = `Japanese Analyzer local parser\n=============================\n\nSudachi.rs 0.7.0, copyright Works Applications and contributors, Apache-2.0.\nSudachiDict Core 20261015, Apache-2.0 with component notices below.\nThe browser adapter disables dynamic libraries/dictionary building and adds a 32-bit hash constant; tokenizer algorithms and built-in plugins are unchanged.\nWrapper source, dependency lock and rebuild scripts: crates/sudachi-web and scripts/local-analyzer in the application's corresponding source.\nUpstream: https://github.com/WorksApplications/sudachi.rs and https://github.com/WorksApplications/SudachiDict\n\n`;
for (const file of ['LICENSE', 'LICENSES/Sudachi-Apache-2.0.txt', 'LICENSES/SudachiDict-LEGAL', 'LICENSES/fflate-LICENSE.txt']) {
  const content = normalizedNotice(await readFile(file, 'utf8'));
  if (!seen.has(content)) { seen.add(content); text += `\n${file}\n${'='.repeat(40)}\n${content}\n`; }
}
for (const pkg of packages) {
  text += `\n${pkg.name} ${pkg.version} — ${pkg.license ?? 'see upstream license'}\n`;
  const directory = dirname(pkg.manifest_path);
  for (const name of (await readdir(directory)).filter(name => /^(LICENSE|UNLICENSE|COPYING|NOTICE)(\.|-|$)/i.test(name))) {
    const content = normalizedNotice(await readFile(join(directory, name), 'utf8').catch(() => ''));
    if (content && !seen.has(content)) { seen.add(content); text += `\n${name}\n${content}\n`; }
  }
}
await writeFile('LICENSES/Sudachi-WASM-THIRD-PARTY.txt', text);
await writeFile('public/local-analyzer/NOTICE.txt', text);
