/**
 * Stratified Apollo diagnostic: sample companies with no prior contact,
 * search for CEO/Founder-first decision makers, reveal email for top pick.
 *
 * Usage:
 *   npx tsx scripts/apollo-sample-decision-makers.ts \
 *     --input "/Users/porter/Downloads/companies-no-contact-found.csv" \
 *     --out-dir tmp/apollo-contact-sample \
 *     --target-env dev
 *
 * Uses the sandbox/dev Apollo key by default — the shared prod key is
 * enrichment-only and cannot call people search.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Papa from 'papaparse';
import { loadSelfRecoveryEnv, resolveApolloApiKey } from './self-recovery-env.ts';

const SAMPLE_SEED = 'furnace-apollo-sample-v1';
const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';
const APOLLO_V1_BASE = 'https://api.apollo.io/v1';
const REQUEST_GAP_MS = 400;
const MAX_ATTEMPTS = 4;
/** Restrict people search to contacts located in US or Canada. */
const PERSON_LOCATIONS = ['United States', 'Canada'];

type EmployeeBucket = '0_blank' | '1_10' | '11_50' | '51_200' | '200_plus';
type TitleTier = 'A' | 'B' | 'C' | 'D' | 'none';
type Outcome = 'person_and_email' | 'person_no_email' | 'no_person' | 'error';

type CompanyRow = {
  companyName: string;
  employees: number | null;
  industry: string;
  website: string;
  apolloRecordId: string;
  city: string;
  state: string;
  country: string;
};

type SampledCompany = CompanyRow & {
  bucket: EmployeeBucket;
};

type SearchPerson = {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email_status?: string | null;
  has_email?: boolean | null;
};

type ContactResult = {
  company_name: string;
  apollo_org_id: string;
  website: string;
  domain: string;
  industry: string;
  employees: string;
  bucket: EmployeeBucket;
  search_strategy: string;
  person_id: string;
  person_name: string;
  person_title: string;
  person_linkedin: string;
  title_tier: TitleTier;
  email: string;
  email_status: string;
  outcome: Outcome;
  error: string;
};

const SAMPLE_QUOTAS: Record<EmployeeBucket, number> = {
  '1_10': 100,
  '11_50': 70,
  '51_200': 45,
  '200_plus': 25,
  '0_blank': 10,
};

const TITLES_TIER_A = [
  'CEO',
  'Chief Executive Officer',
  'Founder',
  'Co-Founder',
  'Cofounder',
  'Owner',
];

const TITLES_TIER_B = ['President', 'Managing Partner', 'Managing Director', 'Principal'];

const TITLES_TIER_C = [
  'Head of Revenue Operations',
  'VP Revenue Operations',
  'Director of Revenue Operations',
  'RevOps',
  'Revenue Operations',
  'Sales Operations',
  'Sales Ops',
  'Head of Sales Operations',
  'VP Sales Operations',
];

const TITLES_TIER_D = [
  'CRO',
  'Chief Revenue Officer',
  'VP Sales',
  'Head of Sales',
  'Head of Growth',
  'VP Growth',
  'COO',
  'Chief Operating Officer',
];

class ApolloHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApolloHttpError';
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Deterministic PRNG from seed string (mulberry32). */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToUint32(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  return digest.readUInt32BE(0);
}

function shuffleInPlace<T>(items: T[], rand: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

function parseArgs(argv: string[]): {
  input: string;
  outDir: string;
  targetEnv: 'prod' | 'dev';
} {
  let input = '/Users/porter/Downloads/companies-no-contact-found.csv';
  let outDir = 'tmp/apollo-contact-sample';
  // Sandbox/dev key has people-search scope; shared prod key is enrichment-only.
  let targetEnv: 'prod' | 'dev' = 'dev';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) {
      input = argv[++i]!;
    } else if (arg === '--out-dir' && argv[i + 1]) {
      outDir = argv[++i]!;
    } else if (arg === '--target-env' && argv[i + 1]) {
      const value = argv[++i]!.trim().toLowerCase();
      if (value !== 'prod' && value !== 'dev') {
        throw new Error(`Invalid --target-env ${value} (expected prod|dev)`);
      }
      targetEnv = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npx tsx scripts/apollo-sample-decision-makers.ts [--input PATH] [--out-dir DIR] [--target-env dev|prod]',
      );
      process.exit(0);
    }
  }
  return { input: resolve(input), outDir: resolve(outDir), targetEnv };
}

