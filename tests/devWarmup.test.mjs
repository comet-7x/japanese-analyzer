import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { warmDevelopmentRoutes } from '../scripts/dev-warmup.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

test('warmup consumes complete responses once and keeps auth and online fallback behavior', async () => {
  const paths = [];
  const messages = [];
  await withServer((req, res) => {
    paths.push(req.url);
    if (req.url === '/') {
      res.write('<html>');
      setTimeout(() => res.end('</html>'), 20);
    } else {
      res.writeHead(req.url === '/api/auth' ? 401 : 503).end();
    }
  }, async url => {
    const results = await warmDevelopmentRoutes(url, { log: message => messages.push(message) });
    assert.deepEqual(paths, ['/', '/api/auth', '/api/daily-sentence?locale=zh-CN']);
    assert.deepEqual(results.map(result => result.status), [200, 401, 503]);
    assert.ok(messages.some(message => message.includes('保留访问验证')));
    assert.ok(messages.some(message => message.includes('本地句子')));
    assert.equal(messages.at(-1), '[dev] 启动预热结束。');
  });
});

test('a stalled route has a deadline and does not prevent subsequent warmup', async () => {
  const paths = [];
  await withServer((req, res) => {
    paths.push(req.url);
    if (req.url !== '/') res.end('ready');
  }, async url => {
    const results = await warmDevelopmentRoutes(url, { timeoutMs: 100, log() {} });
    assert.deepEqual(results.map(result => result.status), [null, 200, 200]);
    assert.equal(paths.length, 3);
  });
});

test('stopping the development server cancels pending warmup and skips remaining routes', async () => {
  const controller = new AbortController();
  const paths = [];
  await withServer(req => {
    paths.push(req.url);
    controller.abort();
  }, async url => {
    const results = await warmDevelopmentRoutes(url, { signal: controller.signal, log() {} });
    assert.deepEqual(results, []);
    assert.deepEqual(paths, ['/']);
  });
});
