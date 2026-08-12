/**
 * Prospeo search-person client for webinar outreach enrichment.
 * Enrich uses shared lib/prospeo/prospeoClient.ts.
 */

import {
  ProspeoError,
  enrichPerson,
  type EnrichProspeoPersonInput,
  type ProspeoClientOptions,
  type ProspeoEnrichResponse,
  type ProspeoPerson,
} from '../../../../lib/prospeo/prospeoClient.js';

const PROSPEO_SEARCH_URL = 'https://api.prospeo.io/search-person';

export type ProspeoSearchFilters = Record<string, unknown>;

export type ProspeoSearchResponse = {
  error?: boolean;
  error_code?: string;
  free?: boolean;
  results?: Array<{
    person?: ProspeoPerson | null;
    company?: { name?: string | null; website?: string | null; domain?: string | null } | null;
  }>;
  pagination?: {
    current_page?: number;
    per_page?: number;
    total_page?: number;
    total_count?: number;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status =
        error && typeof error === 'object' && 'status' in error
          ? (error as { status: number }).status
          : 0;
      if (attempt >= maxAttempts || (status !== 429 && status < 500)) {
        throw error;
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export async function searchPerson(
  filters: ProspeoSearchFilters,
  options: ProspeoClientOptions & { page?: number } = {},
): Promise<ProspeoSearchResponse | null> {
  const apiKey = options.apiKey ?? process.env.PROSPEO_API_KEY?.trim();
  if (!apiKey) throw new Error('PROSPEO_API_KEY is required');

  const fetchImpl = options.fetchImpl ?? fetch;
  const page = options.page ?? 1;

  return withRetry(
    async () => {
      const response = await fetchImpl(PROSPEO_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KEY': apiKey,
        },
        body: JSON.stringify({ page, filters }),
      });

      const json = (await response.json().catch(() => ({}))) as ProspeoSearchResponse & {
        message?: string;
      };

      if (response.status === 429) {
        throw new ProspeoError('Prospeo rate limit exceeded', 429, 'RATE_LIMIT');
      }

      if (!response.ok || json.error === true) {
        const code = json.error_code ?? (response.ok ? 'UNKNOWN' : undefined);
        if (code === 'NO_RESULTS') return null;
        throw new ProspeoError(
          `Prospeo search failed: ${response.status}${code ? ` ${code}` : ''}`,
          response.status,
          code,
        );
      }

      if (!json.results?.length) return null;
      return json;
    },
    {
      maxAttempts: options.maxAttempts ?? 6,
      baseDelayMs: options.baseDelayMs ?? 2500,
    },
  );
}

export async function enrichPersonEmailOnly(
  input: EnrichProspeoPersonInput,
  options: ProspeoClientOptions = {},
): Promise<ProspeoEnrichResponse | null> {
  return enrichPerson(
    {
      ...input,
      onlyVerifiedEmail: true,
      enrichMobile: false,
    },
    {
      ...options,
      maxAttempts: options.maxAttempts ?? 6,
      baseDelayMs: options.baseDelayMs ?? 2500,
    },
  );
}

export function companySearchFilters(opts: {
  website?: string;
  companyName?: string;
  mode: 'founder' | 'marketing';
}): ProspeoSearchFilters {
  const company: Record<string, unknown> = {};
  if (opts.website) {
    company.websites = { include: [opts.website] };
  } else if (opts.companyName) {
    company.names = { include: [opts.companyName] };
  }

  if (opts.mode === 'founder') {
    return {
      company,
      person_seniority: {
        include: ['Founder/Owner'],
      },
    };
  }

  return {
    company,
    person_job_title: {
      include: [
        'founder',
        'ceo',
        'owner',
        'chief marketing',
        'vp marketing',
        'head of marketing',
        'director of marketing',
        'demand gen',
        'demand generation',
        'growth',
      ],
      match_mode: 'CONTAINS',
    },
  };
}

export { enrichPerson, ProspeoError };
export type { ProspeoEnrichResponse, ProspeoPerson, EnrichProspeoPersonInput };
