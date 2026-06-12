/**
 * Centralized Smartlead API client. All Smartlead HTTP requests should go through
 * this service. It enforces rate limiting and handles 429 with exponential backoff.
 */

export const SMARTLEAD_BASE = 'https://server.smartlead.ai/api/v1';

/** Smartlead allows max 200 requests per minute. Min ms between requests to stay under that. */
const RATE_LIMIT_MS = 350;
/** Max delay between retries when we get 429 (5 minutes). */
const MAX_BACKOFF_MS = 5 * 60 * 1000;
/** Initial backoff when we get 429 (1 second). */
const INITIAL_BACKOFF_MS = 1000;
/** Max number of 429 retries per request. */
const MAX_429_RETRIES = 20;

let lastRequestTime = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS && lastRequestTime > 0) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SmartleadRequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

const SMARTLEAD_USER_AGENT =
  process.env.SMARTLEAD_USER_AGENT?.trim() ||
  'FurnaceBuildSmartleadClient/1.0';

/**
 * Perform a single Smartlead API request. Enforces minimum spacing between
 * requests and retries on 429 with exponential backoff (cap 5 minutes).
 * Use this for all Smartlead API calls so rate limits and backoff are consistent.
 */
export async function smartleadRequest(
  options: SmartleadRequestOptions,
): Promise<Response> {
  const { url, method = 'GET', headers = {}, body } = options;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    await throttle();
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': SMARTLEAD_USER_AGENT,
        ...headers,
      },
      body,
    });

    if (res.status !== 429) {
      return res;
    }

    lastError = new Error(
      `Smartlead rate limited (429). Attempt ${attempt + 1}/${MAX_429_RETRIES + 1}.`,
    );

    const retryAfterSec = res.headers.get('Retry-After');
    let waitMs: number;
    if (retryAfterSec != null && retryAfterSec.trim() !== '') {
      const parsed = parseInt(retryAfterSec.trim(), 10);
      waitMs = Number.isFinite(parsed) ? Math.min(parsed * 1000, MAX_BACKOFF_MS) : backoffMs(attempt);
    } else {
      waitMs = backoffMs(attempt);
    }

    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Smartlead API] 429 received, waiting ${Math.round(waitMs / 1000)}s before retry.`);
    }
    await sleep(waitMs);
  }

  throw lastError ?? new Error('Smartlead API: too many 429 retries.');
}

function backoffMs(attempt: number): number {
  const exponential = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  return Math.min(exponential, MAX_BACKOFF_MS);
}
