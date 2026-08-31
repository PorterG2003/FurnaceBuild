import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { STREET_PROSPECT_COLUMNS } from './streets.js';
import { enrichOrganizations } from './orgEnrich.js';
import { readCached, writeCached } from '../lib/cache.js';
import { cell, readCsv, writeCsv } from '../lib/csv.js';
import { ensureEnv } from '../lib/env.js';
import { writeJson } from '../lib/io.js';
import { readJsonl, writeJsonl } from '../lib/jsonl.js';
import { requireLiveForPaid } from '../lib/cli.js';
import { HttpStatusError, RequestGate, parseRetryAfterMs } from '../lib/retry.js';
import type { CompanyRecord, PipelineContext } from '../types.js';

const PEOPLE_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';
const PER_PAGE = 15;
const MAX_PEOPLE = 2;

const PERSON_TITLES = [
  'CMO',
  'Chief Marketing Officer',
  'VP of Marketing',
  'Vice President of Marketing',
  'VP Marketing',
  'Head of Marketing',
  'Director of Marketing',
  'President of Marketing',
  'Marketing Lead',
  'Lead Marketer',
  'Head of Growth',
  'VP of Growth',
  'CEO',
  'Chief Executive Officer',
  'Founder',
  'Co-Founder',
  'Cofounder',
  'Owner',
  'President',
  'COO',
  'Chief Operating Officer',
  'General Manager',
  'GM',
  'Managing Partner',
];

export const CONTACT_WALK_COLUMNS = [
  ...STREET_PROSPECT_COLUMNS,
  'headcount_band',
  'person_1_name',
  'person_1_title',
  'person_2_name',
  'person_2_title',
  'technologies',
  'last_funding',
] as const;

export type AskRole = 'marketing' | 'executive' | 'ops' | 'skip';

export type AskPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  linkedin_url?: string;
};

export type PickedAsk = {
  name: string;
  title: string;
  role: AskRole;
  linkedin_url: string;
};

export type ContactSidecarRow = {
  company_id: string;
  name: string;
  domain: string;
  headcount_band: string;
  employees: number | null;
  person_1_name: string;
  person_1_title: string;
  person_2_name: string;
  person_2_title: string;
  technologies: string;
  last_funding: string;
  people_searches: number;
  org_enriched: boolean;
};

export type PeopleSearchFn = (company: CompanyRecord) => Promise<AskPerson[]>;

const SKIP_RE =
  /\b(sdr|bdr|sales development|account executive|account exec|\bae\b|coordinator|specialist|inside sales|sales rep|sales representative|customer success|engineer)\b/i;

export function friendlyHeadcountBand(band: string | undefined): string {
  const raw = (band ?? '').trim();
  const [lo, hi] = raw.split(',');
  if (lo && hi) return `${lo.trim()}-${hi.trim()}`;
  return raw;
}

export function classifyAskRole(title: string | undefined): AskRole {
  const value = (title ?? '').trim();
  if (!value) return 'skip';
  if (SKIP_RE.test(value)) return 'skip';
  if (/\baccount executive\b/i.test(value) && !/\bchief executive\b/i.test(value)) return 'skip';

  if (/\b(cmo|chief marketing officer)\b/i.test(value)) return 'marketing';
  if (/\bpresident of marketing\b/i.test(value)) return 'marketing';
  if (/\b(marketing lead|lead marketer)\b/i.test(value)) return 'marketing';
  if (/\b(vp|vice president|head of|director)\b/i.test(value) && /\bmarketing\b/i.test(value)) return 'marketing';
  if (/\b(head of growth|vp of growth|vice president of growth|growth lead)\b/i.test(value)) return 'marketing';

  if (/\b(ceo|chief executive officer)\b/i.test(value)) return 'executive';
  if (/\b(co-?founder|founder)\b/i.test(value)) return 'executive';
  if (/\bowner\b/i.test(value) && !/\b(franchise owner|product owner)\b/i.test(value)) return 'executive';
  if (/\bpresident\b/i.test(value) && !/\bvice president\b/i.test(value) && !/\bpresident of\b/i.test(value)) {
    return 'executive';
  }

  if (/\b(coo|chief operating officer)\b/i.test(value)) return 'ops';
  if (/\bgeneral manager\b/i.test(value) || /\bgm\b/i.test(value)) return 'ops';
  if (/\bmanaging partner\b/i.test(value)) return 'ops';
  return 'skip';
}

