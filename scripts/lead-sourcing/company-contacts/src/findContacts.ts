import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { parseCliArgs, truncateRows } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ensureEnv, useFixtures } from '../../webinar-hosts/src/lib/env.js';
import {
  enrichPeopleByIds,
  splitName,
  type ApolloClientOptions,
  type ApolloPerson,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import {
  HttpStatusError,
  Mutex,
  RequestGate,
  parseRetryAfterMs,
  resolveConcurrency,
} from './apolloGate.js';
import {
  appendContactLog,
  createContactsCheckpoint,
  loadContactsCheckpoint,
  saveContactsCheckpoint,
} from './checkpoint.js';
import { fixturesDir, loadIcpConfig } from './config.js';
import { pickContactSlots, type TierCandidate } from './contactTier.js';
import type { LeadRow, RejectedCompanyRow, ResolvedCompanyRow } from './types.js';

type ApiSearchPerson = TierCandidate & { id: string };

/** Restrict people search to contacts located in US or Canada. */
const PERSON_LOCATIONS = ['United States', 'Canada'] as const;

/** Titles sent to Apollo people search (Founder/CEO first, then Sales/Marketing leaders). */
const PERSON_TITLES = [
  'CEO',
  'Chief Executive Officer',
  'Founder',
  'Co-Founder',
  'Cofounder',
  'Owner',
  'President',
  'CMO',
  'Chief Marketing Officer',
  'CRO',
  'Chief Revenue Officer',
  'CSO',
  'Chief Sales Officer',
  'VP of Sales',
  'Vice President of Sales',
  'VP Sales',
  'Head of Sales',
  'VP of Marketing',
  'Vice President of Marketing',
  'VP Marketing',
  'Head of Marketing',
  'VP of Growth',
  'Head of Growth',
  'Director of Sales',
  'Director of Marketing',
  'Managing Director',
];

const PERSON_SENIORITIES = ['owner', 'founder', 'c_suite', 'vp', 'head'] as const;

type CompanyResult = {
  index: number;
  company: ResolvedCompanyRow;
  leads: LeadRow[];
  rejectionReason: string;
};

function fixturePeoplePath(organizationId: string): string {
  const safe = organizationId.replace(/[^a-z0-9]+/gi, '-').slice(0, 60).toLowerCase();
  const specific = join(fixturesDir, 'apollo', `people-search-${safe}.json`);
  if (existsSync(specific)) return specific;
  return join(fixturesDir, 'apollo', 'people-search.json');
}

async function apolloPeopleApiSearch(
  body: Record<string, unknown>,
  options: ApolloClientOptions,
  gate: RequestGate,
): Promise<ApiSearchPerson[]> {
  options.counter?.increment('apollo_people_calls', 1);

  const apiKey = options.apiKey ?? process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error('APOLLO_API_KEY required for people search');

  const fetchImpl = options.fetchImpl ?? fetch;
  return gate.schedule(async () => {
    const response = await fetchImpl('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new HttpStatusError(
        `Apollo api_search failed: ${response.status}`,
        response.status,
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    const data = (await response.json()) as { people?: ApiSearchPerson[] };
    return data.people ?? [];
  });
}

async function searchPeopleByOrganization(
  organizationId: string,
  perPage: number,
  options: ApolloClientOptions,
  gate: RequestGate,
): Promise<ApiSearchPerson[]> {
  if (options.useFixtures) {
    options.counter?.increment('apollo_people_calls', 1);
    const path = fixturePeoplePath(organizationId);
    if (!existsSync(path)) return [];
    const data = JSON.parse(readFileSync(path, 'utf8')) as { people?: ApiSearchPerson[] };
    return (data.people ?? []).slice(0, perPage);
  }

  return apolloPeopleApiSearch(
    {
      organization_ids: [organizationId],
      person_titles: PERSON_TITLES,
      person_seniorities: [...PERSON_SENIORITIES],
      person_locations: [...PERSON_LOCATIONS],
      include_similar_titles: true,
      page: 1,
      per_page: perPage,
    },
    options,
    gate,
  );
}

async function searchPeopleByDomain(
  domain: string,
  perPage: number,
  options: ApolloClientOptions,
  gate: RequestGate,
): Promise<ApiSearchPerson[]> {
  if (options.useFixtures || !domain.trim()) return [];

  return apolloPeopleApiSearch(
    {
      q_organization_domains_list: [domain.trim().toLowerCase()],
      person_titles: PERSON_TITLES,
      person_seniorities: [...PERSON_SENIORITIES],
      person_locations: [...PERSON_LOCATIONS],
      include_similar_titles: true,
      page: 1,
      per_page: perPage,
    },
    options,
    gate,
  );
}

async function searchPeopleForCompany(
  company: ResolvedCompanyRow,
  perPage: number,
  options: ApolloClientOptions,
  gate: RequestGate,
  pickSlots: (pool: ApiSearchPerson[]) => ReturnType<typeof pickContactSlots>,
): Promise<{ pool: ApiSearchPerson[]; slots: ReturnType<typeof pickContactSlots> }> {
  let pool = await searchPeopleByOrganization(company.apollo_org_id, perPage, options, gate);
  let slots = pickSlots(pool);
  if (slots.length > 0) return { pool, slots };

  const domainPool = await searchPeopleByDomain(company.company_domain, perPage, options, gate);
  if (domainPool.length === 0) return { pool, slots };

  const byId = new Map<string, ApiSearchPerson>();
  for (const person of [...pool, ...domainPool]) {
    if (person.id) byId.set(person.id, person);
  }
  pool = [...byId.values()];
  slots = pickSlots(pool);
  return { pool, slots };
}

function personToLead(
  company: ResolvedCompanyRow,
  person: ApolloPerson,
  tier: string,
  reason: string,
): LeadRow | null {
  const email = person.email?.trim().toLowerCase();
  if (!email?.includes('@')) return null;
  const { first_name, last_name } = splitName(
    `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim(),
  );
  return {
    email,
    first_name,
    last_name,
    company_name: company.company_name,
    website: company.company_domain,
    linkedin_url: person.linkedin_url ?? '',
    company_linkedin_url: company.company_linkedin_url,
    contact_title: person.title ?? '',
    contact_tier: tier,
    contact_pick_reason: reason,
    employee_count: company.employee_count,
    industry: company.industry,
    apollo_org_id: company.apollo_org_id,
    source_lists: company.source_lists,
  };
}

function fixturePersonToApollo(person: ApiSearchPerson): ApolloPerson {
  return {
    id: person.id,
    first_name: person.first_name,
    last_name: person.last_name,
    title: person.title,
    email: person.email,
    linkedin_url: person.linkedin_url,
  };
}

async function processCompany(
  company: ResolvedCompanyRow,
  searchConfig: ReturnType<typeof loadIcpConfig>['contact_search'],
  apolloOptions: ApolloClientOptions,
  gate: RequestGate,
  fixtures: boolean,
  enrichCredits: { used: number },
): Promise<{ leads: LeadRow[]; rejectionReason: string; enrichedIds: number }> {
  let rejectionReason = '';
  const companyLeads: LeadRow[] = [];
  let enrichedIds = 0;

  try {
    const { pool, slots } = await searchPeopleForCompany(
      company,
      searchConfig.per_page,
      apolloOptions,
      gate,
      (candidates) => pickContactSlots(candidates, searchConfig),
    );

    if (slots.length === 0) {
      rejectionReason = pool.length === 0 ? 'apollo_empty' : 'no_tier_match';
    } else {
      let people: ApolloPerson[];
      if (fixtures) {
        const byId = new Map(pool.map((p) => [p.id, p]));
        people = slots
          .map((slot) => byId.get(slot.id))
          .filter(Boolean)
          .map((p) => fixturePersonToApollo(p!));
      } else {
        const ids = slots.map((s) => s.id);
        people = await gate.schedule(() =>
          enrichPeopleByIds(ids, apolloOptions, company.apollo_org_id),
        );
        enrichedIds = ids.length;
        enrichCredits.used += ids.length;
      }

      const peopleById = new Map(people.filter((p) => p.id).map((p) => [p.id!, p]));
      for (const slot of slots) {
        const person = peopleById.get(slot.id);
        if (!person) continue;
        const lead = personToLead(company, person, slot.tier, slot.reason);
        if (!lead) continue;
        companyLeads.push(lead);
      }

      if (companyLeads.length === 0) {
        rejectionReason = 'tier_match_no_email';
      }
    }
  } catch (error) {
    rejectionReason = `error:${error instanceof Error ? error.message : String(error)}`;
  }

  return { leads: companyLeads, rejectionReason, enrichedIds };
}

function advanceContiguousNextIndex(
  completed: Set<number>,
  startFrom: number,
  total: number,
): number {
  let next = startFrom;
  while (next < total && completed.has(next)) {
    next += 1;
  }
  return next;
}

export type FindContactsOptions = {
  runDir: string;
  resolvedPath?: string;
  dryRun?: boolean;
  maxRows?: number | null;
  maxApolloCalls?: number | null;
  /** When set with maxApolloCalls, stop after this many people-enrich IDs (billable), not free searches. */
  maxEnrichmentCredits?: number | null;
  /** Override ICP max_contacts_per_company (e.g. 1 for cheaper pass-1 density). */
  maxContactsPerCompany?: number | null;
  useFixtures?: boolean;
  counter?: CallCounter;
  concurrency?: number;
};

export async function findContacts(options: FindContactsOptions): Promise<{
  runDir: string;
  leads: LeadRow[];
  rejected: RejectedCompanyRow[];
}> {
  const runDir = resolve(options.runDir);
  const resolvedPath = resolve(options.resolvedPath ?? join(runDir, 'companies_resolved.csv'));
  if (!existsSync(resolvedPath)) {
    throw new Error(`companies_resolved.csv not found at ${resolvedPath}`);
  }

  let companies = (readCsv(resolvedPath) as ResolvedCompanyRow[]).filter(
    (row) => row.enrichment_status === 'ok' && row.apollo_org_id,
  );
  companies = truncateRows(companies, options.maxRows ?? null);

  const icp = loadIcpConfig();
  const searchConfig = {
    ...icp.contact_search,
    max_contacts_per_company:
      options.maxContactsPerCompany ?? icp.contact_search.max_contacts_per_company,
  };
  const concurrency = resolveConcurrency(options.concurrency, 8);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          eligible_companies: companies.length,
          estimated_apollo_people_searches: companies.length,
          max_contacts_per_company: searchConfig.max_contacts_per_company,
          fill_order: searchConfig.fill_order,
          concurrency,
        },
        null,
        2,
      ),
    );
    return { runDir, leads: [], rejected: [] };
  }

  const fixtures = options.useFixtures ?? useFixtures();
  const counter = options.counter ?? new CallCounter();
  const apolloOptions: ApolloClientOptions = { useFixtures: fixtures, counter };
  const gate = new RequestGate({ minSpacingMs: 90, maxAttempts: 8, label: 'apollo' });

  let checkpoint = loadContactsCheckpoint(runDir);
  if (checkpoint && checkpoint.resolved_path !== resolvedPath) {
    throw new Error(
      `Checkpoint resolved_path mismatch: ${checkpoint.resolved_path} vs ${resolvedPath}`,
    );
  }
  if (!checkpoint) {
    checkpoint = createContactsCheckpoint(resolvedPath, companies.length);
  }

  // Align total with current eligible company list (resume-safe).
  checkpoint.total = companies.length;

  const seenEmails = new Set(checkpoint.seen_emails);
  const completed = new Set<number>();
  for (let i = 0; i < checkpoint.next_index; i++) {
    completed.add(i);
  }

  let claimIndex = checkpoint.next_index;
  const claimMutex = new Mutex();
  const mergeMutex = new Mutex();
  let mergesSinceLog = 0;
  let hitMaxApolloCalls = false;
  const enrichCredits = { used: 0 };
  const maxEnrichmentCredits = options.maxEnrichmentCredits ?? null;

  const claimNext = async (): Promise<number | null> =>
    claimMutex.runExclusive(() => {
      if (hitMaxApolloCalls) return null;
      if (
        options.maxApolloCalls != null &&
        counter.counts.apollo_people_calls >= options.maxApolloCalls
      ) {
        hitMaxApolloCalls = true;
        return null;
      }
      if (maxEnrichmentCredits != null && enrichCredits.used >= maxEnrichmentCredits) {
        hitMaxApolloCalls = true;
        return null;
      }
      if (claimIndex >= companies.length) return null;
      const index = claimIndex;
      claimIndex += 1;
      return index;
    });

  const mergeResult = async (result: CompanyResult): Promise<void> => {
    await mergeMutex.runExclusive(() => {
      const uniqueLeads: LeadRow[] = [];
      for (const lead of result.leads) {
        if (seenEmails.has(lead.email)) continue;
        seenEmails.add(lead.email);
        uniqueLeads.push(lead);
      }

      if (uniqueLeads.length > 0) {
        checkpoint.leads.push(...uniqueLeads);
      } else {
        checkpoint.rejected.push({
          ...result.company,
          rejection_reason: result.rejectionReason || 'zero_leads',
        });
      }

      completed.add(result.index);
      checkpoint.next_index = advanceContiguousNextIndex(
        completed,
        checkpoint.next_index,
        companies.length,
      );
      checkpoint.seen_emails = [...seenEmails];
      checkpoint.api_calls = { ...counter.counts };
      checkpoint.status = 'in_progress';
      saveContactsCheckpoint(runDir, checkpoint);

      appendContactLog(runDir, {
        company_domain: result.company.company_domain,
        company_name: result.company.company_name,
        apollo_org_id: result.company.apollo_org_id,
        leads: uniqueLeads.length,
        rejection_reason: uniqueLeads.length > 0 ? null : result.rejectionReason || 'zero_leads',
        titles: uniqueLeads.map((l) => l.contact_title),
        tiers: uniqueLeads.map((l) => l.contact_tier),
      });

      mergesSinceLog += 1;
      if (mergesSinceLog >= 10 || checkpoint.next_index >= companies.length) {
        mergesSinceLog = 0;
        console.error(
          `[find-contacts] ${checkpoint.next_index}/${companies.length} | leads ${checkpoint.leads.length} | zero ${checkpoint.rejected.length} | apollo_people ${counter.counts.apollo_people_calls} | enrich ${enrichCredits.used} | concurrency ${concurrency}`,
        );
      }
    });
  };

  console.error(
    `[find-contacts] resume at ${checkpoint.next_index}/${companies.length} with concurrency=${concurrency}`,
  );

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = await claimNext();
      if (index == null) return;
      const company = companies[index]!;
      const { leads, rejectionReason } = await processCompany(
        company,
        searchConfig,
        apolloOptions,
        gate,
        fixtures,
        enrichCredits,
      );
      await mergeResult({ index, company, leads, rejectionReason });
    }
  };

  const workerCount = Math.min(concurrency, Math.max(1, companies.length - checkpoint.next_index));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (hitMaxApolloCalls) {
    console.error(
      `[find-contacts] hit max apollo calls at ${checkpoint.next_index}/${companies.length}`,
    );
  }

  checkpoint.status = checkpoint.next_index >= companies.length ? 'completed' : 'in_progress';
  checkpoint.api_calls = { ...counter.counts };
  saveContactsCheckpoint(runDir, checkpoint);

  return { runDir, leads: checkpoint.leads, rejected: checkpoint.rejected };
}

export async function runFindContactsCli(): Promise<void> {
  const cli = parseCliArgs();
  if (cli.fixtures) process.env.USE_FIXTURES = '1';

  await ensureEnv();
  const fixtures = cli.fixtures || useFixtures();
  if (!fixtures && !process.env.APOLLO_API_KEY?.trim()) {
    throw new Error(
      'APOLLO_API_KEY could not be resolved from env or SSM. Set APOLLO_API_KEY or ensure DEV_SECRET_SSM_PREFIX is available.',
    );
  }

  const runDir = cli.runDir ?? cli.resume;
  if (!runDir) {
    console.error(
      'Usage: npm run find-contacts -- --run-dir output/runs/... [--concurrency 8]',
    );
    process.exit(1);
  }

  const result = await findContacts({
    runDir,
    dryRun: cli.dryRun,
    maxRows: cli.maxRows,
    maxApolloCalls: cli.maxApolloCalls,
    maxEnrichmentCredits: cli.maxEnrichmentCredits,
    useFixtures: fixtures,
    concurrency: resolveConcurrency(cli.concurrency, 8),
  });

  console.log(
    JSON.stringify(
      {
        run_dir: result.runDir,
        leads: result.leads.length,
        rejected_companies: result.rejected.length,
        by_tier: result.leads.reduce<Record<string, number>>((acc, lead) => {
          acc[lead.contact_tier] = (acc[lead.contact_tier] ?? 0) + 1;
          return acc;
        }, {}),
      },
      null,
      2,
    ),
  );
}
