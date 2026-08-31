import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCached, requestHash, writeCached } from '../lib/cache.js';
import { fixturesDir } from '../lib/env.js';
import { HttpStatusError, RequestGate, parseRetryAfterMs } from '../lib/retry.js';
import type { CompanyRecord, PipelineContext } from '../types.js';
import type { PersonHit } from './gtm.js';

const PEOPLE_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';

const SALES_TITLES = ['SDR', 'BDR', 'sales development', 'account executive', 'account manager'];
const OM_TITLES = [
  'demand generation',
  'marketing automation',
  'outbound marketing',
  'email marketing',
  'growth marketing',
];
const WEBINAR_TITLES = ['webinar', 'event marketing', 'events manager'];
const DM_TITLES = ['founder', 'ceo', 'cmo', 'cro', 'vp sales', 'head of sales', 'director of sales'];

function fixturePeople(orgId: string, domain: string | null): PersonHit[] {
  const path = join(fixturesDir, 'apollo', 'people-search.json');
  if (!existsSync(path)) return [];
  const map = JSON.parse(readFileSync(path, 'utf8')) as Record<string, PersonHit[]>;
  return map[orgId] ?? (domain ? map[domain] : undefined) ?? map.default ?? [];
}

async function searchTitles(
  ctx: PipelineContext,
  gate: RequestGate,
  company: CompanyRecord,
  titles: string[],
): Promise<PersonHit[]> {
  const request = {
    q_organization_domains_list: company.domain ? [company.domain] : undefined,
    organization_ids: company.apollo_org_id && !company.domain ? [company.apollo_org_id] : undefined,
    person_titles: titles,
    per_page: 25,
    page: 1,
  };

  if (ctx.fixtures) {
    const people = fixturePeople(company.apollo_org_id ?? '', company.domain);
    writeCached(ctx.cacheRoot, 'apollo-people', request, people);
    return people;
  }

  const cached = readCached<PersonHit[]>(ctx.cacheRoot, 'apollo-people', request);
  if (cached) return cached.body;

  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY required for people search');

  const people = await gate.schedule(async () => {
    const body: Record<string, unknown> = {
      page: 1,
      per_page: 25,
      person_titles: titles,
      person_locations: ['United States'],
    };
    if (company.domain) body.q_organization_domains_list = [company.domain];
    else if (company.apollo_org_id) body.organization_ids = [company.apollo_org_id];
    else return [];

    const response = await fetch(PEOPLE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new HttpStatusError(
        `Apollo people search ${response.status}`,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    const json = (await response.json()) as { people?: PersonHit[] };
    return json.people ?? [];
  });

  writeCached(ctx.cacheRoot, 'apollo-people', request, people);
  void requestHash;
  return people;
}

export async function searchCompanyPeople(
  ctx: PipelineContext,
  gate: RequestGate,
  company: CompanyRecord,
): Promise<PersonHit[]> {
  if (!company.domain && !company.apollo_org_id) return [];
  const salesAndDm = [...SALES_TITLES, ...DM_TITLES];
  const omAndWebinar = [...OM_TITLES, ...WEBINAR_TITLES];
  const [groupA, groupB] = await Promise.all([
    searchTitles(ctx, gate, company, salesAndDm),
    searchTitles(ctx, gate, company, omAndWebinar),
  ]);
  const seen = new Set<string>();
  const merged: PersonHit[] = [];
  for (const person of [...groupA, ...groupB]) {
    const key = `${person.title ?? ''}|${JSON.stringify(person)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(person);
  }
  return merged;
}
