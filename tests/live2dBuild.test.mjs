import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildWithCore } from '../scripts/live2d/build.mjs';
import { parseOptions, prepareCore, projectRoot, validateLock } from '../scripts/live2d/prepare.mjs';

const pinned = JSON.parse(await readFile(new URL('../live2d-core.lock.json', import.meta.url), 'utf8'));
const data = Buffer.from('/** Live2D test-only notice, preserved verbatim. */\nvar Live2DCubismCore = {};');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const noNetwork = async () => { throw new Error('Unexpected network access'); };

async function fixture(t) {
  const parent = join(projectRoot, '.desktop-cache');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'core-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = { ...pinned, bytes: data.length, sha256: hash(data) };
  await writeFile(join(root, 'live2d-core.lock.json'), JSON.stringify(lock));
  const target = join(root, 'public/live2d/core/live2dcubismcore.min.js');
  const cache = join(root, '.desktop-cache/live2d-core', lock.sha256, 'live2dcubismcore.min.js');
  const prepare = (options = {}) => prepareCore({ root, log: () => {}, fetchImpl: noNetwork, ...options });
  return { root, target, cache, lock, prepare };
}

async function put(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

test('a clean checkout makes no network request without explicit software-license acknowledgement', async (t) => {
  const { root, target, prepare } = await fixture(t);
  await assert.rejects(prepare(), /--accept-license.*LIVE2D_ACCEPT_LICENSE=1/);
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  assert.deepEqual(await readdir(root), ['live2d-core.lock.json']);
});

test('an official download verifies bytes, preserves notices and creates a reusable offline cache', async (t) => {
  const { target, cache, lock, prepare } = await fixture(t);
  let requests = 0;
  const result = await prepare({ acceptLicense: true, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, lock.url);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(data);
  } });
  assert.equal(requests, 1);
  assert.equal(result.source, 'official download');
  assert.deepEqual(await readFile(target), data);
  assert.deepEqual(await readFile(cache), data);
  assert.equal((await prepare()).source, 'installed file');
  await rm(target);
  assert.equal((await prepare()).source, 'verified cache');
  assert.deepEqual(await readFile(target), data);
  assert.deepEqual(await readdir(dirname(target)), ['live2dcubismcore.min.js']);
});

test('a manually installed matching Core works without downloading or accepting terms on behalf of its owner', async (t) => {
  const { target, prepare } = await fixture(t);
  await put(target, data);
  assert.equal((await prepare()).source, 'installed file');
});

test('offline source paths support spaces; an explicit wrong source never falls back to downloading', async (t) => {
  const { root, target, prepare } = await fixture(t);
  const sourcePath = join(root, 'SDK with spaces', 'Core', 'live2dcubismcore.min.js');
  await put(sourcePath, data);
  assert.equal((await prepare({ sourcePath })).source, 'local source');
  await writeFile(sourcePath, 'different SDK version');
  await assert.rejects(prepare({ sourcePath, acceptLicense: true }), /Local Core does not match/);
  assert.deepEqual(await readFile(target), data);
});

test('a corrupted installed file is repaired from the verified cache without network access', async (t) => {
  const { target, cache, prepare } = await fixture(t);
  await put(target, 'corrupt');
  await put(cache, data);
  assert.equal((await prepare()).source, 'verified cache');
  assert.deepEqual(await readFile(target), data);
});

test('failed or changed downloads preserve existing files and never publish unverified bytes', async (t) => {
  const cases = {
    'server error': async () => new Response('Unavailable', { status: 503 }),
    'truncated file': async () => new Response(data.subarray(0, data.length - 1)),
    'oversized response': async () => new Response(Buffer.concat([data, data])),
    'changed content with same size': async () => new Response(Buffer.alloc(data.length, 65)),
    'network timeout': async () => { throw new Error('timeout'); },
    'redirect refused': async () => { throw new Error('unexpected redirect'); },
    'interrupted stream': async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection interrupted')); } })),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const { target, cache, prepare } = await fixture(t);
      await put(target, 'previous file');
      await put(cache, 'invalid cache');
      await assert.rejects(prepare({ acceptLicense: true, fetchImpl }), /No unverified file was installed/);
      assert.equal(await readFile(target, 'utf8'), 'previous file');
      assert.equal(await readFile(cache, 'utf8'), 'invalid cache');
      assert.deepEqual(await readdir(dirname(target)), ['live2dcubismcore.min.js']);
      assert.deepEqual(await readdir(dirname(cache)), ['live2dcubismcore.min.js']);
    });
  }
});

test('lock files reject floating releases, nonofficial hosts, redirects through URL parameters and oversized assets', () => {
  assert.equal(validateLock(pinned), pinned);
  const invalid = [
    { url: 'https://cubism.live2d.com/sdk-web/core/live2dcubismcore.min.js' },
    { url: pinned.url.replace('cubism.live2d.com', 'third-party.example') },
    { url: pinned.url.replace('https:', 'http:') },
    { url: `${pinned.url}?redirect=other` },
    { sha256: 'unverified' }, { bytes: 10 * 1024 * 1024 },
    { licenseUrls: [] },
  ];
  for (const change of invalid) assert.throws(() => validateLock({ ...pinned, ...change }), /Invalid live2d-core.lock.json/);
});

test('license acknowledgement is explicit and unknown arguments cannot silently start a download', () => {
  assert.equal(parseOptions([], {}).acceptLicense, false);
  assert.equal(parseOptions([], { LIVE2D_ACCEPT_LICENSE: 'true' }).acceptLicense, false);
  assert.equal(parseOptions([], { LIVE2D_ACCEPT_LICENSE: '1' }).acceptLicense, true);
  assert.equal(parseOptions(['--accept-license'], {}).acceptLicense, true);
  assert.equal(parseOptions(['--source', 'C:\\SDK with spaces\\Core.js'], {}).sourcePath, 'C:\\SDK with spaces\\Core.js');
  assert.throws(() => parseOptions(['--source'], {}), /requires a local/);
  assert.throws(() => parseOptions(['--source', '--accept-license'], {}), /requires a local/);
  assert.throws(() => parseOptions(['--unknown'], {}), /Unknown option/);
});

test('web and desktop builds prepare Core before delegating once to the existing npm lifecycle', async () => {
  for (const mode of ['web', 'desktop']) {
    const events = [];
    const npmPath = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
    await buildWithCore(mode, ['--accept-license'], {
      env: { npm_execpath: npmPath }, nodeVersion: '22.23.3',
      readPackage: async () => ({ desktop: { nodeVersion: '22.23.3' } }),
      prepare: async (options) => { assert.equal(options.acceptLicense, true); events.push('prepared'); },
      execute: async (command, args) => {
        assert.equal(command, process.execPath);
        assert.deepEqual(args, [npmPath, 'run', mode === 'desktop' ? 'desktop:build' : 'build']);
        events.push('built');
      },
    });
    assert.deepEqual(events, ['prepared', 'built']);
  }
});

test('failed preparation and unsupported desktop Node versions stop before building or downloading', async () => {
  let built = false;
  await assert.rejects(buildWithCore('web', [], {
    env: { npm_execpath: '/npm-cli.js' },
    prepare: async () => { throw new Error('Core unavailable'); },
    execute: async () => { built = true; },
  }), /Core unavailable/);
  assert.equal(built, false);
  await assert.rejects(buildWithCore('desktop', [], {
    env: { npm_execpath: '/npm-cli.js' }, nodeVersion: '24.0.0',
    readPackage: async () => ({ desktop: { nodeVersion: '22.23.3' } }),
    prepare: noNetwork,
  }), /require Node.js 22/);
});
