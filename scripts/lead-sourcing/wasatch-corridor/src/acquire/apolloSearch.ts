import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCached, requestHash, writeCached } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import { loadJson, writeJson } from '../lib/io.js';
import { HttpStatusError, RequestGate, parseRetryAfterMs } from '../lib/retry.js';
import type { PipelineContext, RawHit } from '../types.js';
import { listApolloShards, type ApolloShard } from './shards.js';

const APOLLO_SEARCH_URL = 'https://api.apollo.io/api/v1/mixed_companies/search';
const PER_PAGE = 100;
const PAGE_CAP = 500;

export type ApolloSearchBody = {
  page: number;
  per_page: number;
  organization_locations: string[];
  organization_num_employees_ranges: string[];
};

type ApolloOrg = Record<string, unknown>;

type ApolloSearchResponse = {
  organizations?: ApolloOrg[];
  accounts?: ApolloOrg[];
  pagination?: { total_pages?: number; page?: number };
};

export type ApolloCheckpoint = {
  shards: Record<string, { next_page: number; done: boolean; pages_fetched: number }>;
  company_count: number;
  pages_fetched: number;
};

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.replace(/[^0-9.-]/g, '') === '') return null;
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function techUids(org: ApolloOrg): string[] {
  const techs = org.current_technologies ?? org.technology_names;
  if (!Array.isArray(techs)) return [];
  return techs
    .map((t) => {
      if (typeof t === 'string') return t.toLowerCase();
      if (t && typeof t === 'object') {
        const rec = t as Record<string, unknown>;
        return str(rec.uid || rec.name || rec.technology).toLowerCase();
      }
      return '';
    })
    .filter(Boolean);
}

export function normalizeApolloRecord(raw: ApolloOrg, sourceBucket: 'organizations' | 'accounts'): {
  orgId: string;
  domain: string | null;
  org: ApolloOrg;
} {
  if (sourceBucket === 'accounts') {
    const orgId = str(raw.organization_id) || str((raw.organization as ApolloOrg | undefined)?.id);
    const domain =
      str(raw.domain) ||
      str((raw.organization as ApolloOrg | undefined)?.primary_domain) ||
      str((raw.organization as ApolloOrg | undefined)?.domain) ||
      null;
    const nested = (raw.organization as ApolloOrg | undefined) ?? raw;
    return { orgId, domain: domain || null, org: { ...nested, ...raw, id: orgId || str(nested.id) } };
  }
  return {
    orgId: str(raw.id),
    domain: str(raw.primary_domain) || str(raw.domain) || null,
    org: raw,
  };
}

export function queryCityFromLocation(location: string): string {
  return location.split(',')[0]?.trim() ?? '';
}

export function apolloOrgToHit(
  org: ApolloOrg,
  orgId: string,
  domain: string | null,
  rawHash: string,
  extra: { query_city?: string; search_employee_band?: string } = {},
): RawHit {
  const street = str(org.street_address) || str(org.raw_address);
  return {
    source: 'apollo',
    name: str(org.name) || str(org.organization_name),
    domain,
    apollo_org_id: orgId || null,
    street,
    city: str(org.city),
    state: str(org.state),
    postal: str(org.postal_code),
    country: str(org.country),
    lat: num(org.latitude),
    lng: num(org.longitude),
    naics: str(org.naics_codes) || (Array.isArray(org.naics_codes) ? org.naics_codes.join(',') : ''),
    industry: str(org.industry),
    employees: num(org.estimated_num_employees) ?? num(org.employee_count),
    revenue_est: num(org.annual_revenue) ?? num(org.organization_revenue),
    founded_year: num(org.founded_year),
    headcount_growth_pct: num(org.organization_headcount_growth) ?? num(org.headcount_growth_12m),
    last_funding_date: str(org.latest_funding_round_date) || str(org.last_funding_date),
    last_funding_amount: num(org.latest_funding_stage_amount) ?? num(org.last_funding_amount),
    current_technologies: techUids(org),
    job_postings_json: org.job_postings ? JSON.stringify(org.job_postings) : '',
    raw_hash: rawHash,
    hq_city: str(org.city),
    hq_state: str(org.state),
    hq_country: str(org.country) || 'United States',
    hq_street: street,
    query_city: extra.query_city ?? '',
    search_employee_band: extra.search_employee_band ?? '',
  };
}

