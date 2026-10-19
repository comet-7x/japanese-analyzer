import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { stripVTControlCharacters } from 'node:util';
import { warmDevelopmentRoutes } from './dev-warmup.mjs';

const require = createRequire(import.meta.url);
const controller = new AbortController();
const childEnv = { ...process.env };
// Next sees pipes so we can inspect readiness; preserve the parent terminal's color support.
if (process.stdout.isTTY && childEnv.FORCE_COLOR === undefined && childEnv.NO_COLOR === undefined
  && !childEnv.CI && childEnv.TERM !== 'dumb') {
  childEnv.FORCE_COLOR = '1';
}
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--turbopack', ...process.argv.slice(2)], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: childEnv,
});
let startupOutput = '';
let warming = false;
let stopping = false;

function inspectStartup(chunk) {
  if (warming || stopping) return;
  startupOutput = (startupOutput + stripVTControlCharacters(String(chunk))).slice(-16_384);
  const address = /\bLocal:\s+(https?:\/\/\S+)/.exec(startupOutput)?.[1];
  if (!address || !/Ready in\b/.test(startupOutput)) return;
  warming = true;
  const url = new URL(address);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (url.hostname === '[::]') url.hostname = '[::1]';
  console.log(`[dev] 当前开发地址：${url.origin}（请以此端口访问）`);
  void warmDevelopmentRoutes(url, { signal: controller.signal }).catch(() => {
    if (!stopping) console.log('[dev] 跳过启动预热；开发服务继续运行。');
  });
}

child.stdout.on('data', chunk => { process.stdout.write(chunk); inspectStartup(chunk); });
child.stderr.on('data', chunk => { process.stderr.write(chunk); inspectStartup(chunk); });
child.once('error', error => {
  controller.abort();
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', code => {
  controller.abort();
  process.exitCode = stopping ? 0 : code ?? 1;
});

function stop(signal) {
  if (stopping) return;
  stopping = true;
  controller.abort();
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill(signal);
  }
}
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