/** Extract registrable-ish hostname from a website URL for Apollo domain search. */
function domainFromWebsite(website: string): string | null {
  const raw = website.trim();
  if (!raw) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withProtocol).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function parseEmployees(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

function employeeBucket(employees: number | null): EmployeeBucket {
  if (employees === null || employees === 0) return '0_blank';
  if (employees <= 10) return '1_10';
  if (employees <= 50) return '11_50';
  if (employees <= 200) return '51_200';
  return '200_plus';
}

function loadCompanies(csvText: string): CompanyRow[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse error: ${first?.message ?? 'unknown'}`);
  }

  const rows: CompanyRow[] = [];
  for (const row of parsed.data) {
    const apolloRecordId = (row['Apollo Record Id'] ?? '').trim();
    const companyName = (row['Company Name for Emails'] ?? '').trim();
    if (!apolloRecordId || !companyName) continue;
    rows.push({
      companyName,
      employees: parseEmployees(row['# Employees']),
      industry: (row.Industry ?? '').trim(),
      website: (row.Website ?? '').trim(),
      apolloRecordId,
      city: (row['Company City'] ?? '').trim(),
      state: (row['Company State'] ?? '').trim(),
      country: (row['Company Country'] ?? '').trim(),
    });
  }
  return rows;
}

function buildStratifiedSample(companies: CompanyRow[]): SampledCompany[] {
  const rand = mulberry32(seedToUint32(SAMPLE_SEED));
  const byBucket: Record<EmployeeBucket, CompanyRow[]> = {
    '0_blank': [],
    '1_10': [],
    '11_50': [],
    '51_200': [],
    '200_plus': [],
  };
  for (const company of companies) {
    byBucket[employeeBucket(company.employees)].push(company);
  }

  const sample: SampledCompany[] = [];
  for (const bucket of Object.keys(SAMPLE_QUOTAS) as EmployeeBucket[]) {
    const pool = [...byBucket[bucket]];
    shuffleInPlace(pool, rand);
    const take = Math.min(SAMPLE_QUOTAS[bucket], pool.length);
    for (let i = 0; i < take; i += 1) {
      sample.push({ ...pool[i]!, bucket });
    }
    if (take < SAMPLE_QUOTAS[bucket]) {
      console.warn(
        `Bucket ${bucket}: only ${take}/${SAMPLE_QUOTAS[bucket]} companies available`,
      );
    }
  }
  shuffleInPlace(sample, rand);
  return sample;
}

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').toLowerCase().replace(/[^a-z0-9+]/g, ' ').replace(/\s+/g, ' ').trim();
}

function classifyTitleTier(title: string | null | undefined): TitleTier {
  const t = normalizeTitle(title);
  if (!t) return 'none';

  if (
    /\b(ceo|chief executive)\b/.test(t) ||
    /\b(co[- ]?founder|founder)\b/.test(t) ||
    /\bowner\b/.test(t)
  ) {
    return 'A';
  }
  if (
    /\bpresident\b/.test(t) ||
    /\bmanaging partner\b/.test(t) ||
    /\bmanaging director\b/.test(t) ||
    /\bprincipal\b/.test(t)
  ) {
    return 'B';
  }
  if (
    /\brevops\b/.test(t) ||
    /\brevenue operations\b/.test(t) ||
    /\bsales ops\b/.test(t) ||
    /\bsales operations\b/.test(t) ||
    /\bgrowth ops\b/.test(t) ||
    /\bgrowth operations\b/.test(t)
  ) {
    return 'C';
  }
  if (
    /\bcro\b/.test(t) ||
    /\bchief revenue\b/.test(t) ||
    /\bvp sales\b/.test(t) ||
    /\bvice president.*sales\b/.test(t) ||
    /\bhead of sales\b/.test(t) ||
    /\bhead of growth\b/.test(t) ||
    /\bvp growth\b/.test(t) ||
    /\bcoo\b/.test(t) ||
    /\bchief operating\b/.test(t)
  ) {
    return 'D';
  }
  return 'none';
}

function tierScore(tier: TitleTier): number {
  switch (tier) {
    case 'A':
      return 100;
    case 'B':
      return 80;
    case 'C':
      return 60;
    case 'D':
      return 40;
    default:
      return 0;
  }
}

function emailStatusBonus(status: string | null | undefined): number {
  const s = (status ?? '').toLowerCase();
  if (s === 'verified') return 5;
  if (s === 'likely to engage') return 3;
  if (s === 'unverified') return 1;
  return 0;
}

function rankPeople(people: SearchPerson[], allowCD: boolean): SearchPerson | null {
  let best: SearchPerson | null = null;
  let bestScore = -1;
  for (const person of people) {
    const tier = classifyTitleTier(person.title);
    if (tier === 'none') continue;
    if (!allowCD && (tier === 'C' || tier === 'D')) continue;
    const score = tierScore(tier) + emailStatusBonus(person.email_status);
    if (score > bestScore) {
      bestScore = score;
      best = person;
    }
  }
  return best;
}

function titlesForBucket(bucket: EmployeeBucket): string[] {
  if (bucket === '51_200' || bucket === '200_plus') {
    return [...TITLES_TIER_A, ...TITLES_TIER_B, ...TITLES_TIER_C, ...TITLES_TIER_D];
  }
  return [...TITLES_TIER_A, ...TITLES_TIER_B];
}

function senioritiesForBucket(bucket: EmployeeBucket): string[] {
  if (bucket === '51_200' || bucket === '200_plus') {
    return ['owner', 'founder', 'c_suite', 'vp', 'head', 'director'];
  }
  return ['owner', 'founder', 'c_suite'];
}

function personDisplayName(person: SearchPerson): string {
  const full = (person.name ?? '').trim();
  if (full) return full;
  const last = (person.last_name ?? person.last_name_obfuscated ?? '').trim();
  return [person.first_name, last].filter(Boolean).join(' ').trim();
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: Record<string, string>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? '')).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status =
        error instanceof ApolloHttpError
          ? error.status
          : error && typeof error === 'object' && 'status' in error
            ? Number((error as { status: number }).status)
            : 0;
      if (attempt >= MAX_ATTEMPTS || (status !== 429 && status < 500)) {
        throw error;
      }
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

async function apolloPostJson<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  return withRetry(async () => {
    const response = await fetch(`${baseUrl}${path}`, {
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
      const text = await response.text().catch(() => '');
      throw new ApolloHttpError(
        `Apollo ${path} failed: ${response.status}${text ? ` ${text.slice(0, 200)}` : ''}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  });
}