function fixtureResponse(shard: ApolloShard, page: number): ApolloSearchResponse {
  const path = join(fixturesDir, 'apollo', `search-${shard.key.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}-p${page}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as ApolloSearchResponse;
  const fallback = join(fixturesDir, 'apollo', 'search.json');
  const seed = shard.location.startsWith('Lehi,') && shard.employee_band === '11,20' && page === 1;
  if (seed && existsSync(fallback)) return JSON.parse(readFileSync(fallback, 'utf8')) as ApolloSearchResponse;
  return { organizations: [], accounts: [], pagination: { total_pages: 0, page } };
}

async function fetchPage(
  ctx: PipelineContext,
  shard: ApolloShard,
  page: number,
  gate: RequestGate,
): Promise<{ body: ApolloSearchResponse; hash: string; fromCache: boolean }> {
  const request: ApolloSearchBody = {
    page,
    per_page: PER_PAGE,
    organization_locations: [shard.location],
    organization_num_employees_ranges: [shard.employee_band],
  };

  if (ctx.fixtures) {
    const body = fixtureResponse(shard, page);
    const { hash } = writeCached(ctx.cacheRoot, 'apollo', request, body);
    return { body, hash, fromCache: true };
  }

  const cached = readCached<ApolloSearchResponse>(ctx.cacheRoot, 'apollo', request);
  if (cached) return { body: cached.body, hash: requestHash('apollo', request), fromCache: true };

  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY required for live Apollo search');

  const body = await gate.schedule(async () => {
    const response = await fetch(APOLLO_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new HttpStatusError(
        `Apollo mixed_companies/search ${response.status}`,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    return (await response.json()) as ApolloSearchResponse;
  });

  const { hash } = writeCached(ctx.cacheRoot, 'apollo', request, body);
  return { body, hash, fromCache: false };
}

function hitsFromResponse(body: ApolloSearchResponse, hash: string, shard: ApolloShard): RawHit[] {
  const extra = {
    query_city: queryCityFromLocation(shard.location),
    search_employee_band: shard.employee_band,
  };
  const hits: RawHit[] = [];
  for (const org of body.organizations ?? []) {
    const n = normalizeApolloRecord(org, 'organizations');
    if (!n.orgId && !n.domain && !str(n.org.name)) continue;
    hits.push(apolloOrgToHit(n.org, n.orgId, n.domain, hash, extra));
  }
  for (const acct of body.accounts ?? []) {
    const n = normalizeApolloRecord(acct, 'accounts');
    if (!n.orgId && !n.domain && !str(n.org.name)) continue;
    hits.push(apolloOrgToHit(n.org, n.orgId, n.domain, hash, extra));
  }
  return hits;
}

export async function acquireApollo(ctx: PipelineContext): Promise<{ hits: RawHit[]; pagesFetched: number; fromCache: number }> {
  const shards = listApolloShards({ cities: ctx.cities, bands: ctx.bands });
  const checkpointPath = join(ctx.runDir, 'universe', 'apollo_checkpoint.json');
  const checkpoint: ApolloCheckpoint = loadJson<ApolloCheckpoint>(checkpointPath) ?? {
    shards: {},
    company_count: 0,
    pages_fetched: 0,
  };
  const gate = new RequestGate(150, 6);
  const hits: RawHit[] = [];
  let fromCache = 0;
  let livePages = 0;

  for (const shard of shards) {
    const saved = checkpoint.shards[shard.key] ?? { next_page: 1, done: false, pages_fetched: 0 };
    const replay = saved.done;
    const state = replay
      ? { next_page: 1, done: false, pages_fetched: saved.pages_fetched }
      : { ...saved };
    let page = replay ? 1 : state.next_page;
    while (page <= PAGE_CAP) {
      if (ctx.maxApolloCalls != null && livePages >= ctx.maxApolloCalls) {
        writeJson(checkpointPath, checkpoint);
        return { hits, pagesFetched: checkpoint.pages_fetched, fromCache };
      }
      if (ctx.maxRows != null && hits.length >= ctx.maxRows) {
        writeJson(checkpointPath, checkpoint);
        return { hits, pagesFetched: checkpoint.pages_fetched, fromCache };
      }
      const { body, hash, fromCache: cached } = await fetchPage(ctx, shard, page, gate);
      if (cached) fromCache += 1;
      else livePages += 1;
      const pageHits = hitsFromResponse(body, hash, shard);
      hits.push(...pageHits);
      if (!replay) {
        checkpoint.pages_fetched += 1;
        state.pages_fetched += 1;
      }
      const totalPages = body.pagination?.total_pages ?? (pageHits.length < PER_PAGE ? page : page + 1);
      if (pageHits.length === 0 || page >= totalPages) {
        state.done = true;
        state.next_page = page + 1;
        checkpoint.shards[shard.key] = {
          ...state,
          pages_fetched: replay ? saved.pages_fetched : state.pages_fetched,
        };
        break;
      }
      page += 1;
      state.next_page = page;
      if (!replay) checkpoint.shards[shard.key] = state;
    }
    checkpoint.shards[shard.key] = {
      next_page: state.next_page,
      done: true,
      pages_fetched: replay ? saved.pages_fetched : state.pages_fetched,
    };
    checkpoint.company_count = hits.length;
    writeJson(checkpointPath, checkpoint);
  }

  checkpoint.company_count = hits.length;
  writeJson(checkpointPath, checkpoint);
  return { hits, pagesFetched: checkpoint.pages_fetched, fromCache };
}
