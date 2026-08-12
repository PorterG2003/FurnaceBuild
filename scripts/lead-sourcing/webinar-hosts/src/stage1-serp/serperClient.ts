import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { withRetry, sleepWithJitter } from '../lib/retry.js';
import type { CallCounter } from '../lib/callCounter.js';
import { isLastSerpPage } from './serpPagination.js';
import type { SerpSearchResponse } from './serpTypes.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';

export class SerperError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SerperError';
    this.status = status;
  }
}

export type SerperSearchOptions = {
  query: string;
  page: number;
  timeFilter: string;
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
};

export type SerperSessionOptions = {
  query: string;
  timeFilter: string;
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
  pageCap?: number | null;
  startPage?: number;
  rateLimitMs?: number;
  shouldStop?: () => boolean;
  onPage: (serpPage: number, response: SerpSearchResponse) => void | Promise<void>;
};

function fixturePath(query: string, page: number): string {
  const safe = query.replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase();
  const specific = join(fixturesDir, 'serper', `${safe}-page-${page}.json`);
  if (existsSync(specific)) return specific;
  return join(fixturesDir, 'serper', 'search-response.json');
}

function readFixture(query: string, page: number): SerpSearchResponse {
  return JSON.parse(readFileSync(fixturePath(query, page), 'utf8')) as SerpSearchResponse;
}

export function resolveSerperApiKey(): string | null {
  return process.env.SERPER_API_KEY?.trim() || null;
}

export async function serperSearch(options: SerperSearchOptions): Promise<SerpSearchResponse> {
  if (options.useFixtures) {
    return readFixture(options.query, options.page);
  }

  const apiKey = options.apiKey ?? resolveSerperApiKey();
  if (!apiKey) {
    throw new Error('SERPER_API_KEY is required for live Stage 1 runs. Set SERPER_API_KEY or use USE_FIXTURES=1.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  options.counter?.increment('serper_searches');

  const body = {
    q: options.query,
    page: options.page,
    num: 10,
    gl: 'us',
    hl: 'en',
    ...(options.timeFilter.trim() ? { tbs: options.timeFilter.trim() } : {}),
  };

  const response = await withRetry(
    async () => {
      const res = await fetchImpl(SERPER_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new SerperError(`Serper search failed: ${res.status} ${await res.text()}`, res.status);
      }

      return res;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1500,
      shouldRetry: (error) => {
        if (error instanceof SerperError) {
          return error.status === 429 || error.status >= 500;
        }
        return true;
      },
    },
  );

  return (await response.json()) as SerpSearchResponse;
}

/** Paginate one query via Serper (Google index, no captchas). */
export async function serperSearchAllPagesForQuery(options: SerperSessionOptions): Promise<number> {
  let serpPage = options.startPage ?? 1;
  let lastPageFetched = 0;

  while (true) {
    if (options.pageCap != null && serpPage > options.pageCap) break;

    const response = await serperSearch({
      query: options.query,
      page: serpPage,
      timeFilter: options.timeFilter,
      apiKey: options.apiKey,
      useFixtures: options.useFixtures,
      fetchImpl: options.fetchImpl,
      counter: options.counter,
    });

    await options.onPage(serpPage, response);
    lastPageFetched = serpPage;

    if (options.shouldStop?.()) break;
    if (isLastSerpPage(response.organic?.length ?? 0)) break;

    if (options.rateLimitMs != null && options.rateLimitMs > 0 && !options.useFixtures) {
      await sleepWithJitter(options.rateLimitMs);
    }

    serpPage++;
  }

  return lastPageFetched;
}
