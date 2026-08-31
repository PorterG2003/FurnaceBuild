import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './env.js';
import { withRetry } from './retry.js';
import { looksLikePdf, pdfBufferToText } from './pdf.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export type FetchPageResult = {
  url: string;
  finalUrl: string;
  status: number;
  html: string;
  fromCache: boolean;
  loginWall: boolean;
};

type UrlMap = Record<string, string>;

let urlMapCache: UrlMap | null = null;

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

function looksLikeLoginWall(html: string, status: number): boolean {
  if (status === 401 || status === 403) return true;
  const text = html.slice(0, 8000).toLowerCase();
  return (
    /sign in to (continue|access)/i.test(text) ||
    /create (an )?account to (continue|view)/i.test(text) ||
    /please log in/i.test(text) ||
    /registration required to (view|access)/i.test(text)
  );
}

export function cacheKey(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 24);
}

export function writeHtmlCache(cacheDir: string, url: string, html: string): void {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, `${cacheKey(url)}.html`), html, 'utf8');
}

export function hasCachedPage(cacheDir: string | undefined, url: string): boolean {
  if (!cacheDir || !url) return false;
  return existsSync(join(cacheDir, `${cacheKey(url)}.html`));
}

function shouldRetryHttp(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    return status === 429 || status >= 500;
  }
  return false;
}

export async function fetchPage(options: {
  url: string;
  useFixtures?: boolean;
  cacheDir?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  hostGate?: { run<T>(url: string, fn: () => Promise<T>): Promise<T> };
  maxAttempts?: number;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
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
        loginWall: false,
      };
    }
    return {
      url: options.url,
      finalUrl: options.url,
      status: 200,
      html,
      fromCache: true,
      loginWall: false,
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
        loginWall: looksLikeLoginWall(html, 200),
      };
    }
  }

  const live = async (): Promise<FetchPageResult> => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15000;
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const method = (options.method ?? 'GET').toUpperCase();
          const headers: Record<string, string> = {
            'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
            Accept: method === 'POST' ? 'application/json, text/html;q=0.8' : 'text/html,application/xhtml+xml',
            ...options.headers,
          };
          if (method === 'POST' && options.body && !headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          }
          const res = await fetchImpl(options.url, {
            method,
            redirect: 'follow',
            signal: controller.signal,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : options.body,
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
      { maxAttempts: options.maxAttempts ?? 2, baseDelayMs: 1500, shouldRetry: shouldRetryHttp },
    );

    const buf = Buffer.from(await response.arrayBuffer());
    const html = looksLikePdf(buf) ? pdfBufferToText(buf) : buf.toString('utf8');
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
      loginWall: looksLikeLoginWall(html, response.status),
    };
  };

  return options.hostGate ? options.hostGate.run(options.url, live) : live();
}
