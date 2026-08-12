import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from '../lib/env.js';
import { withRetry } from '../lib/retry.js';
import type { CallCounter } from '../lib/callCounter.js';
import type { ContactTiersConfig } from '../lib/config.js';
import { pickContactSlots, type ContactSlot } from '../stage4-contacts/contactTier.js';

export type ApolloOrganization = {
  id?: string;
  name?: string;
  primary_domain?: string;
  linkedin_url?: string;
  estimated_num_employees?: number;
  industry?: string;
  website_url?: string;
  city?: string;
  state?: string;
  country?: string;
};

export type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: ApolloOrganization;
};

export type PersonLocation = {
  city: string;
  state: string;
  country: string;
};

export function extractPersonLocation(person: ApolloPerson | null | undefined): PersonLocation {
  const city = (person?.city ?? person?.organization?.city ?? '').trim();
  const state = (person?.state ?? person?.organization?.state ?? '').trim();
  const country = (person?.country ?? person?.organization?.country ?? '').trim();
  return { city, state, country };
}

export type ApolloClientOptions = {
  apiKey?: string;
  useFixtures?: boolean;
  fetchImpl?: typeof fetch;
  counter?: CallCounter;
};

export class ApolloError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApolloError';
    this.status = status;
  }
}

function fixtureFor(kind: string, key: string): string {
  const safe = key.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).toLowerCase();
  const specific = join(fixturesDir, 'apollo', `${kind}-${safe}.json`);
  if (existsSync(specific)) return specific;
  return join(fixturesDir, 'apollo', `${kind}.json`);
}

function readFixture(kind: string, key: string): unknown {
  return JSON.parse(readFileSync(fixtureFor(kind, key), 'utf8'));
}

function withPeopleEmailEnrichParams(path: string): string {
  // reveal_personal_emails unlocks work/personal emails synchronously.
  // run_waterfall_email requires an async webhook_url and is not used here.
  if (path.includes('reveal_personal_emails=')) return path;
  return `${path}${path.includes('?') ? '&' : '?'}reveal_personal_emails=true`;
}

async function apolloPost<T>(
  path: string,
  body: Record<string, unknown>,
  options: ApolloClientOptions,
  counterKey?: 'apollo_org_calls' | 'apollo_people_calls',
  counterBy = 1,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;

  if (counterKey) options.counter?.increment(counterKey, counterBy);

  if (options.useFixtures) {
    const orgIds = body.organization_ids as string[] | undefined;
    const nameKey =
      body.first_name || body.last_name
        ? `${String(body.first_name ?? '')}-${String(body.last_name ?? '')}`.trim()
        : '';
    const lookupKey = String(
      orgIds?.[0] ||
        body.domain ||
        body.name ||
        body.q_organization_name ||
        body.linkedin_url ||
        body.q_keywords ||
        nameKey ||
        'default',
    );

    if (path.includes('people/bulk_match')) {
      return readFixture('people-search', String((body.details as Array<{ id?: string }>)?.[0]?.id ?? 'default')) as T;
    }
    if (path.includes('people/match')) {
      return readFixture('people-match', lookupKey) as T;
    }
    if (path.includes('mixed_people')) {
      return readFixture('people-search', lookupKey) as T;
    }
    if (path.includes('organizations/search')) {
      const data = readFixture('org-enrich', lookupKey) as { organization?: ApolloOrganization };
      return {
        organizations: data.organization ? [data.organization] : [],
      } as T;
    }
    return readFixture('org-enrich', lookupKey) as T;
  }

  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY is required when USE_FIXTURES is not enabled');
  }

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

export async function enrichOrganization(
  params: { domain?: string; name?: string; linkedinUrl?: string },
  options: ApolloClientOptions = {},
): Promise<ApolloOrganization | null> {
  const body: Record<string, unknown> = {};
  if (params.domain) body.domain = params.domain;
  if (params.name) body.name = params.name;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

  const response = await apolloPost<{ organization?: ApolloOrganization }>(
    '/organizations/enrich',
    body,
    options,
    'apollo_org_calls',
  );
  return response.organization ?? null;
}

