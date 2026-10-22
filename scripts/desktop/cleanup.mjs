import { execFile } from 'node:child_process';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { root as projectRoot } from './common.mjs';

// Only disposable directories created by this project's verification workflow.
// Do not expand this to all gitignored files or to ~/Library application data.
export const VERIFICATION_RUNS = ['live2d-final-verification', 'live2d-followup', 'system-language-verification'];
const DAY = 86_400_000;
const execute = promisify(execFile);
const inside = (parent, child) => { const part = relative(parent, child); return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)); };
const metadata = path => lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

export async function runningExecutables() {
  const { stdout } = process.platform === 'win32'
    ? await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { $_.ExecutablePath }'], { maxBuffer: 8 * 1024 * 1024 })
    : await execute('ps', ['-axo', 'comm='], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

async function safeDirectory(root, path) {
  const base = await realpath(root);
  const target = resolve(path);
  if (target === resolve(root) || !inside(resolve(root), target)) return false;
  // Never traverse a symlink in any parent, even one pointing back into the repo.
  let current = resolve(root);
  for (const part of relative(current, target).split(sep)) {
    current = join(current, part);
    const stat = await metadata(current);
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return false;
  }
  return inside(base, await realpath(target));
}

async function entries(root, path) {
  return await safeDirectory(root, path) ? readdir(path, { withFileTypes: true }) : [];
}

export async function directoryBytes(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await directoryBytes(join(path, entry));
  return total;
}

function busy(path, processes, buildCache) {
  return processes.some(executable => inside(path, resolve(executable))
    || (buildCache && /^(cargo|rustc|tauri)(\.exe)?$/.test(basename(executable))));
}

export async function planCleanup({ root = projectRoot, automatic = false, buildCache = false, now = Date.now(), processes = [] } = {}) {
  if (automatic && buildCache) throw new Error('Automatic cleanup never removes build caches.');
  const cache = join(root, '.desktop-cache');
  const apps = [];
  for (const name of VERIFICATION_RUNS) {
    const folder = join(cache, name);
    for (const entry of await entries(root, folder)) {
      const path = join(folder, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name.endsWith('.app') && await safeDirectory(root, path)) {
        const stat = await lstat(path);
        apps.push({ path, mtime: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
      }
    }
  }
  const primary = apps.filter(app => basename(app.path) === 'Japanese Analyzer.app').sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))[0];
  const candidates = [], kept = [];
  const consider = async (path, reason, cacheEntry = false) => {
    if (!await safeDirectory(root, path)) return;
    const stat = await lstat(path);
    if (busy(path, processes, cacheEntry)) { kept.push({ path, reason: 'running process or active build' }); return; }
    candidates.push({ path, reason, mtime: stat.mtimeMs, ino: stat.ino, dev: stat.dev, buildCache: cacheEntry });
  };
  for (const app of apps) {
    if (app.path === primary?.path) { kept.push({ path: app.path, reason: 'latest regular application' }); continue; }
    if (automatic && now - app.mtime < 7 * DAY) { kept.push({ path: app.path, reason: 'less than 7 days old' }); continue; }
    await consider(app.path, 'obsolete verification application');
  }
  for (const entry of await entries(root, cache)) {
    const path = join(cache, entry.name);
    // package-server.mjs already removes these in finally; recover crash leftovers.
    if (entry.isDirectory() && !entry.isSymbolicLink() && /^extract-[A-Za-z0-9]+$/.test(entry.name)) {
      const stat = await lstat(path);
      if (now - stat.mtimeMs >= DAY) await consider(path, 'abandoned extraction directory');
    }
    if (buildCache && entry.isDirectory() && /^node-v\d+\.\d+\.\d+-(darwin-(arm64|x64)|win-x64)$/.test(entry.name)) {
      await consider(path, 'redundant extracted Node runtime', true);
    }
  }
  if (buildCache) {
    for (const path of [join(root, 'src-tauri/target'), join(root, 'src-tauri/resources/server')]) await consider(path, 'rebuildable Rust/server output', true);
  }
  return { candidates, kept };
}

export async function cleanup({ root = projectRoot, automatic = false, buildCache = false, apply = false, getProcesses = runningExecutables, log = console.log } = {}) {
  // If process discovery fails, abort instead of deleting potentially active files.
  const plan = await planCleanup({ root, automatic, buildCache, processes: await getProcesses() });
  let bytes = 0, removed = 0;
  for (const item of plan.kept) log(`Keep: ${relative(root, item.path)} (${item.reason})`);
  for (const item of plan.candidates) {
    if (!await safeDirectory(root, item.path)) throw new Error('Cleanup path changed; refusing to continue.');
    const current = await lstat(item.path);
    if (current.ino !== item.ino || current.dev !== item.dev || current.mtimeMs !== item.mtime) throw new Error('Cleanup candidate changed; refusing to continue.');
    const size = await directoryBytes(item.path);
    if (apply) {
      if (busy(item.path, await getProcesses(), item.buildCache)) { log(`Skip: ${relative(root, item.path)} (started running)`); continue; }
      await rm(item.path, { recursive: true, force: false });
      removed++;
    }
    bytes += size;
    log(`${apply ? 'Removed' : 'Would remove'}: ${relative(root, item.path)} (${(size / 1024 / 1024).toFixed(1)} MiB)`);
  }
  log(`${apply ? `Removed ${removed}` : `Preview ${plan.candidates.length}`} items; ${(bytes / 1024 ** 3).toFixed(2)} GiB logical size. Screenshots, logs, archives and application data are retained.`);
  return { ...plan, bytes, removed };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) if (!['--apply', '--auto', '--build-cache'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
  try {
    await cleanup({ apply: args.has('--apply'), automatic: args.has('--auto'), buildCache: args.has('--build-cache') });
  } catch (error) {
    if (!args.has('--auto')) throw error;
    console.warn(`Automatic cleanup skipped: ${error.message}`);
  }
}
