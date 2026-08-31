import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { withRetry, sleepWithJitter } from '../lib/retry.js';
import { isLastSerpPage } from './yieldStop.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';

export class SerperError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SerperError';
    this.status = status;
  }
}

export type SerpOrganic = { title?: string; link?: string; snippet?: string; position?: number };
export type SerpSearchResponse = { organic?: SerpOrganic[] };

export function resolveSerperApiKey(): string | null {
  return process.env.SERPER_API_KEY?.trim() || null;
}

function fixturePath(query: string, page: number): string {
  const safe = query.replace(/[^a-z0-9]+/gi, '-').slice(0, 48).toLowerCase();
  const specific = join(fixturesDir, 'serper', `${safe}-page-${page}.json`);
  if (existsSync(specific)) return specific;
  if (query.includes('educational grant') || query.includes('ineligible')) {
    const grant = join(fixturesDir, 'serper', 'grant-search.json');
    if (existsSync(grant)) return grant;
  }
  return join(fixturesDir, 'serper', 'host-search.json');
}

export async function serperSearch(options: {
  query: string;
  page: number;
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: { increment: (key: string) => void };
}): Promise<SerpSearchResponse> {
  if (options.useFixtures) {
    const path = fixturePath(options.query, options.page);
    if (!existsSync(path)) return { organic: [] };
    return JSON.parse(readFileSync(path, 'utf8')) as SerpSearchResponse;
  }

  const apiKey = options.apiKey ?? resolveSerperApiKey();
  if (!apiKey) {
    throw new Error('SERPER_API_KEY is required for live search. Use --fixtures or --dry-run.');
  }

  options.counter?.increment('serper_searches');
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await withRetry(
    async () => {
      const res = await fetchImpl(SERPER_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({ q: options.query, page: options.page, num: 10, gl: 'us', hl: 'en' }),
      });
      if (!res.ok) {
        throw new SerperError(`Serper search failed: ${res.status} ${await res.text()}`, res.status);
      }
      return res;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1500,
      shouldRetry: (error) => error instanceof SerperError && (error.status === 429 || error.status >= 500),
    },
  );
  return (await response.json()) as SerpSearchResponse;
}

export async function serperSearchAllPages(options: {
  query: string;
  useFixtures?: boolean;
  apiKey?: string;
  pageCap?: number | null;
  rateLimitMs?: number;
  shouldStop?: () => boolean;
  onPage: (page: number, response: SerpSearchResponse) => void | Promise<void>;
}): Promise<number> {
  let page = 1;
  let last = 0;
  while (true) {
    if (options.pageCap != null && page > options.pageCap) break;
    const response = await serperSearch({
      query: options.query,
      page,
      useFixtures: options.useFixtures,
      apiKey: options.apiKey,
    });
    await options.onPage(page, response);
    last = page;
    if (options.shouldStop?.()) break;
    if (isLastSerpPage(response.organic?.length ?? 0)) break;
    if (options.rateLimitMs && options.rateLimitMs > 0 && !options.useFixtures) {
      await sleepWithJitter(options.rateLimitMs);
    }
    page += 1;
  }
  return last;
}