async function searchPeopleOnce(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<SearchPerson[]> {
  const data = await apolloPostJson<{
    people?: SearchPerson[];
    contacts?: SearchPerson[];
  }>(APOLLO_API_BASE, '/mixed_people/api_search', apiKey, body);
  return data.people ?? data.contacts ?? [];
}

/**
 * CSV Apollo Record Ids are often stale/unusable for search. Prefer domain,
 * then org id, then organization name. Continues until a rankable person exists.
 */
async function searchPeopleForCompany(
  apiKey: string,
  company: SampledCompany,
  allowCD: boolean,
): Promise<{ people: SearchPerson[]; strategy: string; best: SearchPerson | null }> {
  const titles = titlesForBucket(company.bucket);
  const seniorities = senioritiesForBucket(company.bucket);
  const domain = domainFromWebsite(company.website);

  const attempts: Array<{ strategy: string; body: Record<string, unknown> }> = [];
  if (domain) {
    attempts.push({
      strategy: 'domain+titles',
      body: {
        q_organization_domains_list: [domain],
        person_titles: titles,
        person_seniorities: seniorities,
        person_locations: PERSON_LOCATIONS,
        include_similar_titles: true,
        page: 1,
        per_page: 10,
      },
    });
    attempts.push({
      strategy: 'domain+seniority',
      body: {
        q_organization_domains_list: [domain],
        person_seniorities: seniorities,
        person_locations: PERSON_LOCATIONS,
        page: 1,
        per_page: 10,
      },
    });
  }
  if (company.apolloRecordId) {
    attempts.push({
      strategy: 'org_id+titles',
      body: {
        organization_ids: [company.apolloRecordId],
        person_titles: titles,
        person_seniorities: seniorities,
        person_locations: PERSON_LOCATIONS,
        include_similar_titles: true,
        page: 1,
        per_page: 10,
      },
    });
  }
  attempts.push({
    strategy: 'org_name+titles',
    body: {
      q_organization_name: company.companyName,
      person_titles: titles,
      person_seniorities: seniorities,
      person_locations: PERSON_LOCATIONS,
      include_similar_titles: true,
      page: 1,
      per_page: 10,
    },
  });

  let lastPeople: SearchPerson[] = [];
  let lastStrategy = 'none';
  for (const attempt of attempts) {
    const people = await searchPeopleOnce(apiKey, attempt.body);
    await sleep(REQUEST_GAP_MS);
    lastPeople = people;
    lastStrategy = attempt.strategy;
    const best = rankPeople(people, allowCD);
    if (best?.id) {
      return { people, strategy: attempt.strategy, best };
    }
  }
  return { people: lastPeople, strategy: lastStrategy, best: null };
}

async function enrichPersonById(
  apiKey: string,
  personId: string,
): Promise<{
  email: string;
  email_status: string;
  name: string;
  title: string;
  linkedin_url: string;
} | null> {
  const data = await apolloPostJson<{
    person?: {
      email?: string | null;
      email_status?: string | null;
      personal_emails?: string[] | null;
      name?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      title?: string | null;
      linkedin_url?: string | null;
    } | null;
  }>(APOLLO_V1_BASE, '/people/match', apiKey, {
    id: personId,
    reveal_personal_emails: true,
  });

  const person = data.person;
  if (!person) return null;
  const email =
    (person.email ?? '').trim() ||
    (person.personal_emails?.find((e) => e?.trim()) ?? '').trim();
  const name =
    (person.name ?? '').trim() ||
    [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
  return {
    email,
    email_status: (person.email_status ?? '').trim(),
    name,
    title: (person.title ?? '').trim(),
    linkedin_url: (person.linkedin_url ?? '').trim(),
  };
}

function emptyResult(
  company: SampledCompany,
  outcome: Outcome,
  error = '',
  strategy = '',
): ContactResult {
  return {
    company_name: company.companyName,
    apollo_org_id: company.apolloRecordId,
    website: company.website,
    domain: domainFromWebsite(company.website) ?? '',
    industry: company.industry,
    employees: company.employees === null ? '' : String(company.employees),
    bucket: company.bucket,
    search_strategy: strategy,
    person_id: '',
    person_name: '',
    person_title: '',
    person_linkedin: '',
    title_tier: 'none',
    email: '',
    email_status: '',
    outcome,
    error,
  };
}

async function processCompany(
  apiKey: string,
  company: SampledCompany,
  rawDir: string,
): Promise<ContactResult> {
  const allowCD = company.bucket === '51_200' || company.bucket === '200_plus';
  try {
    const { people, strategy, best } = await searchPeopleForCompany(apiKey, company, allowCD);

    if (!best?.id) {
      await writeFile(
        join(
          rawDir,
          `${company.apolloRecordId || domainFromWebsite(company.website) || 'unknown'}.json`,
        ),
        JSON.stringify(
          {
            company,
            strategy,
            people,
            reason: people.length > 0 ? 'no_ranked_person' : 'no_person',
          },
          null,
          2,
        ),
      );
      return emptyResult(company, 'no_person', '', strategy);
    }

    const tier = classifyTitleTier(best.title);
    let email = '';
    let emailStatus = (best.email_status ?? '').trim();
    let personName = personDisplayName(best);
    let personTitle = (best.title ?? '').trim();
    let personLinkedin = (best.linkedin_url ?? '').trim();
    try {
      const enriched = await enrichPersonById(apiKey, best.id);
      await sleep(REQUEST_GAP_MS);
      if (enriched) {
        email = enriched.email;
        if (enriched.email_status) emailStatus = enriched.email_status;
        if (enriched.name) personName = enriched.name;
        if (enriched.title) personTitle = enriched.title;
        if (enriched.linkedin_url) personLinkedin = enriched.linkedin_url;
      }
    } catch (enrichError) {
      const message = enrichError instanceof Error ? enrichError.message : String(enrichError);
      await writeFile(
        join(rawDir, `${company.apolloRecordId}.json`),
        JSON.stringify({ company, best, strategy, enrichError: message }, null, 2),
      );
      return {
        ...emptyResult(company, 'person_no_email', message, strategy),
        person_id: best.id,
        person_name: personName,
        person_title: personTitle,
        person_linkedin: personLinkedin,
        title_tier: tier,
        email_status: emailStatus,
      };
    }

    return {
      company_name: company.companyName,
      apollo_org_id: company.apolloRecordId,
      website: company.website,
      domain: domainFromWebsite(company.website) ?? '',
      industry: company.industry,
      employees: company.employees === null ? '' : String(company.employees),
      bucket: company.bucket,
      search_strategy: strategy,
      person_id: best.id,
      person_name: personName,
      person_title: personTitle,
      person_linkedin: personLinkedin,
      title_tier: tier,
      email,
      email_status: emailStatus,
      outcome: email ? 'person_and_email' : 'person_no_email',
      error: '',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(
      join(rawDir, `${company.apolloRecordId || 'unknown'}.json`),
      JSON.stringify({ company, error: message }, null, 2),
    );
    await sleep(REQUEST_GAP_MS);
    return emptyResult(company, 'error', message);
  }
}

function buildSummary(results: ContactResult[]) {
  const buckets = Object.keys(SAMPLE_QUOTAS) as EmployeeBucket[];
  const byBucket: Record<string, unknown> = {};

  const summarize = (rows: ContactResult[]) => {
    const total = rows.length;
    const personAndEmail = rows.filter((r) => r.outcome === 'person_and_email').length;
    const personNoEmail = rows.filter((r) => r.outcome === 'person_no_email').length;
    const noPerson = rows.filter((r) => r.outcome === 'no_person').length;
    const error = rows.filter((r) => r.outcome === 'error').length;
    const personFound = personAndEmail + personNoEmail;
    return {
      total,
      person_and_email: personAndEmail,
      person_no_email: personNoEmail,
      no_person: noPerson,
      error,
      person_rate: total ? personFound / total : 0,
      email_rate: total ? personAndEmail / total : 0,
    };
  };

  for (const bucket of buckets) {
    byBucket[bucket] = summarize(results.filter((r) => r.bucket === bucket));
  }

  const overall = summarize(results);
  let recommendation: string;
  if (overall.email_rate >= 0.15) {
    recommendation =
      'go: email hit rate >= 15% — worth a wider Apollo pass with CEO/Founder-first filters';
  } else if (overall.email_rate >= 0.05) {
    recommendation =
      'thin: email hit rate 5–15% — Apollo only as a light pass; prioritize other sources';
  } else {
    recommendation =
      'stop: email hit rate < 5% — stop Apollo on this file; switch to website/LinkedIn/verify';
  }

  return {
    seed: SAMPLE_SEED,
    person_locations: PERSON_LOCATIONS,
    quotas: SAMPLE_QUOTAS,
    overall,
    by_bucket: byBucket,
    recommendation,
    generated_at: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  loadSelfRecoveryEnv();
  const { input, outDir, targetEnv } = parseArgs(process.argv.slice(2));
  const rawDir = join(outDir, 'raw');
  await mkdir(rawDir, { recursive: true });

  // Clear prior raw errors from failed prod-key runs
  console.log(`Reading ${input}`);
  const csvText = await readFile(input, 'utf8');
  const companies = loadCompanies(csvText);
  console.log(`Loaded ${companies.length} companies`);

  const sample = buildStratifiedSample(companies);
  console.log(`Sampled ${sample.length} companies (seed=${SAMPLE_SEED})`);

  const sampleCsv = toCsv(
    sample.map((c) => ({
      company_name: c.companyName,
      employees: c.employees === null ? '' : String(c.employees),
      bucket: c.bucket,
      industry: c.industry,
      website: c.website,
      domain: domainFromWebsite(c.website) ?? '',
      apollo_org_id: c.apolloRecordId,
      city: c.city,
      state: c.state,
      country: c.country,
    })),
  );
  await writeFile(join(outDir, 'sample-250.csv'), sampleCsv);

  const { apiKey, source } = await resolveApolloApiKey({ targetEnv });
  console.log(`Apollo key from ${source} (targetEnv=${targetEnv})`);

  const results: ContactResult[] = [];
  for (let i = 0; i < sample.length; i += 1) {
    const company = sample[i]!;
    process.stdout.write(
      `[${i + 1}/${sample.length}] ${company.companyName.slice(0, 50)} (${company.bucket})... `,
    );
    const result = await processCompany(apiKey, company, rawDir);
    results.push(result);
    console.log(
      `${result.outcome}` +
        (result.search_strategy ? ` via ${result.search_strategy}` : '') +
        (result.person_name ? ` | ${result.person_name}` : '') +
        (result.email ? ` <${result.email}>` : ''),
    );
  }

  const contactsCsv = toCsv(
    results.map((r) => ({
      company_name: r.company_name,
      apollo_org_id: r.apollo_org_id,
      website: r.website,
      domain: r.domain,
      industry: r.industry,
      employees: r.employees,
      bucket: r.bucket,
      search_strategy: r.search_strategy,
      person_id: r.person_id,
      person_name: r.person_name,
      person_title: r.person_title,
      person_linkedin: r.person_linkedin,
      title_tier: r.title_tier,
      email: r.email,
      email_status: r.email_status,
      outcome: r.outcome,
      error: r.error,
    })),
  );
  await writeFile(join(outDir, 'contacts.csv'), contactsCsv);

  const summary = buildSummary(results);
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary.overall, null, 2));
  console.log(`Recommendation: ${summary.recommendation}`);
  console.log(`Wrote ${join(outDir, 'contacts.csv')}`);
  console.log(`Wrote ${join(outDir, 'summary.json')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
