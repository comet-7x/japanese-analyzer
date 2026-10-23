import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanup, planCleanup } from '../scripts/desktop/cleanup.mjs';

const DAY = 86_400_000;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-cleanup-test-'));
  const make = async (name, age = 0) => {
    const path = join(root, name); await mkdir(path, { recursive: true }); await writeFile(join(path, 'artifact'), 'rebuildable');
    const time = new Date(Date.now() - age * DAY); await utimes(path, time, time); return path;
  };
  return { root, make };
}
const silent = () => {};
test('dry run preserves everything; applying removes backups but keeps latest app and evidence', async () => {
  const { root, make } = await fixture();
  try {
    const old = await make('.desktop-cache/live2d-final-verification/Japanese Analyzer.app', 20);
    const newest = await make('.desktop-cache/system-language-verification/Japanese Analyzer.app');
    const qa = await make('.desktop-cache/system-language-verification/Japanese Analyzer Language QA.app');
    const evidence = join(root, '.desktop-cache/system-language-verification/screenshot.png'); await writeFile(evidence, 'proof');
    const report = await cleanup({ root, getProcesses: async () => [], log: silent });
    assert.equal(report.removed, 0); await stat(old);
    const applied = await cleanup({ root, apply: true, getProcesses: async () => [], log: silent });
    assert.equal(applied.removed, 2); await assert.rejects(stat(old), { code: 'ENOENT' }); await assert.rejects(stat(qa), { code: 'ENOENT' });
    await stat(newest); assert.equal(await readFile(evidence, 'utf8'), 'proof');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('automatic retention keeps recent apps, latest app and active apps; build caches require explicit opt-in', async () => {
  const { root, make } = await fixture();
  try {
    const active = await make('.desktop-cache/live2d-final-verification/Japanese Analyzer-old.app', 20);
    const stale = await make('.desktop-cache/live2d-followup/Japanese Analyzer-old.app', 20);
    const recent = await make('.desktop-cache/system-language-verification/Japanese Analyzer Language QA.app', 1);
    const target = await make('src-tauri/target');
    const plan = await planCleanup({ root, automatic: true, processes: [join(active, 'Contents/MacOS/app')] });
    assert.deepEqual(plan.candidates.map(item => item.path), [stale]);
    assert.ok(plan.kept.some(item => item.path === recent)); await stat(target);
    const build = await planCleanup({ root, buildCache: true, processes: ['/usr/bin/cargo'] });
    assert.ok(!build.candidates.some(item => item.path === target));
    await assert.rejects(planCleanup({ root, automatic: true, buildCache: true }), /never removes/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('symlinks and unknown directories are not traversed; process lookup failure prevents deletion', async () => {
  const { root, make } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'desktop-cleanup-outside-'));
  try {
    await mkdir(join(root, '.desktop-cache'), { recursive: true });
    await mkdir(join(outside, 'Keep.app')); await writeFile(join(outside, 'Keep.app/private'), 'keep');
    await symlink(outside, join(root, '.desktop-cache/live2d-final-verification'), 'dir');
    const unknown = await make('.desktop-cache/unknown/Keep.app', 20);
    const plan = await planCleanup({ root, buildCache: true });
    assert.equal(plan.candidates.length, 0);
    await assert.rejects(cleanup({ root, apply: true, getProcesses: async () => { throw Error('process lookup failed'); }, log: silent }), /process lookup failed/);
    await stat(unknown); assert.equal(await readFile(join(outside, 'Keep.app/private'), 'utf8'), 'keep');
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
test('a process starting after planning prevents deletion', async () => {
  const { root, make } = await fixture();
  try {
    const path = await make('.desktop-cache/live2d-final-verification/Japanese Analyzer-old.app');
    let calls = 0;
    const result = await cleanup({ root, apply: true, log: silent, getProcesses: async () => ++calls === 1 ? [] : [join(path, 'Contents/MacOS/app')] });
    assert.equal(result.removed, 0); await stat(path);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('only stale extraction directories are cleaned; downloaded archives and fresh work stay', async () => {
  const { root, make } = await fixture();
  try {
    const stale = await make('.desktop-cache/extract-old123', 2);
    const fresh = await make('.desktop-cache/extract-new123');
    const archive = join(root, '.desktop-cache/node-v22.23.3-darwin-arm64.tar.xz'); await writeFile(archive, 'runtime cache');
    const plan = await planCleanup({ root, automatic: true });
    assert.deepEqual(plan.candidates.map(item => item.path), [stale]);
    await cleanup({ root, automatic: true, apply: true, getProcesses: async () => [], log: silent });
    await stat(fresh); assert.equal(await readFile(archive, 'utf8'), 'runtime cache');
  } finally { await rm(root, { recursive: true, force: true }); }
});
