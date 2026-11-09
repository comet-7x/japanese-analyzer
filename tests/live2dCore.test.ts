import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import test from 'node:test';
import {
  CoreInstallError,
  LIVE2D_CORE,
  getCoreStatus,
  installCore,
  resolveCore,
  type CoreSpec,
} from '../app/api/_utils/live2dCore';
import { LIVE2D_CORE_LICENSES } from '../app/plugins/live2d/coreInfo';
import { GET as getCore, POST as installCoreRoute } from '../app/api/live2d/core/route';
import { GET as getCoreStatusRoute } from '../app/api/live2d/core/status/route';
import lock from '../live2d-core.lock.json';

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');

const CORE_CONTENT = '/* Live2D test core: verified bytes, not executable in tests. */\nvar Live2DCubismCore = { testOnly: true };\n';

const spec: CoreSpec = {
  ...LIVE2D_CORE,
  filename: 'live2dcubismcore.testcore.js',
  url: 'https://cubism.live2d.com/sdk-web/core/05/live2dcubismcore.testcore.js',
  bytes: Buffer.byteLength(CORE_CONTENT),
  sha256: hash(CORE_CONTENT),
};

async function sandbox(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'live2d-core-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('the runtime pin and the client license links match the committed lock file', () => {
  assert.equal(LIVE2D_CORE.filename, 'live2dcubismcore.min.js');
  assert.equal(LIVE2D_CORE.url, lock.url);
  assert.equal(LIVE2D_CORE.bytes, lock.bytes);
  assert.equal(LIVE2D_CORE.sha256, lock.sha256);
  assert.equal(LIVE2D_CORE.sdkVersion, lock.sdkVersion);
  assert.equal(LIVE2D_CORE.coreSeries, lock.coreSeries);
  assert.equal(LIVE2D_CORE.downloadPage, lock.downloadPage);
  assert.deepEqual([...LIVE2D_CORE.licenseUrls], [...lock.licenseUrls]);
  assert.deepEqual([...LIVE2D_CORE_LICENSES], [...lock.licenseUrls]);
});

test('a missing Core reports not-installed with the pinned identity', async (t) => {
  const root = await sandbox(t);
  const status = await getCoreStatus(root, spec);
  assert.deepEqual(status, { installed: false, sdkVersion: spec.sdkVersion, coreSeries: spec.coreSeries, sha256: spec.sha256, bytes: spec.bytes });
});

test('an online install downloads, verifies and persists the Core', async (t) => {
  const root = await sandbox(t);
  let requests = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    requests++;
    assert.equal(input, spec.url);
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(CORE_CONTENT);
  }) as typeof fetch;
  const status = await installCore({ mode: 'download', acceptLicense: true, fetchImpl, root }, spec);
  assert.equal(requests, 1);
  assert.equal(status.installed, true);
  assert.equal(await readFile(join(root, spec.filename), 'utf8'), CORE_CONTENT);
  assert.equal((await getCoreStatus(root, spec)).installed, true);
});

test('an offline import verifies the exact bytes before writing', async (t) => {
  const root = await sandbox(t);
  const noNetwork = (async () => { throw new Error('Unexpected network access'); }) as typeof fetch;
  const status = await installCore({ mode: 'import', acceptLicense: true, content: CORE_CONTENT, fetchImpl: noNetwork, root }, spec);
  assert.equal(status.installed, true);
  assert.equal(await readFile(join(root, spec.filename), 'utf8'), CORE_CONTENT);
});

test('an import that does not match the pin is rejected without writing', async (t) => {
  const root = await sandbox(t);
  await assert.rejects(
    installCore({ mode: 'import', acceptLicense: true, content: CORE_CONTENT + 'tampered\n', root }, spec),
    (error: unknown) => error instanceof CoreInstallError && error.status === 400,
  );
  await assert.rejects(readFile(join(root, spec.filename)), { code: 'ENOENT' });
});

test('the software license must be accepted before any download or import', async (t) => {
  const root = await sandbox(t);
  const noNetwork = (async () => { throw new Error('Unexpected network access'); }) as typeof fetch;
  await assert.rejects(installCore({ mode: 'download', fetchImpl: noNetwork, root }, spec), /安装需要同意软件许可/);
  await assert.rejects(installCore({ mode: 'import', content: CORE_CONTENT, root }, spec), /安装需要同意软件许可/);
  await assert.rejects(readFile(join(root, spec.filename)), { code: 'ENOENT' });
});

