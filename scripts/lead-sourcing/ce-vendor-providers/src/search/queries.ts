import type { QueriesConfig } from '../lib/config.js';

export function buildSearchQueries(config: QueriesConfig, mode: 'host' | 'grant', wave = 1): string[] {
  const phrases = mode === 'host' ? config.host_phrases : config.grant_phrases;
  const credit = mode === 'host' ? config.credit_terms.slice(0, 4) : [];
  const queries: string[] = [];

  for (const phrase of phrases) {
    if (mode === 'host') {
      for (const term of credit) {
        queries.push(`${phrase} "${term}"`);
      }
    } else {
      queries.push(phrase);
    }
  }

  if (wave >= 1) {
    const extras = mode === 'host' ? config.host_modifiers.specialties : [];
    for (const phrase of phrases.slice(0, 3)) {
      for (const extra of extras) {
        queries.push(`${phrase} ${extra}`);
      }
    }
  }

  if (wave >= 2) {
    for (const phrase of phrases.slice(0, 2)) {
      for (const year of config.host_modifiers.years) {
        queries.push(`${phrase} ${year}`);
      }
    }
  }

  return [...new Set(queries)];
}

export function estimateSerperCredits(queryCount: number, pagesPerQuery: number): {
  queries: number;
  pagesPerQuery: number;
  credits: number;
  dollars: number;
} {
  const credits = queryCount * pagesPerQuery;
  return {
    queries: queryCount,
    pagesPerQuery,
    credits,
    dollars: Number((credits * 0.001).toFixed(3)),
  };
}
