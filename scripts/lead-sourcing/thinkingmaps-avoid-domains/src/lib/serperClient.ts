import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './env.js';
import { withRetry } from './retry.js';

export type SerperOrganic = {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
};

export type SerperResponse = {
  knowledgeGraph?: { website?: string; title?: string; description?: string };
  organic?: SerperOrganic[];
};

export class SerperError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'SerperError';
    this.status = status;
  }
}

type QueryMap = Record<string, string>;

let queryMapCache: QueryMap | null = null;

function loadQueryMap(): QueryMap {
  if (queryMapCache) return queryMapCache;
  const path = join(fixturesDir, 'serper', 'query-map.json');
  if (!existsSync(path)) {
    queryMapCache = {};
    return queryMapCache;
  }
  queryMapCache = JSON.parse(readFileSync(path, 'utf8')) as QueryMap;
  return queryMapCache;
}

export function resetQueryMapCache(): void {
  queryMapCache = null;
}

function fixtureForQuery(query: string): SerperResponse {
  const map = loadQueryMap();
  const relative =
    map[query] ??
    Object.entries(map).find(([key]) => query.includes(key) || key.includes(query))?.[1];
  const fallback = join(fixturesDir, 'serper', 'website-empty.json');
  const path = relative ? join(fixturesDir, 'serper', relative) : fallback;
  if (!existsSync(path)) return { organic: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as SerperResponse;
}

export async function serperSearch(
  query: string,
  options: {
    apiKey?: string;
    num?: number;
    useFixtures?: boolean;
    fetchImpl?: typeof fetch;
    onCall?: () => void;
  } = {},
): Promise<SerperResponse> {
  if (options.useFixtures) {
    options.onCall?.();
    return fixtureForQuery(query);
  }

  options.onCall?.();
  const apiKey = options.apiKey ?? process.env.SERPER_API_KEY?.trim();
  if (!apiKey) throw new Error('SERPER_API_KEY is required for live search. Use --fixtures or --dry-run.');

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await withRetry(
    async () => {
      const res = await fetchImpl('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        body: JSON.stringify({
          q: query,
          gl: 'us',
          hl: 'en',
          num: options.num ?? 8,
        }),
      });
      if (!res.ok) {
        throw new SerperError(`Serper failed: ${res.status} ${await res.text()}`, res.status);
      }
      return res;
    },
    {
      maxAttempts: 3,
      baseDelayMs: 1500,
      shouldRetry: (error) => error instanceof SerperError && (error.status === 429 || error.status >= 500),
    },
  );
  return (await response.json()) as SerperResponse;
}
