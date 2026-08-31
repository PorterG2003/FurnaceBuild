import { join } from 'node:path';
import { apolloOrgToHit } from '../acquire/apolloSearch.js';
import { readCached, requestHash, writeCached } from '../lib/cache.js';
import { writeJson } from '../lib/io.js';
import { HttpStatusError, RequestGate, parseRetryAfterMs } from '../lib/retry.js';
import { stamp } from '../universe/normalize.js';
import { sequencerFromTech } from './gtm.js';
import type { CompanyRecord, PipelineContext } from '../types.js';

const ENRICH_URL = 'https://api.apollo.io/api/v1/organizations/enrich';

type ApolloOrg = Record<string, unknown>;

function prefer<T>(current: T, next: T, empty: T): T {
  if (current !== empty && current != null) return current;
  return next;
}

export function enrichRequest(company: CompanyRecord): Record<string, unknown> | null {
  if (company.domain) return { domain: company.domain };
  if (company.apollo_org_id) return { id: company.apollo_org_id };
  if (company.name) return { name: company.name };
  return null;
}

export function applyEnrichedOrg(company: CompanyRecord, org: ApolloOrg, hash: string): CompanyRecord {
  const hit = apolloOrgToHit(
    org,
    String(org.id ?? company.apollo_org_id ?? ''),
    (typeof org.primary_domain === 'string' && org.primary_domain) ||
      (typeof org.domain === 'string' && org.domain) ||
      company.domain,
    hash,
  );
  const next: CompanyRecord = {
    ...company,
    apollo_org_id: company.apollo_org_id || hit.apollo_org_id,
    domain: company.domain || hit.domain,
    street: prefer(company.street, hit.street, ''),
    city: prefer(company.city, hit.city, ''),
    state: prefer(company.state, hit.state, ''),
    postal: prefer(company.postal, hit.postal, ''),
    lat: company.lat ?? hit.lat,
    lng: company.lng ?? hit.lng,
    naics: prefer(company.naics, hit.naics, ''),
    industry: prefer(company.industry, hit.industry, ''),
    employees: company.employees ?? hit.employees,
    revenue_est: company.revenue_est && company.revenue_est > 0 ? company.revenue_est : hit.revenue_est,
    founded_year: company.founded_year ?? hit.founded_year,
    headcount_growth_pct: company.headcount_growth_pct ?? hit.headcount_growth_pct,
    last_funding_date: prefer(company.last_funding_date, hit.last_funding_date, ''),
    last_funding_amount: company.last_funding_amount ?? hit.last_funding_amount,
    current_technologies:
      company.current_technologies.length > 0 ? company.current_technologies : hit.current_technologies,
    job_postings_json: prefer(company.job_postings_json, hit.job_postings_json, ''),
    hq_address: prefer(
      company.hq_address,
      [hit.hq_street || hit.street, hit.hq_city || hit.city, hit.hq_state || hit.state].filter(Boolean).join(', '),
      '',
    ),
  };
  next.provenance.employees = stamp('apollo-enrich', hash);
  next.provenance.street = stamp('apollo-enrich', hash);
  if (sequencerFromTech(next.current_technologies)) {
    next.sequencer_detected = true;
    next.sequencer_orphaned = !next.outbound_marketer_detected;
  }
  return next;
}

async function enrichOne(
  ctx: PipelineContext,
  gate: RequestGate,
  company: CompanyRecord,
): Promise<{ org: ApolloOrg | null; fromCache: boolean; hash: string; skipped: boolean }> {
  const request = enrichRequest(company);
  if (!request) return { org: null, fromCache: false, hash: '', skipped: true };

  if (ctx.fixtures) {
    const { hash } = writeCached(ctx.cacheRoot, 'apollo-org-enrich', request, { organization: null });
    return { org: null, fromCache: true, hash, skipped: false };
  }

  const cached = readCached<{ organization?: ApolloOrg | null }>(ctx.cacheRoot, 'apollo-org-enrich', request);
  if (cached) {
    return {
      org: cached.body.organization ?? null,
      fromCache: true,
      hash: requestHash('apollo-org-enrich', request),
      skipped: false,
    };
  }

  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY required for org enrich');

  const organization = await gate.schedule(async () => {
    const response = await fetch(ENRICH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      throw new HttpStatusError(
        `Apollo organizations/enrich ${response.status}`,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    const json = (await response.json()) as { organization?: ApolloOrg };
    return json.organization ?? null;
  });

  const { hash } = writeCached(ctx.cacheRoot, 'apollo-org-enrich', request, { organization });
  return { org: organization, fromCache: false, hash, skipped: false };
}

export async function enrichOrganizations(
  ctx: PipelineContext,
  companies: CompanyRecord[],
): Promise<{ companies: CompanyRecord[]; liveCalls: number; fromCache: number; skipped: number }> {
  const gate = new RequestGate(150, 6);
  const out: CompanyRecord[] = [];
  let liveCalls = 0;
  let fromCache = 0;
  let skipped = 0;
  const checkpointPath = join(ctx.runDir, 'enrichment', 'org_enrich_checkpoint.json');

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    if (ctx.maxOrgEnrich != null && liveCalls >= ctx.maxOrgEnrich) {
      out.push(company);
      skipped += 1;
      continue;
    }
    try {
      const request = enrichRequest(company);
      const cached =
        request && !ctx.fixtures
          ? readCached<{ organization?: ApolloOrg | null }>(ctx.cacheRoot, 'apollo-org-enrich', request)
          : null;
      if (!cached && !ctx.fixtures && request) liveCalls += 1;
      const result = await enrichOne(ctx, gate, company);
      if (result.skipped) skipped += 1;
      else if (result.fromCache) fromCache += 1;
      const next = result.org
        ? applyEnrichedOrg(company, result.org, result.hash)
        : stampTried(company, result.hash);
      out.push(next);
      if ((i + 1) % 25 === 0 || i + 1 === companies.length) {
        console.error(
          `[org-enrich] ${i + 1}/${companies.length} live=${liveCalls} cache=${fromCache} streets=${out.filter((c) => c.street).length}`,
        );
        writeJson(checkpointPath, { next_index: i + 1, liveCalls, fromCache, skipped });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[org-enrich] failed ${company.name}: ${message}`);
      out.push(company);
    }
  }
  writeJson(checkpointPath, { next_index: companies.length, liveCalls, fromCache, skipped, done: true });
  return { companies: out, liveCalls, fromCache, skipped };
}

function stampTried(company: CompanyRecord, hash: string): CompanyRecord {
  const next = { ...company, provenance: { ...company.provenance } };
  next.provenance.employees = stamp('apollo-enrich', hash || 'miss');
  return next;
}