test('failed or tampered downloads never publish unverified bytes', async (t) => {
  const cases = {
    'server error': async () => new Response('Unavailable', { status: 503 }),
    'truncated file': async () => new Response(CORE_CONTENT.slice(0, -1)),
    'oversized response': async () => new Response(CORE_CONTENT + CORE_CONTENT),
    'changed content with same size': async () => new Response(CORE_CONTENT.replace('testOnly', 'fakOnly')),
    'network failure': async () => { throw new Error('connection refused'); },
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const root = await sandbox(t);
      await assert.rejects(
        installCore({ mode: 'download', acceptLicense: true, fetchImpl: fetchImpl as typeof fetch, root }, spec),
        (error: unknown) => error instanceof CoreInstallError && error.status === 502,
      );
      await assert.rejects(readFile(join(root, spec.filename)), { code: 'ENOENT' });
    });
  }
});

test('a corrupted installed file is reported as not installed', async (t) => {
  const root = await sandbox(t);
  await installCore({ mode: 'import', acceptLicense: true, content: CORE_CONTENT, root }, spec);
  await writeFile(join(root, spec.filename), CORE_CONTENT + 'corruption');
  assert.equal((await getCoreStatus(root, spec)).installed, false);
  assert.equal(await resolveCore(root, spec), null);
});

test('the baked build-time copy is used when no runtime install exists, and a runtime install wins', async (t) => {
  const staticCwd = await sandbox(t);
  const runtimeRoot = await sandbox(t);
  const previousCwd = process.cwd();
  t.after(() => process.chdir(previousCwd));
  process.chdir(staticCwd);
  try {
    await mkdir(join(staticCwd, 'public', 'live2d', 'core'), { recursive: true });
    await writeFile(join(staticCwd, 'public', 'live2d', 'core', spec.filename), CORE_CONTENT);
    const fromStatic = await resolveCore(runtimeRoot, spec);
    assert.equal(fromStatic?.source, 'static');
    assert.equal(fromStatic ? hash(fromStatic.data) : '', spec.sha256);
    assert.equal((await getCoreStatus(runtimeRoot, spec)).installed, true);
    // A runtime install takes precedence over the baked copy.
    await installCore({ mode: 'import', acceptLicense: true, content: CORE_CONTENT, root: runtimeRoot }, spec);
    const fromRuntime = await resolveCore(runtimeRoot, spec);
    assert.equal(fromRuntime?.source, 'runtime');
    assert.equal(fromRuntime ? hash(fromRuntime.data) : '', spec.sha256);
  } finally {
    process.chdir(previousCwd);
  }
});

// Route tests exercise only validation and failure paths; they never reach the
// real per-user directory (the consent/content/hash checks all fail first).
const originalFetch = globalThis.fetch;
const request = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('the install route validates its request before downloading or writing', async () => {
  const noNetwork = (async () => { throw new Error('Unexpected network access'); }) as typeof fetch;
  const cases: { body: unknown; status: number; message: RegExp }[] = [
    { body: { mode: 'download' }, status: 400, message: /同意软件许可/ },
    { body: { mode: 'import', acceptLicense: true }, status: 400, message: /安装参数无效/ },
    { body: { mode: 'import', acceptLicense: true, content: 'not the pinned core' }, status: 400, message: /与官方 Cubism Core 不一致/ },
    { body: { mode: 'import', acceptLicense: false, content: CORE_CONTENT }, status: 400, message: /同意软件许可/ },
    { body: { mode: 'unexpected', acceptLicense: true }, status: 400, message: /安装参数无效/ },
  ];
  for (const { body, status, message } of cases) {
    globalThis.fetch = noNetwork;
    const response = await installCoreRoute(request('http://localhost/api/live2d/core', body));
    assert.equal(response.status, status, `body ${JSON.stringify(body)}`);
    const parsed = await response.json();
    assert.match(parsed.error.message, message);
  }
  globalThis.fetch = async () => { throw new Error('connection refused'); };
  const failed = await installCoreRoute(request('http://localhost/api/live2d/core', { mode: 'download', acceptLicense: true }));
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error.message, /下载或校验失败/);
  globalThis.fetch = originalFetch;
});

test('the status route reports the pinned identity', async () => {
  const response = await getCoreStatusRoute(new NextRequest('http://localhost/api/live2d/core/status'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sdkVersion, LIVE2D_CORE.sdkVersion);
  assert.equal(body.sha256, LIVE2D_CORE.sha256);
  assert.equal(body.bytes, LIVE2D_CORE.bytes);
  assert.equal(typeof body.installed, 'boolean');
});

test('the core route serves only a verified runtime or baked copy', async () => {
  const response = await getCore(new NextRequest('http://localhost/api/live2d/core'));
  assert.ok([200, 404].includes(response.status), 'either installed (200) or absent (404)');
  if (response.status === 200) {
    const data = new Uint8Array(await response.arrayBuffer());
    assert.equal(hash(data), LIVE2D_CORE.sha256, 'served bytes match the pinned Core');
    assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  }
});