export function marketingRank(title: string): number {
  if (/\b(cmo|chief marketing officer)\b/i.test(title)) return 100;
  if (/\b(vp|vice president)\b/i.test(title) && /\bmarketing\b/i.test(title)) return 90;
  if (/\bhead of marketing\b/i.test(title)) return 85;
  if (/\bpresident of marketing\b/i.test(title)) return 80;
  if (/\bdirector\b/i.test(title) && /\bmarketing\b/i.test(title)) return 70;
  if (/\b(marketing lead|lead marketer)\b/i.test(title)) return 60;
  if (/\bgrowth\b/i.test(title)) return 50;
  return 10;
}

export function executiveRank(title: string): number {
  if (/\b(ceo|chief executive officer)\b/i.test(title)) return 100;
  if (/\b(co-?founder|founder)\b/i.test(title)) return 90;
  if (/\bpresident\b/i.test(title) && !/\bvice president\b/i.test(title)) return 50;
  if (/\bowner\b/i.test(title)) return 30;
  return 10;
}

export function opsRank(title: string): number {
  if (/\b(coo|chief operating officer)\b/i.test(title)) return 100;
  if (/\bmanaging partner\b/i.test(title)) return 80;
  if (/\bgeneral manager\b/i.test(title) || /\bgm\b/i.test(title)) return 70;
  return 10;
}

export function peopleComplete(row: Pick<ContactSidecarRow, 'person_1_name' | 'person_2_name'> | undefined): boolean {
  return Boolean(row?.person_1_name && row?.person_2_name);
}

export function displayName(person: AskPerson): string {
  const parts = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim();
  if (parts) return parts;
  return (person.name ?? '').trim();
}

function personKey(person: AskPerson, index: number): string {
  if (person.id) return person.id;
  const name = displayName(person).toLowerCase();
  const title = (person.title ?? '').toLowerCase();
  return name || title ? `${name}|${title}` : `idx:${index}`;
}

function toPicked(person: AskPerson, role: AskRole): PickedAsk | null {
  const name = displayName(person);
  const title = (person.title ?? '').trim();
  if (!name || !title) return null;
  return {
    name,
    title,
    role,
    linkedin_url: person.linkedin_url ?? '',
  };
}

export function pickAskFor(people: AskPerson[], limit = MAX_PEOPLE): PickedAsk[] {
  const marketing: Array<{ person: AskPerson; index: number }> = [];
  const executive: Array<{ person: AskPerson; index: number }> = [];
  const ops: Array<{ person: AskPerson; index: number }> = [];
  people.forEach((person, index) => {
    const role = classifyAskRole(person.title);
    if (role === 'marketing') marketing.push({ person, index });
    else if (role === 'executive') executive.push({ person, index });
    else if (role === 'ops') ops.push({ person, index });
  });

  marketing.sort(
    (a, b) => marketingRank(b.person.title ?? '') - marketingRank(a.person.title ?? '') || a.index - b.index,
  );
  executive.sort(
    (a, b) => executiveRank(b.person.title ?? '') - executiveRank(a.person.title ?? '') || a.index - b.index,
  );
  ops.sort((a, b) => opsRank(b.person.title ?? '') - opsRank(a.person.title ?? '') || a.index - b.index);

  const picked: PickedAsk[] = [];
  const used = new Set<string>();

  const take = (
    list: Array<{ person: AskPerson; index: number }>,
    role: AskRole,
    maxFromList = limit,
  ): void => {
    let added = 0;
    for (const row of list) {
      if (picked.length >= limit || added >= maxFromList) return;
      const key = personKey(row.person, row.index);
      if (used.has(key)) continue;
      const slot = toPicked(row.person, role);
      if (!slot) continue;
      used.add(key);
      picked.push(slot);
      added += 1;
    }
  };

  take(marketing, 'marketing', 1);
  take(executive, 'executive');
  take(ops, 'ops');
  take(marketing, 'marketing');
  return picked.slice(0, limit);
}

