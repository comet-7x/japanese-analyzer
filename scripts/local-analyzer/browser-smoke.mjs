// Optional real-browser verification; install the isolated analysis-lab npm tools
// and Playwright WebKit before running. No saved user profile or model key is used.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium, webkit } from '../analysis-lab/engines/node_modules/playwright-core/index.mjs';
const base = process.env.LOCAL_ANALYZER_URL ?? 'http://127.0.0.1:3010';
const article = await readFile('tests/fixtures/four-seasons.txt', 'utf8');
const manifest = JSON.parse(await readFile('app/lib/localAnalyzerManifest.json', 'utf8'));
const report = { measuredAt: new Date().toISOString(), results: [] };
await mkdir('.codex-dev/sudachi-web', { recursive: true });
for (const [name, type] of [['chrome', chromium], ['webkit', webkit]]) {
  const browser = await type.launch(name === 'chrome' ? { headless: true, executablePath: process.env.LOCAL_ANALYZER_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : { headless: true });
  const deadline = setTimeout(() => { void browser.close(); }, 240_000);
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // The fixture model is intercepted below. A configured model must not cause
    // an implicit translation or model request when using local parsing.
    await context.addInitScript(() => localStorage.setItem('providerSettings', JSON.stringify({
      services: [{ id: 'fixture', name: 'Fixture', baseUrl: 'https://fixture.example/v1', apiKey: 'fixture-not-a-secret',
        models: [{ id: 'fixture-model', name: 'Fixture', model: 'fixture-model', caps: { structuredOutput: 'json_schema', thinking: true } }] }],
      activeServiceId: 'fixture', activeModelId: 'fixture-model',
    })));
    const page = await context.newPage(); const errors = []; const posts = []; const downloads = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() === 'POST' && !new URL(request.url()).pathname.startsWith('/__nextjs')) posts.push(new URL(request.url()).pathname);
      if (request.url().includes('/api/local-analyzer/dictionary/')) downloads.push(request.url()); });
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth'), page.goto(base)]);
    await page.getByLabel('解析方式', { exact: true }).selectOption('local');
    await page.getByLabel('日语原文', { exact: true }).fill(article);
    const started = Date.now();
    await page.locator('#analyzeButton').click();
    const correction = page.getByRole('button', { name: '用模型校正', exact: true });
    await correction.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '用模型校正' && !b.disabled), null, { timeout: 120_000 });
    const firstMs = Date.now() - started;
    const displayed = () => page.locator('[data-token-index] .word-token').allTextContents().then(words => words.join(''));
    // Newlines are layout elements; the worker and server tests check exact CRLF.
    assert.equal((await displayed()).replace(/\s/gu, ''), article.replace(/\s/gu, ''));
    assert.equal(downloads.length, manifest.chunks.length);
    assert.deepEqual(posts, [], 'Local parsing cannot silently invoke a model or translation');
    await page.screenshot({ path: `.codex-dev/sudachi-web/${name}-1280.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `.codex-dev/sudachi-web/${name}-375.png` });

    // Reproduce the reported two-chunk correction failure in the real UI.
    // Detailed validation is exercised by route tests; this fixture verifies
    // that the whole draft stays visible and only the failed chunk is retried.
    const correctionCalls = new Map();
    let failSecond = true, failureKind = 'range';
    await context.route('**/api/local-analyzer/correct', async route => {
      const body = route.request().postDataJSON();
      const index = body.chunkContext.index;
      correctionCalls.set(index, (correctionCalls.get(index) ?? 0) + 1);
      if (index === 1 && failSecond && failureKind === 'format') return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: {
        message: '模型校正 JSON 不完整（长度 10），未应用本段修改。', code: 'local_correction_format',
        details: { stage: 'model_content', reason: 'incomplete_json', contentKind: 'json_like', contentChars: 10 },
      } }) });
      if (index === 1 && failSecond) return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: {
        message: `模型校正第 1 项的词项编号超出本段范围（共 ${body.tokens.length} 个词项）。`,
        code: 'local_protocol_invalid', details: { reason: 'out_of_bounds', tokenCount: body.tokens.length, editIndex: 0, invalidId: 999 },
      } }) });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tokens: body.tokens }) });
    });
    await correction.click();
    await page.getByText(/解析错误：模型校正未完成，已保留原有分词：模型校正第 1 项的词项编号超出本段范围/).waitFor();
    assert.equal((await displayed()).replace(/\s/gu, ''), article.replace(/\s/gu, ''));
    assert.equal(await page.getByText('已由模型校正：fixture-model', { exact: true }).count(), 0);
    assert.deepEqual([...correctionCalls.keys()].sort(), [0, 1, 2, 3]);
    failSecond = false;
    await page.getByRole('button', { name: '重试失败部分', exact: true }).click();
    await page.getByText('已由模型校正：fixture-model', { exact: true }).waitFor();
    assert.equal(correctionCalls.get(0), 1);
    assert.equal(correctionCalls.get(1), 5);
    assert.equal((await displayed()).replace(/\s/gu, ''), article.replace(/\s/gu, ''));
    await page.getByRole('button', { name: '重新解析', exact: true }).click();
    await page.getByText('本地初稿：读音和词性尚未经过模型校正。', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '用模型校正' && !b.disabled));
    failureKind = 'format'; failSecond = true; correctionCalls.clear();
    await correction.click();
    await page.getByText(/解析错误：模型校正未完成，已保留原有分词：模型校正 JSON 不完整/).waitFor();
    assert.equal((await displayed()).replace(/\s/gu, ''), article.replace(/\s/gu, ''));
    assert.equal(await page.getByText('已由模型校正：fixture-model', { exact: true }).count(), 0);
    failSecond = false;
    await page.getByRole('button', { name: '重试失败部分', exact: true }).click();
    await page.getByText('已由模型校正：fixture-model', { exact: true }).waitFor();
    assert.equal(correctionCalls.get(0), 1);
    assert.equal(correctionCalls.get(1), 5);
    await context.unroute('**/api/local-analyzer/correct');

    // Reload destroys the worker. All dictionary chunks must now come from IDB.
    let forbidden = 0;
    await context.route('**/api/local-analyzer/dictionary/**', route => { forbidden++; return route.abort(); });
    await page.reload();
    await page.getByLabel('日语原文', { exact: true }).fill('猫…犬。㍿ 😀\n並んでいる。');
    const cachedStarted = Date.now();
    await page.locator('#analyzeButton').click();
    await correction.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '用模型校正' && !b.disabled), null, { timeout: 120_000 });
    assert.equal(forbidden, 0);
    const cachedMs = Date.now() - cachedStarted;
    assert.equal((await displayed()).replace(/\s/gu, ''), '猫…犬。㍿😀並んでいる。');

    // Correction is explicit and uses only its endpoint. Mock the validated
    // server response here; the route itself has separate provider/patch tests.
    await context.route('**/api/local-analyzer/correct', async route => {
      const body = route.request().postDataJSON();
      assert.equal(body.thinkingEnabled, false);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tokens: body.tokens }) });
    });
    await correction.click();
    await page.getByText('已由模型校正：fixture-model', { exact: true }).waitFor({ timeout: 30_000 });
    assert.ok(posts.length > 0 && posts.every(path => path === '/api/local-analyzer/correct'));

    const reusedStarted = Date.now();
    await page.getByRole('button', { name: '重新解析', exact: true }).click();
    await page.getByText('本地初稿：读音和词性尚未经过模型校正。', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '用模型校正' && !b.disabled));
    const reusedMs = Date.now() - reusedStarted;

    // Stop an unresponsive correction; releasing its late response cannot replace
    // the retained draft or turn the result into a corrected success.
    await context.unroute('**/api/local-analyzer/correct');
    let release; const held = new Promise(resolve => { release = resolve; });
    await context.route('**/api/local-analyzer/correct', async route => {
      await held;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tokens: route.request().postDataJSON().tokens }) }).catch(() => {});
    });
    await correction.click();
    const stop = page.getByRole('button', { name: '终止解析', exact: true });
    await stop.waitFor(); await stop.click(); release();
    await page.getByText('本地初稿：读音和词性尚未经过模型校正。', { exact: true }).waitFor();
    assert.equal((await displayed()).replace(/\s/gu, ''), '猫…犬。㍿😀並んでいる。');
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('已由模型校正：fixture-model', { exact: true }).count(), 0);

    // A corrupted cached part must be fetched again instead of entering WASM.
    await page.evaluate(key => new Promise((resolve, reject) => {
      const open = indexedDB.open('japaneseAnalyzer-localDictionary', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('chunks', 'readwrite');
        tx.objectStore('chunks').put(new Uint8Array([1]), key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    }), manifest.chunks[0].sha256);
    await context.unroute('**/api/local-analyzer/dictionary/**');
    const beforeRepair = downloads.length;
    await page.reload();
    await page.getByLabel('日语原文', { exact: true }).fill('静かだ。');
    await page.locator('#analyzeButton').click();
    await correction.waitFor({ timeout: 120_000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '用模型校正' && !b.disabled), null, { timeout: 120_000 });
    assert.equal(downloads.length - beforeRepair, 1);
    assert.ok(downloads.at(-1).endsWith(manifest.chunks[0].sha256));
    await page.getByRole('button', { name: '清除词典缓存', exact: true }).click();
    await page.getByText('已清除词典缓存。', { exact: true }).waitFor();
    const remaining = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('japaneseAnalyzer-localDictionary', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('chunks')) { db.close(); resolve(0); return; }
        const count = db.transaction('chunks').objectStore('chunks').count();
        count.onsuccess = () => { db.close(); resolve(count.result); };
        count.onerror = () => { db.close(); reject(count.error); };
      };
    }));
    assert.equal(remaining, 0);
    assert.deepEqual(errors, []);
    report.results.push({ browser: name, version: browser.version(), firstMs, cachedMs, reusedMs, dictionaryChunks: manifest.chunks.length,
      cacheNetworkRequestsAfterReload: forbidden, corruptCacheRepairRequests: 1, clearCacheRemaining: remaining,
      noImplicitModelRequests: true, failedCorrectionPreservesDraft: true, malformedCorrectionPreservesDraft: true, correctionRetriesFailedChunkOnly: true,
      correctionCancelPreservesDraft: true, mobileOverflow: false });
    console.log(`${name}: first load, IDB reuse/repair/clear, no implicit AI, explicit correction, cancellation and 375px layout passed`);
  } finally { clearTimeout(deadline); await browser.close(); }
}
await writeFile('scripts/analysis-lab/results/sudachi-web.json', JSON.stringify(report, null, 2) + '\n');
