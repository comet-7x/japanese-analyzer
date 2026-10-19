// Keep the browser deadline longer than the upstream budget, including response/compilation overhead.
export const DAILY_SENTENCE_UPSTREAM_TIMEOUT_MS = 15_000;
export const DAILY_SENTENCE_CLIENT_TIMEOUT_MS = DAILY_SENTENCE_UPSTREAM_TIMEOUT_MS + 3_000;