export async function searchOrganization(
  params: { name: string; linkedinUrl?: string },
  options: ApolloClientOptions = {},
): Promise<ApolloOrganization | null> {
  const body: Record<string, unknown> = {
    q_organization_name: params.name,
    page: 1,
    per_page: 1,
  };
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;

  const response = await apolloPost<{ organizations?: ApolloOrganization[] }>(
    '/organizations/search',
    body,
    options,
    'apollo_org_calls',
  );
  return response.organizations?.[0] ?? null;
}

type ApiSearchPerson = {
  id: string;
  first_name?: string;
  title?: string;
  has_email?: boolean;
};

function buildApiSearchUrl(params: {
  organizationId: string;
  titles?: string[];
  seniorities?: string[];
  perPage: number;
}): string {
  const url = new URL('https://api.apollo.io/api/v1/mixed_people/api_search');
  url.searchParams.append('organization_ids[]', params.organizationId);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', String(params.perPage));
  for (const title of params.titles ?? []) {
    url.searchParams.append('person_titles[]', title);
  }
  for (const seniority of params.seniorities ?? []) {
    url.searchParams.append('person_seniorities[]', seniority);
  }
  return url.toString();
}

async function apolloPeopleApiSearch(
  params: {
    organizationId: string;
    titles?: string[];
    seniorities?: string[];
    perPage?: number;
  },
  options: ApolloClientOptions,
): Promise<ApiSearchPerson[]> {
  const perPage = params.perPage ?? 10;

  if (options.useFixtures) {
    const data = readFixture('people-search', params.organizationId) as {
      people?: ApolloPerson[];
    };
    return (data.people ?? []).map((person) => ({
      id: person.id ?? '',
      first_name: person.first_name,
      title: person.title,
      has_email: Boolean(person.email?.includes('@')),
    }));
  }

  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('APOLLO_API_KEY is required when USE_FIXTURES is not enabled');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  return withRetry(async () => {
    const response = await fetchImpl(buildApiSearchUrl({ ...params, perPage }), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
    });
    if (!response.ok) {
      throw new ApolloError(`Apollo request failed: ${response.status}`, response.status);
    }
    const data = (await response.json()) as { people?: ApiSearchPerson[] };
    return data.people ?? [];
  });
}

