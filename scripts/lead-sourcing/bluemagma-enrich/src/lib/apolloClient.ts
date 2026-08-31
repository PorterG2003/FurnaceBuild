import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './env.js';
import { withRetry } from './retry.js';
import { normalizeDomain, normalizeLinkedInCompanyUrl } from './types.js';

export type ApolloFundingEvent = {
  id?: string;
  date?: string;
  news_url?: string | null;
  type?: string;
  investors?: string;
  amount?: string;
  currency?: string;
};

export type ApolloOrganization = {
  id?: string;
  name?: string;
  primary_domain?: string;
  linkedin_url?: string;
  estimated_num_employees?: number;
  industry?: string;
  website_url?: string;
  total_funding?: number | null;
  total_funding_printed?: string;
  latest_funding_stage?: string;
  latest_funding_round_date?: string;
  funding_events?: ApolloFundingEvent[];
};

export type FundingFields = {
  total_funding: string;
  total_funding_printed: string;
  latest_funding_stage: string;
  latest_funding_round_date: string;
  funding_events: string;
};

export function fundingFieldsFromOrg(org: ApolloOrganization | null | undefined): FundingFields {
  if (!org) return emptyFundingFields();
  const events = org.funding_events ?? [];
  return {
    total_funding: org.total_funding != null ? String(org.total_funding) : '',
    total_funding_printed: org.total_funding_printed ?? '',
    latest_funding_stage: org.latest_funding_stage ?? '',
    latest_funding_round_date: org.latest_funding_round_date
      ? org.latest_funding_round_date.slice(0, 10)
      : '',
    funding_events: events.length > 0 ? JSON.stringify(events) : '',
  };
}

export function emptyFundingFields(): FundingFields {
  return {
    total_funding: '',
    total_funding_printed: '',
    latest_funding_stage: '',
    latest_funding_round_date: '',
    funding_events: '',
  };
}

export class ApolloError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApolloError';
    this.status = status;
  }
}

export type ApolloClientOptions = {
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  onCall?: () => void;
};

type OrgMap = Record<string, { organization?: ApolloOrganization }>;

let orgMapCache: OrgMap | null = null;

function loadOrgMap(): OrgMap {
  if (orgMapCache) return orgMapCache;
  const path = join(fixturesDir, 'apollo', 'org-enrich.json');
  if (!existsSync(path)) {
    orgMapCache = {};
    return orgMapCache;
  }
  orgMapCache = JSON.parse(readFileSync(path, 'utf8')) as OrgMap;
  return orgMapCache;
}

function lookupKeys(params: { domain?: string; name?: string; linkedinUrl?: string }): string[] {
  const keys: string[] = [];
  if (params.linkedinUrl) {
    keys.push(normalizeLinkedInCompanyUrl(params.linkedinUrl));
    keys.push(params.linkedinUrl.trim().toLowerCase().replace(/\/+$/, ''));
  }
  if (params.domain) keys.push(normalizeDomain(params.domain) || params.domain.toLowerCase());
  if (params.name) keys.push(params.name.trim().toLowerCase());
  return keys.filter(Boolean);
}

function fixtureOrg(params: { domain?: string; name?: string; linkedinUrl?: string }): ApolloOrganization | null {
  const map = loadOrgMap();
  for (const key of lookupKeys(params)) {
    const hit = map[key];
    if (hit?.organization) return hit.organization;
  }
  return null;
}

async function apolloPost<T>(
  path: string,
  body: Record<string, unknown>,
  options: ApolloClientOptions,
): Promise<T> {
  options.onCall?.();
  const fetchImpl = options.fetchImpl ?? fetch;
  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY is required when fixtures are not enabled');

  return withRetry(async () => {
    const response = await fetchImpl(`https://api.apollo.io/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new ApolloError(`Apollo request failed: ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  });
}

export type EnrichOrgResult = {
  organization: ApolloOrganization | null;
  raw: Record<string, unknown> | null;
};

export async function enrichOrganization(
  params: { domain?: string; name?: string; linkedinUrl?: string },
  options: ApolloClientOptions = {},
): Promise<ApolloOrganization | null> {
  const { organization } = await enrichOrganizationRaw(params, options);
  return organization;
}

export async function enrichOrganizationRaw(
  params: { domain?: string; name?: string; linkedinUrl?: string },
  options: ApolloClientOptions = {},
): Promise<EnrichOrgResult> {
  if (options.useFixtures) {
    options.onCall?.();
    const org = fixtureOrg(params);
    return { organization: org, raw: org ? (org as unknown as Record<string, unknown>) : null };
  }

  const body: Record<string, unknown> = {};
  if (params.domain) body.domain = params.domain;
  if (params.name) body.name = params.name;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

  const response = await apolloPost<{ organization?: Record<string, unknown> }>(
    '/organizations/enrich',
    body,
    options,
  );
  const raw = response.organization ?? null;
  return {
    organization: raw as unknown as ApolloOrganization | null,
    raw,
  };
}
