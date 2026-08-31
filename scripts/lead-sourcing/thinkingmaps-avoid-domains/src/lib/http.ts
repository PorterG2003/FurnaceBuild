import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './env.js';
import { withRetry } from './retry.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export type FetchPageResult = {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  fromCache: boolean;
};

type UrlMap = Record<string, string>;

let urlMapCache: UrlMap | null = null;

export function resetUrlMapCache(): void {
  urlMapCache = null;
}

function loadUrlMap(): UrlMap {
  if (urlMapCache) return urlMapCache;
  const path = join(fixturesDir, 'url-map.json');
  if (!existsSync(path)) {
    urlMapCache = {};
    return urlMapCache;
  }
  urlMapCache = JSON.parse(readFileSync(path, 'utf8')) as UrlMap;
  return urlMapCache;
}

export function fixtureHtmlForUrl(url: string): string | null {
  const map = loadUrlMap();
  const relative = map[url] ?? map[url.replace(/\/$/, '')] ?? map[`${url}/`];
  if (!relative) return null;
  const full = join(fixturesDir, relative);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export async function fetchPage(options: {
  url: string;
  useFixtures?: boolean;
  cacheDir?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
}): Promise<FetchPageResult> {
  if (options.useFixtures) {
    const html = fixtureHtmlForUrl(options.url);
    if (html == null) {
      return {
        url: options.url,
        finalUrl: options.url,
        status: 404,
        html: '',
        fromCache: false,
      };
    }
    return {
      url: options.url,
      finalUrl: options.url,
      status: 200,
      html,
      fromCache: true,
    };
  }

  if (options.cacheDir) {
    const path = join(options.cacheDir, `${cacheKey(options.url)}.html`);
    if (existsSync(path)) {
      const html = readFileSync(path, 'utf8');
      return {
        url: options.url,
        finalUrl: options.url,
        status: 200,
        html,
        fromCache: true,
      };
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const response = await withRetry(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(options.url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
          },
        });
        if (res.status === 429 || res.status >= 500) {
          const err = new Error(`HTTP ${res.status}`) as Error & { status: number };
          err.status = res.status;
          throw err;
        }
        return res;
      } finally {
        clearTimeout(timer);
      }
    },
    { maxAttempts: 3, baseDelayMs: 1500 },
  );

  const html = await response.text();
  if (options.cacheDir) {
    mkdirSync(options.cacheDir, { recursive: true });
    writeFileSync(join(options.cacheDir, `${cacheKey(options.url)}.html`), html, 'utf8');
  }

  return {
    url: options.url,
    finalUrl: response.url || options.url,
    status: response.status,
    html,
    fromCache: false,
  };
}