export function formatLastFunding(date: string, amount: number | null): string {
  if (!date && (amount == null || !Number.isFinite(amount))) return '';
  const amountPart = amount != null && Number.isFinite(amount) && amount > 0 ? ` $${Math.round(amount).toLocaleString('en-US')}` : '';
  return `${date}${amountPart}`.trim();
}

export function formatTechnologies(techs: string[]): string {
  return techs.filter(Boolean).slice(0, 8).join('|');
}

export function printContactsEstimate(options: {
  companies: number;
  people_searches: number;
  org_enrich: number;
}): void {
  const payload = {
    wave: 'contacts',
    vendor: 'Apollo',
    companies: options.companies,
    apollo_org_enrich: options.org_enrich,
    apollo_people_searches_default: options.people_searches,
    apollo_people_searches_worst: options.people_searches * 2,
    apollo_email_reveals: 0,
    note: 'Names and titles only. Skips companies that already have two names. No live spend until --live after explicit spend OK.',
  };
  console.log(JSON.stringify(payload, null, 2));
}

function walkCsvPath(runDir: string): string {
  return join(runDir, 'output', 'orem-provo', 'prospects.csv');
}

function cloneCompany(company: CompanyRecord): CompanyRecord {
  return {
    ...company,
    sources: [...company.sources],
    current_technologies: [...company.current_technologies],
    webinar_pages: [...company.webinar_pages],
    provenance: { ...company.provenance },
  };
}

function peopleRequest(company: CompanyRecord, by: 'org' | 'domain'): Record<string, unknown> {
  const body: Record<string, unknown> = {
    person_titles: PERSON_TITLES,
    person_locations: ['United States'],
    include_similar_titles: true,
    page: 1,
    per_page: PER_PAGE,
  };
  if (by === 'org' && company.apollo_org_id) body.organization_ids = [company.apollo_org_id];
  else if (company.domain) body.q_organization_domains_list = [company.domain];
  return body;
}

function parsePeople(json: { people?: AskPerson[] }): AskPerson[] {
  return (json.people ?? []).map((person) => ({
    id: person.id,
    first_name: person.first_name,
    last_name: person.last_name,
    name: person.name,
    title: person.title,
    linkedin_url: person.linkedin_url,
  }));
}

