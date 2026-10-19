import http from 'node:http';
import https from 'node:https';

const ROUTES = ['/', '/api/auth', '/api/daily-sentence?locale=zh-CN'];

/** Use a direct local request so a shell's proxy configuration cannot intercept warmup. */
function requestRoute(url, signal) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.get(url, { signal, agent: false }, response => {
      response.on('error', reject);
      response.on('end', () => resolve(response.statusCode));
      response.resume();
    });
    request.on('error', reject);
  });
}

/** Compile routes once, without blocking readiness, retrying upstream calls, or invoking paid services. */
export async function warmDevelopmentRoutes(baseUrl, { signal, timeoutMs = 45_000, log = console.log } = {}) {
  log('[dev] 后台预热首页和每日一句…');
  const results = [];
  for (const path of ROUTES) {
    if (signal?.aborted) break;
    const deadline = AbortSignal.timeout(timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const status = await requestRoute(new URL(path, baseUrl), requestSignal);
      results.push({ path, status });
      if (status === 401) {
        log(`[dev] 已预热 ${path}（保留访问验证）。`);
      } else if (status >= 400) {
        log(`[dev] 预热 ${path} 返回 HTTP ${status}；开发服务继续运行。`);
      }
    } catch {
      if (signal?.aborted) break;
      results.push({ path, status: null });
      log(`[dev] 未能完成 ${path} 预热；开发服务继续运行。`);
    }
  }
  if (!signal?.aborted) log('[dev] 启动预热结束。');
  return results;
}