async function bulkMatchPeople(
  ids: string[],
  options: ApolloClientOptions,
  organizationId?: string,
): Promise<ApolloPerson[]> {
  if (ids.length === 0) return [];

  if (options.useFixtures) {
    const pools: ApolloPerson[] = [];
    if (organizationId) {
      const data = readFixture('people-search', organizationId) as { people?: ApolloPerson[] };
      pools.push(...(data.people ?? []));
    }
    const byId = new Map(pools.filter((person) => person.id).map((person) => [person.id!, person]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as ApolloPerson[];
  }

  const response = await apolloPost<{ matches?: ApolloPerson[] }>(
    withPeopleEmailEnrichParams('/people/bulk_match'),
    { details: ids.map((id) => ({ id })) },
    options,
    'apollo_people_calls',
    ids.length,
  );
  return response.matches ?? [];
}

export async function enrichPeopleByIds(
  ids: string[],
  options: ApolloClientOptions = {},
  organizationId?: string,
): Promise<ApolloPerson[]> {
  return bulkMatchPeople(ids, options, organizationId);
}

export type SearchPeopleResult = {
  people: ApolloPerson[];
  slots: ContactSlot[];
};

export async function searchPeopleByOrganization(
  params: {
    organizationId: string;
    perPage?: number;
    matchLimit?: number;
    contactTiers: ContactTiersConfig;
    excludeIds?: string[];
    posterId?: string;
    posterTitle?: string;
  },
  options: ApolloClientOptions = {},
): Promise<SearchPeopleResult> {
  const perPage = params.perPage ?? 10;
  const matchLimit = params.matchLimit ?? perPage;
  const excludeIds = new Set(params.excludeIds ?? []);
  const candidates = (await apolloPeopleApiSearch(
    { organizationId: params.organizationId, perPage },
    options,
  )).filter((person) => person.id && !excludeIds.has(person.id));

  const slots = pickContactSlots(candidates, matchLimit, params.contactTiers, {
    posterId: params.posterId,
    posterTitle: params.posterTitle,
  }).filter((slot) => slot.tier !== 'poster');

  const ids = slots.map((slot) => slot.id);
  const people = await bulkMatchPeople(ids, options, params.organizationId);
  return { people, slots };
}

export async function searchPersonByLinkedIn(
  linkedinUrl: string,
  options: ApolloClientOptions = {},
): Promise<ApolloPerson | null> {
  const response = await apolloPost<{ people?: ApolloPerson[]; contacts?: ApolloPerson[] }>(
    '/mixed_people/search',
    {
      q_keywords: linkedinUrl,
      page: 1,
      per_page: 1,
    },
    options,
    'apollo_people_calls',
  );
  return response.people?.[0] ?? response.contacts?.[0] ?? null;
}

export async function enrichPersonByLinkedIn(
  linkedinUrl: string,
  options: ApolloClientOptions = {},
): Promise<ApolloPerson | null> {
  const response = await apolloPost<{ person?: ApolloPerson }>(
    withPeopleEmailEnrichParams('/people/match'),
    { linkedin_url: linkedinUrl },
    options,
    'apollo_people_calls',
  );
  return response.person ?? null;
}

/**
 * People match for location only — does not reveal emails (cheaper / no email credit burn).
 * Prefer LinkedIn URL; fall back to email when LinkedIn is missing.
 */
export async function matchPersonForLocation(
  params: { linkedinUrl?: string; email?: string },
  options: ApolloClientOptions = {},
): Promise<ApolloPerson | null> {
  const linkedinUrl = params.linkedinUrl?.trim();
  const email = params.email?.trim().toLowerCase();
  const body: Record<string, unknown> = {};
  if (linkedinUrl) body.linkedin_url = linkedinUrl;
  else if (email) body.email = email;
  else return null;

  const response = await apolloPost<{ person?: ApolloPerson }>(
    '/people/match',
    body,
    options,
    'apollo_people_calls',
  );
  return response.person ?? null;
}

export async function enrichPersonByName(
  params: {
    firstName: string;
    lastName: string;
    organizationName?: string;
    title?: string;
    linkedinUrl?: string;
    domain?: string;
  },
  options: ApolloClientOptions = {},
): Promise<ApolloPerson | null> {
  const body: Record<string, unknown> = {
    first_name: params.firstName,
    last_name: params.lastName,
  };
  if (params.organizationName) body.organization_name = params.organizationName;
  if (params.title) body.title = params.title;
  if (params.linkedinUrl) body.linkedin_url = params.linkedinUrl;
  if (params.domain) body.domain = params.domain;

  const response = await apolloPost<{ person?: ApolloPerson }>(
    withPeopleEmailEnrichParams('/people/match'),
    body,
    options,
    'apollo_people_calls',
  );
  return response.person ?? null;
}

/** Match person by LinkedIn URL: people/match first, then keyword search fallback. */
export async function matchPersonByLinkedIn(
  linkedinUrl: string,
  options: ApolloClientOptions = {},
): Promise<ApolloPerson | null> {
  const matched = await enrichPersonByLinkedIn(linkedinUrl, options);
  if (matched) return matched;
  return searchPersonByLinkedIn(linkedinUrl, options);
}

export function mapOrganization(org: ApolloOrganization | null): {
  company_name: string;
  company_domain: string;
  company_linkedin_url: string;
  employee_count: string;
  industry: string;
  apollo_org_id: string;
} {
  return {
    company_name: org?.name ?? '',
    company_domain: org?.primary_domain ?? '',
    company_linkedin_url: org?.linkedin_url ?? '',
    employee_count: org?.estimated_num_employees != null ? String(org.estimated_num_employees) : '',
    industry: org?.industry ?? '',
    apollo_org_id: org?.id ?? '',
  };
}

export function pickBestContact(people: ApolloPerson[]): ApolloPerson | null {
  if (people.length === 0) return null;
  const withEmail = people.filter((p) => p.email?.includes('@'));
  return withEmail[0] ?? people[0] ?? null;
}

export function splitName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0]!, last_name: '' };
  return { first_name: parts[0]!, last_name: parts.slice(1).join(' ') };
}