async function searchPeopleLive(
  ctx: PipelineContext,
  gate: RequestGate,
  company: CompanyRecord,
  by: 'org' | 'domain',
  tally: { live: number; cache: number },
): Promise<AskPerson[]> {
  const request = peopleRequest(company, by);
  if ((by === 'org' && !company.apollo_org_id) || (by === 'domain' && !company.domain)) return [];

  const cached = readCached<{ people?: AskPerson[] }>(ctx.cacheRoot, 'apollo-people', request);
  if (cached) {
    tally.cache += 1;
    return parsePeople(cached.body);
  }

  if (ctx.fixtures) {
    writeCached(ctx.cacheRoot, 'apollo-people', request, { people: [] });
    tally.cache += 1;
    return [];
  }

  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY required for people search');

  const people = await gate.schedule(async () => {
    tally.live += 1;
    const response = await fetch(PEOPLE_URL, {
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
        `Apollo people search ${response.status}`,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    return (await response.json()) as { people?: AskPerson[] };
  });
  writeCached(ctx.cacheRoot, 'apollo-people', request, people);
  return parsePeople(people);
}

async function searchAskPeople(
  ctx: PipelineContext,
  gate: RequestGate,
  company: CompanyRecord,
  tally: { live: number; cache: number },
  search?: PeopleSearchFn,
): Promise<{ people: AskPerson[]; searches: number }> {
  if (search) {
    const people = await search(company);
    return { people, searches: 1 };
  }

  let searches = 0;
  let people: AskPerson[] = [];
  if (company.apollo_org_id) {
    people = await searchPeopleLive(ctx, gate, company, 'org', tally);
    searches += 1;
  }
  const picked = pickAskFor(people);
  if (picked.length > 0 || !company.domain) return { people, searches };

  const domainPeople = await searchPeopleLive(ctx, gate, company, 'domain', tally);
  searches += 1;
  const byId = new Map<string, AskPerson>();
  [...people, ...domainPeople].forEach((person, index) => {
    byId.set(personKey(person, index), person);
  });
  return { people: [...byId.values()], searches };
}

function sidecarFrom(
  company: CompanyRecord,
  picked: PickedAsk[],
  searches: number,
  orgEnriched: boolean,
): ContactSidecarRow {
  return {
    company_id: company.company_id,
    name: company.name,
    domain: company.domain ?? '',
    headcount_band: friendlyHeadcountBand(company.search_employee_band),
    employees: company.employees,
    person_1_name: picked[0]?.name ?? '',
    person_1_title: picked[0]?.title ?? '',
    person_2_name: picked[1]?.name ?? '',
    person_2_title: picked[1]?.title ?? '',
    technologies: formatTechnologies(company.current_technologies),
    last_funding: formatLastFunding(company.last_funding_date, company.last_funding_amount),
    people_searches: searches,
    org_enriched: orgEnriched,
  };
}

function mergeSidecar(prior: ContactSidecarRow | undefined, next: ContactSidecarRow): ContactSidecarRow {
  if (!prior) return next;
  return {
    ...next,
    employees: next.employees ?? prior.employees,
    technologies: next.technologies || prior.technologies,
    last_funding: next.last_funding || prior.last_funding,
    org_enriched: prior.org_enriched || next.org_enriched,
  };
}

function overlayWalkRow(row: Record<string, string>, sidecar: ContactSidecarRow, employees: number | null): Record<string, string> {
  return {
    ...row,
    headcount_band: sidecar.headcount_band,
    employees: employees != null ? cell(employees) : row.employees ?? '',
    person_1_name: sidecar.person_1_name,
    person_1_title: sidecar.person_1_title,
    person_2_name: sidecar.person_2_name,
    person_2_title: sidecar.person_2_title,
    technologies: sidecar.technologies,
    last_funding: sidecar.last_funding,
    recent_funding: row.recent_funding,
  };
}

export async function runContacts(
  ctx: PipelineContext,
  options: { search?: PeopleSearchFn; skipOrgEnrich?: boolean } = {},
): Promise<{
  companies: number;
  with_person: number;
  org_live: number;
  people_live: number;
  sidecarPath: string;
  csvPath: string;
}> {
  const csvPath = walkCsvPath(ctx.runDir);
  if (!existsSync(csvPath)) {
    throw new Error(`Walk list not found at ${csvPath}. Run --stage streets first.`);
  }
  let walkRows = readCsv(csvPath);
  if (ctx.maxRows != null) walkRows = walkRows.slice(0, ctx.maxRows);

  const companies = readJsonl<CompanyRecord>(join(ctx.runDir, 'enrichment', 'companies.jsonl'));
  const byDomain = new Map(companies.map((c) => [(c.domain ?? '').toLowerCase(), c]));
  const byName = new Map(companies.map((c) => [c.name.toLowerCase(), c]));

  const work = walkRows.map((row) => {
    const company =
      byDomain.get((row.domain ?? '').toLowerCase()) ?? byName.get((row.company ?? '').toLowerCase());
    return { row, company: company ? cloneCompany(company) : null };
  });
  const withCompany = work.filter((w) => w.company);

  const sidecarPath = join(ctx.runDir, 'enrichment', 'orem_provo_contacts.jsonl');
  const existing = readJsonl<ContactSidecarRow>(sidecarPath);
  const done = new Map(existing.map((row) => [row.company_id, row]));
  const short = withCompany.filter((w) => !peopleComplete(done.get(w.company!.company_id)));

  if (ctx.dryRun && !ctx.fixtures) {
    const orgNeeded = withCompany.filter((w) => !done.has(w.company!.company_id)).length;
    printContactsEstimate({
      companies: withCompany.length,
      people_searches: short.length,
      org_enrich: orgNeeded,
    });
    writeJson(join(ctx.runDir, 'enrichment', 'contacts_dry_run.json'), {
      companies: withCompany.length,
      already_complete: withCompany.length - short.length,
      apollo_org_enrich: orgNeeded,
      apollo_people_searches_default: short.length,
      apollo_people_searches_worst: short.length * 2,
      apollo_email_reveals: 0,
    });
    return {
      companies: withCompany.length,
      with_person: 0,
      org_live: 0,
      people_live: 0,
      sidecarPath,
      csvPath,
    };
  }

  if (!ctx.fixtures && !options.search) {
    requireLiveForPaid({
      live: ctx.live,
      dryRun: ctx.dryRun,
      fixtures: ctx.fixtures,
      vendor: 'Apollo org enrich + people search',
    });
    await ensureEnv({ apollo: true });
    if (!process.env.APOLLO_API_KEY?.trim()) throw new Error('APOLLO_API_KEY is required for contacts.');
  }

  let orgLive = 0;
  const clones = withCompany.map((w) => w.company!) ;
  const byId = new Map(clones.map((c) => [c.company_id, c]));
  if (!options.skipOrgEnrich && clones.length) {
    const enrichable = clones.filter((c) => !done.has(c.company_id));
    if (enrichable.length) {
      const result = await enrichOrganizations(ctx, enrichable);
      orgLive = result.liveCalls;
      for (const company of result.companies) byId.set(company.company_id, company);
    }
  }

  const peopleGate = new RequestGate(150, 6);
  const peopleTally = { live: 0, cache: 0 };
  const outRows: Record<string, string>[] = [];
  let withPerson = 0;
  let i = 0;

  for (const item of work) {
    i += 1;
    const incoming = item.company;
    if (!incoming) {
      outRows.push(item.row);
      continue;
    }
    const company = byId.get(incoming.company_id) ?? incoming;
    const prior = done.get(company.company_id);
    let sidecar = prior;
    if (!peopleComplete(prior)) {
      try {
        const { people, searches } = await searchAskPeople(ctx, peopleGate, company, peopleTally, options.search);
        const picked = pickAskFor(people);
        sidecar = mergeSidecar(prior, sidecarFrom(company, picked, searches, !options.skipOrgEnrich));
        done.set(company.company_id, sidecar);
        writeJsonl(sidecarPath, [...done.values()]);
        const label = picked.map((p) => p.title).join(' / ') || 'no_person';
        console.error(`[contacts] ${i}/${work.length} ${company.name} ${label}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[contacts] failed ${company.name}: ${message}`);
        sidecar = prior ?? sidecarFrom(company, [], 0, !options.skipOrgEnrich);
        done.set(company.company_id, sidecar);
        writeJsonl(sidecarPath, [...done.values()]);
      }
    }
    if (!sidecar) {
      outRows.push(item.row);
      continue;
    }
    if (sidecar.person_1_name) withPerson += 1;
    outRows.push(overlayWalkRow(item.row, sidecar, company.employees));
  }

  writeCsv(csvPath, outRows, CONTACT_WALK_COLUMNS);
  writeJsonl(sidecarPath, [...done.values()]);
  writeJson(join(ctx.runDir, 'enrichment', 'contacts_summary.json'), {
    companies: withCompany.length,
    with_person: withPerson,
    org_live: orgLive,
    people_live: peopleTally.live,
    people_cache: peopleTally.cache,
  });
  console.error(
    `[contacts] with_person=${withPerson}/${withCompany.length} org_live=${orgLive} people_live=${peopleTally.live} -> ${csvPath}`,
  );

  return {
    companies: withCompany.length,
    with_person: withPerson,
    org_live: orgLive,
    people_live: peopleTally.live,
    sidecarPath,
    csvPath,
  };
}
