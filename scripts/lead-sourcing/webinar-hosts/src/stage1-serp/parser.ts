import type { Stage1Row } from '../lib/types.js';
import { rowToRecord } from '../lib/types.js';

const LINKEDIN_POST_RE = /linkedin\.com\/posts\//i;
const LINKEDIN_FEED_UPDATE_RE = /linkedin\.com\/feed\/update\/urn:li:activity:\d+/i;
const ACTIVITY_ID_RE = /(?:-activity-|urn:li:activity:)(\d+)/i;
const SLUG_HINT_RE = /linkedin\.com\/posts\/([^/?#]+?)(?:-activity-|$)/i;

export function extractLinkedInActivityId(url: string): string | null {
  const match = url.match(ACTIVITY_ID_RE);
  return match?.[1] ?? null;
}

export function isLinkedInPostUrl(url: string): boolean {
  if (LINKEDIN_FEED_UPDATE_RE.test(url)) return true;
  return LINKEDIN_POST_RE.test(url) && extractLinkedInActivityId(url) !== null;
}

/** Stable permalink that opens in browser without relying on slug encoding. */
export function toCanonicalLinkedInPostUrl(url: string): string {
  const activityId = extractLinkedInActivityId(url);
  if (activityId) {
    return `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`;
  }
  return normalizeLinkedInUrl(url);
}

export function extractSlugHint(url: string): string {
  const match = url.match(SLUG_HINT_RE);
  if (!match?.[1]) return '';
  return decodeURIComponent(match[1]).replace(/-/g, ' ').replace(/_/g, ' ').trim();
}

export type RawSerpResult = {
  url: string;
  title: string;
  snippet: string;
  searchQuery: string;
  serpPosition: number;
  serpPage: number;
  collectedAt: string;
};

export function filterAndMapSerpResults(results: RawSerpResult[]): Stage1Row[] {
  return results
    .filter((r) => isLinkedInPostUrl(r.url))
    .map((r) =>
      rowToRecord({
        result_url: toCanonicalLinkedInPostUrl(r.url),
        result_title: r.title,
        result_snippet: r.snippet,
        search_query: r.searchQuery,
        serp_position: r.serpPosition,
        serp_page: r.serpPage,
        collected_at: r.collectedAt,
        slug_hint: extractSlugHint(r.url),
        also_matched_queries: '',
      }),
    );
}

export function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url.trim();
  }
}

export function dedupeStage1Rows(rows: Stage1Row[]): Stage1Row[] {
  const byUrl = new Map<string, Stage1Row>();

  for (const row of rows) {
    const key = row.result_url;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, { ...row });
      continue;
    }

    const queries = new Set<string>();
    if (existing.search_query) queries.add(existing.search_query);
    if (row.search_query) queries.add(row.search_query);
    for (const q of (existing.also_matched_queries || '').split('|').filter(Boolean)) {
      queries.add(q);
    }
    for (const q of (row.also_matched_queries || '').split('|').filter(Boolean)) {
      queries.add(q);
    }
    queries.delete(existing.search_query);
    existing.also_matched_queries = [...queries].join('|');
  }

  return [...byUrl.values()];
}

export function linkedInFixtureKey(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('blocked')) return 'post-blocked';
  if (lower.includes('tiny-co') || lower.includes('tiny_co')) return 'post-tiny';
  if (lower.includes('acme')) return 'post-company';
  if (lower.includes('jane')) return 'post-person';
  return 'post-company';
}
