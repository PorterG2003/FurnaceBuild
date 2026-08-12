/**
 * Quebec carrier disability-contact waterfall.
 *
 * 1) Seed known disability-ops names
 * 2) Apollo people search by org/domain + disability titles
 * 3) Prospeo search-person on companies still short of cap
 * 4) Dedupe vs existing outreach
 * 5) Email enrich: Apollo → Prospeo → Hunter
 * 6) Merge into outreach CSV
 *
 * Usage:
 *   npx tsx scripts/lead-sourcing/disability-contact-waterfall.ts \
 *     --existing scripts/lead-sourcing/output/quebec-carriers/outreach_with_emails.csv \
 *     --run-dir scripts/lead-sourcing/output/quebec-carriers-disability \
 *     --dry-run
 *
 *   npx tsx scripts/lead-sourcing/disability-contact-waterfall.ts \
 *     --existing ... --run-dir ... --live
 *
 * Live requires --live AND explicit spend OK (script-spend gate).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  loadSelfRecoveryEnv,
  resolveApolloApiKey,
  resolveHunterApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../self-recovery-env.ts';
import {
  enrichOrganization,
  enrichPersonByName,
  mapOrganization,
  type ApolloClientOptions,
  type ApolloPerson,
} from './webinar-hosts/src/stage3-enrich/apolloClient.ts';
import {
  enrichPersonEmailOnly,
  searchPerson,
} from './webinar-outreach-enrich/src/prospeo.ts';
import { ensureEnv } from './webinar-outreach-enrich/src/env.ts';
import {
  readCsv,
  writeCsv,
  writeCsvFromObjects,
} from './webinar-hosts/src/lib/csv.ts';

const COMPANY_DOMAINS: Record<string, string> = {
  'Canada Life (Great-West Lifeco)': 'canadalife.com',
  'Sun Life': 'sunlife.ca',
  Manulife: 'manulife.com',
  'Desjardins Financial Security': 'desjardins.com',
  'Beneva (former La Capitale + SSQ)': 'beneva.ca',
  'iA Financial Group (Industrial Alliance)': 'ia.ca',
  'RBC Insurance': 'rbcinsurance.com',
  'Empire Life': 'empire.ca',
  'Equitable Life': 'equitable.ca',
  'UV Insurance (UV Mutuelle / UV Assurance)': 'uvinsurance.ca',
  'Humania Assurance': 'humania.ca',
  'Assumption Life (Assomption Vie)': 'assomption.ca',
  'Medavie Blue Cross': 'medavie.ca',
  'Co-operators Life': 'cooperators.ca',
  'Alan CA Inc.': 'alan.com',
};

/** Commercial carriers in scope (MFQ / Cigna / Chubb excluded). */
const CARRIERS = Object.keys(COMPANY_DOMAINS);

const SEED_CONTACTS: Array<{
  company: string;
  contact_name: string;
  title: string;
  priority: string;
  function_fit: string;
  outreach_note: string;
}> = [
  {
    company: 'Manulife',
    contact_name: 'Darren Gilroy',
    title: 'Vice-President, Disability and Group Life',
    priority: 'A - Tier 1',
    function_fit: 'Disability - direct fit',
    outreach_note:
      'Incumbent for the previously unnamed Manulife VP Canadian Disability & Group Life seat. Highest-value add.',
  },
  {
    company: 'Sun Life',
    contact_name: 'Kathy Seliga',
    title: 'Vice President, Group Benefits Operations and Group Disability',
    priority: 'A - Tier 1',
    function_fit: 'Disability / Claims Ops',
    outreach_note: 'Owns the group disability claims/ops machine under Sun Life Health.',
  },
  {
    company: 'Sun Life',
    contact_name: 'Jeannie Tremblay',
    title: 'Assistant Vice-President, Group Disability Shared Services',
    priority: 'A - Tier 1',
    function_fit: 'Disability claims - Quebec/Montreal',
    outreach_note: 'Montreal-based shared services + life claims. Strong Confluence target.',
  },
  {
    company: 'Canada Life (Great-West Lifeco)',
    contact_name: 'Derek Bodkin',
    title: 'Vice President, Disability Operations',
    priority: 'A - Tier 1',
    function_fit: 'Disability Ops - direct fit',
    outreach_note: 'New in seat Mar 2026 under Julia McGillis. Better buyer than generic tech/ops.',
  },
  {
    company: 'Desjardins Financial Security',
    contact_name: 'Julie Gingras',
    title: 'Vice-présidente, Assurance salaire et Gestion des invalidités',
    priority: 'A - Tier 1',
    function_fit: 'Disability claims - direct fit',
    outreach_note: 'Exact Curant buyer under Chantal Gagne. Approach in French.',
  },
  {
    company: 'Medavie Blue Cross',
    contact_name: 'Maria Milioto',
    title: 'Vice President, Life and Disability Operations',
    priority: 'A - Tier 1',
    function_fit: 'Disability Ops - direct fit',
    outreach_note: 'In role since Sep 2025. Medavie runs in-house disability management.',
  },
];

const APOLLO_TITLES = [
  'Disability',
  'Group Disability',
  'VP Disability',
  'Vice President Disability',
  'Head of Disability',
  'Disability Operations',
  'Disability Claims',
  'Group Claims',
  'Claims',
  'Group Life',
  'Absence Management',
  'AMCS',
  'Invalidité',
  'Réclamations',
  'Assurance salaire',
  'Gestion des invalidités',
];

const PERSON_SENIORITIES = ['c_suite', 'vp', 'head', 'director'] as const;
const PERSON_LOCATIONS = ['Canada'] as const;

const EXCLUDE_TITLE_RE =
  /\b(case manager|specialist|analyst|coordinator|coordonnatrice|coordonnateur|associate|admin|administratif|technicien|technicienne|assessor|gestionnaire de dossier|soutien|intern|trainee|assistant(?!\s+vice))\b/i;

const REQUEST_GAP_MS = 250;

type DiscoveredRow = {
  row_key: string;
  company: string;
  company_domain: string;
  contact_name: string;
  first_name: string;
  last_name: string;
  title: string;
  priority: string;
  function_fit: string;
  discovery_source: string;
  title_rank: string;
  linkedin_url: string;
  apollo_person_id: string;
  apollo_org_id: string;
  outreach_note: string;
};

type EnrichedRow = DiscoveredRow & {
  email: string;
  email_source: string;
  email_confidence: string;
  status: string;
  error: string;
  apollo_calls: string;
  prospeo_calls: string;
  hunter_calls: string;
  hunter_credits: string;
};

type Checkpoint = {
  version: 1;
  status: 'in_progress' | 'completed' | 'dry_run' | 'credit_limit';
  stage: 'discover' | 'enrich' | 'done';
  started_at: string;
  updated_at: string;
  stop_reason: string;
  tallies: {
    apollo_org_calls: number;
    apollo_search_calls: number;
    apollo_email_calls: number;
    prospeo_search_calls: number;
    prospeo_email_calls: number;
    hunter_calls: number;
    hunter_credits: number;
    discovered: number;
    matched_email: number;
    by_discovery_source: Record<string, number>;
    by_email_source: Record<string, number>;
  };
  discovered: DiscoveredRow[];
  enriched: EnrichedRow[];
  enrich_next_index: number;
};

const DISCOVERED_COLUMNS = [
  'row_key',
  'company',
  'company_domain',
  'contact_name',
  'first_name',
  'last_name',
  'title',
  'priority',
  'function_fit',
  'discovery_source',
  'title_rank',
  'linkedin_url',
  'apollo_person_id',
  'apollo_org_id',
  'outreach_note',
] as const;

const ENRICHED_COLUMNS = [
  ...DISCOVERED_COLUMNS,
  'email',
  'email_source',
  'email_confidence',
  'status',
  'error',
  'apollo_calls',
  'prospeo_calls',
  'hunter_calls',
  'hunter_credits',
] as const;

function parseArgs(argv: string[]) {
  let existing =
    'scripts/lead-sourcing/output/quebec-carriers/outreach_with_emails.csv';
  let runDir = 'scripts/lead-sourcing/output/quebec-carriers-disability';
  let live = false;
  let dryRun = false;
  let maxCompanies: number | null = null;
  let maxNewPerCompany = 3;
  let maxApollo: number | null = null;
  let maxProspeo: number | null = null;
  let maxHunter: number | null = null;
  let targetEnv: 'prod' | 'dev' | undefined;
  let stage: 'all' | 'discover' | 'enrich' = 'all';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--existing' && argv[i + 1]) existing = argv[++i]!;
    else if (arg === '--run-dir' && argv[i + 1]) runDir = argv[++i]!;
    else if (arg === '--live') live = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--max-companies' && argv[i + 1]) maxCompanies = Number(argv[++i]) || null;
    else if (arg === '--max-new-per-company' && argv[i + 1]) {
      maxNewPerCompany = Number(argv[++i]) || 3;
    } else if (arg === '--max-apollo-calls' && argv[i + 1]) maxApollo = Number(argv[++i]) || null;
    else if (arg === '--max-prospeo-credits' && argv[i + 1]) maxProspeo = Number(argv[++i]) || null;
    else if (arg === '--max-hunter-credits' && argv[i + 1]) maxHunter = Number(argv[++i]) || null;
    else if (arg === '--stage' && argv[i + 1]) {
      const v = argv[++i]!;
      if (v === 'discover' || v === 'enrich' || v === 'all') stage = v;
    } else if (arg === '--target-env' && argv[i + 1]) {
      const v = argv[++i]!.toLowerCase();
      if (v === 'prod' || v === 'dev') targetEnv = v;
    }
  }
  if (live && dryRun) throw new Error('Pass only one of --live or --dry-run');
  if (!live && !dryRun) throw new Error('Pass --dry-run or --live');
  return {
    existing: resolve(existing),
    runDir: resolve(runDir),
    live,
    dryRun,
    maxCompanies,
    maxNewPerCompany,
    maxApollo,
    maxProspeo,
    maxHunter,
    targetEnv,
    stage,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

function stripBomKey(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/^\ufeff/, '')] = v;
  return out;
}

function splitName(full: string): { first: string; last: string } {
  const cleaned = full.trim().replace(/\s+/g, ' ');
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function rowKey(company: string, name: string): string {
  return `${company.trim()}|${name.trim()}`.toLowerCase();
}

function hasRealEmail(raw: string | undefined): boolean {
  const e = (raw || '').trim();
  if (!e || !e.includes('@') || /\s/.test(e)) return false;
  if (/convention|inferred|reported|unverified/i.test(e)) return false;
  return true;
}

function titleRank(title: string): number {
  const t = title.toLowerCase();
  if (/\b(vp|vice[-\s]?president|evp|executive vice).*(disability|invalidit)/i.test(t)) return 100;
  if (/\b(disability|invalidit).*(vp|vice[-\s]?president)/i.test(t)) return 100;
  if (/\b(vp|vice[-\s]?president).*(claims|réclamation|reclamations)/i.test(t)) return 90;
  if (/\b(avp|assistant vice).*(disability|invalidit)/i.test(t)) return 80;
  if (/\b(head|chief).*(disability|invalidit|claims)/i.test(t)) return 75;
  if (/\bdirector.*(disability|invalidit|claims|réclamation)/i.test(t)) return 60;
  if (/\b(disability|invalidit|claims|réclamation|amcs|absence)/i.test(t)) return 40;
  return 10;
}

function isExcludedTitle(title: string): boolean {
  if (!title.trim()) return true;
  // Keep AVP / Assistant Vice-President (EXCLUDE pattern skips "assistant vice…").
  if (/\b(assistant\s+vice[-\s]?president|avp)\b/i.test(title)) return false;
  return EXCLUDE_TITLE_RE.test(title);
}

/** Apollo api_search often returns first-name-only stubs — drop those. */
function isUsablePersonName(name: string, first?: string, last?: string): boolean {
  const full = name.trim();
  const lastName = (last || splitName(full).last).trim();
  if (!full || full.length < 3) return false;
  if (!lastName || lastName.length < 2) return false;
  // Reject single-token names and obvious placeholders
  if (full.split(/\s+/).length < 2) return false;
  if (/^(unknown|n\/a|null)$/i.test(full)) return false;
  return true;
}

function emptyCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    stage: 'discover',
    started_at: now,
    updated_at: now,
    stop_reason: '',
    tallies: {
      apollo_org_calls: 0,
      apollo_search_calls: 0,
      apollo_email_calls: 0,
      prospeo_search_calls: 0,
      prospeo_email_calls: 0,
      hunter_calls: 0,
      hunter_credits: 0,
      discovered: 0,
      matched_email: 0,
      by_discovery_source: {},
      by_email_source: {},
    },
    discovered: [],
    enriched: [],
    enrich_next_index: 0,
  };
}

function loadCheckpoint(path: string): Checkpoint {
  if (!existsSync(path)) return emptyCheckpoint();
  const ck = JSON.parse(readFileSync(path, 'utf8')) as Checkpoint;
  if (ck.version !== 1) return emptyCheckpoint();
  return ck;
}

function saveCheckpoint(path: string, ck: Checkpoint): void {
  ck.updated_at = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(ck, null, 2)}\n`);
}

function apolloEmail(person: ApolloPerson | null): string {
  const email = person?.email?.trim() || '';
  return email.includes('@') ? email : '';
}

type ApiSearchPerson = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
};

async function apolloPeopleSearch(
  body: Record<string, unknown>,
  apiKey: string,
): Promise<ApiSearchPerson[]> {
  const response = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
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
    const text = await response.text();
    throw new Error(`Apollo api_search failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { people?: ApiSearchPerson[] };
  return data.people ?? [];
}

async function hunterEmailFinder(opts: {
  domain: string;
  firstName: string;
  lastName: string;
  company: string;
  apiKey: string;
}): Promise<{ email: string; score: string; credited: boolean; error?: string }> {
  const params = new URLSearchParams({
    domain: opts.domain,
    first_name: opts.firstName,
    last_name: opts.lastName,
    company: opts.company,
    api_key: opts.apiKey,
  });
  const resp = await fetch(`https://api.hunter.io/v2/email-finder?${params.toString()}`);
  const json = (await resp.json().catch(() => ({}))) as {
    data?: { email?: string | null; score?: number | null };
    errors?: Array<{ details?: string }>;
  };
  if (!resp.ok) {
    return {
      email: '',
      score: '',
      credited: false,
      error: json.errors?.[0]?.details || `hunter_${resp.status}`,
    };
  }
  const email = json.data?.email?.trim() || '';
  if (!email.includes('@')) return { email: '', score: '', credited: false };
  return {
    email,
    score: json.data?.score != null ? String(json.data.score) : '',
    credited: true,
  };
}

function toDiscovered(opts: {
  company: string;
  domain: string;
  name: string;
  title: string;
  source: string;
  linkedin?: string;
  apolloPersonId?: string;
  apolloOrgId?: string;
  priority?: string;
  functionFit?: string;
  note?: string;
}): DiscoveredRow {
  const { first, last } = splitName(opts.name);
  const rank = titleRank(opts.title);
  return {
    row_key: rowKey(opts.company, opts.name),
    company: opts.company,
    company_domain: opts.domain,
    contact_name: opts.name,
    first_name: first,
    last_name: last,
    title: opts.title,
    priority: opts.priority || (rank >= 80 ? 'A - Tier 1' : rank >= 60 ? 'B - Warm intro' : 'C - Secondary'),
    function_fit: opts.functionFit || 'Disability / Claims',
    discovery_source: opts.source,
    title_rank: String(rank),
    linkedin_url: opts.linkedin || '',
    apollo_person_id: opts.apolloPersonId || '',
    apollo_org_id: opts.apolloOrgId || '',
    outreach_note: opts.note || `Discovered via ${opts.source} disability title search.`,
  };
}

function pickTopPerCompany(
  rows: DiscoveredRow[],
  maxPerCompany: number,
): DiscoveredRow[] {
  const byCompany = new Map<string, DiscoveredRow[]>();
  for (const row of rows) {
    const list = byCompany.get(row.company) ?? [];
    list.push(row);
    byCompany.set(row.company, list);
  }
  const out: DiscoveredRow[] = [];
  for (const [, list] of byCompany) {
    list.sort((a, b) => Number(b.title_rank) - Number(a.title_rank) || a.contact_name.localeCompare(b.contact_name));
    // Prefer seed rows first
    const seeds = list.filter((r) => r.discovery_source === 'seed');
    const others = list.filter((r) => r.discovery_source !== 'seed');
    const merged = [...seeds, ...others];
    const seen = new Set<string>();
    for (const row of merged) {
      if (seen.has(row.row_key)) continue;
      seen.add(row.row_key);
      out.push(row);
      if (seen.size >= maxPerCompany) break;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.runDir, { recursive: true });

  const existingRows = existsSync(args.existing)
    ? readCsv(args.existing).map(stripBomKey)
    : [];
  const existingKeys = new Set(
    existingRows
      .filter((r) => (r.contact_name || '').trim() && !(r.contact_name || '').startsWith('('))
      .map((r) => rowKey(r.company || '', r.contact_name || '')),
  );

  const carriers =
    args.maxCompanies != null ? CARRIERS.slice(0, args.maxCompanies) : [...CARRIERS];

  console.log(
    `[disability-waterfall] carriers=${carriers.length} seeds=${SEED_CONTACTS.length} existing=${existingKeys.size} mode=${args.dryRun ? 'dry-run' : 'live'} stage=${args.stage}`,
  );

  if (args.dryRun) {
    const estimate = {
      mode: 'dry-run',
      carriers,
      seed_contacts: SEED_CONTACTS.map((s) => `${s.contact_name} @ ${s.company}`),
      max_new_per_company: args.maxNewPerCompany,
      existing_named_contacts: existingKeys.size,
      estimated_max_billable: {
        apollo_org_calls: carriers.length,
        apollo_people_searches: carriers.length,
        apollo_email_matches: carriers.length * args.maxNewPerCompany,
        prospeo_search_pages: carriers.length,
        prospeo_email_enriches: carriers.length * args.maxNewPerCompany,
        hunter_email_finder: carriers.length * args.maxNewPerCompany,
      },
      note: 'Worst case if every stage misses until the last. Search is cheap; email reveal is the spend. No phones.',
      titles: APOLLO_TITLES,
      company_domains: Object.fromEntries(carriers.map((c) => [c, COMPANY_DOMAINS[c]])),
    };
    writeFileSync(join(args.runDir, 'dry_run_estimate.json'), `${JSON.stringify(estimate, null, 2)}\n`);
    console.log(JSON.stringify(estimate, null, 2));
    return;
  }

  const targetEnv = args.targetEnv ?? resolveSelfRecoveryTargetEnv();
  await loadSelfRecoveryEnv({ targetEnv });
  const apolloResolved = await resolveApolloApiKey({ targetEnv });
  process.env.APOLLO_API_KEY = apolloResolved.apiKey;
  console.log(`[disability-waterfall] Apollo key: ${apolloResolved.source}`);

  await ensureEnv({ apollo: false, prospeo: true, serper: false });
  if (process.env.PROSPEO_API_KEY?.trim()) {
    console.log('[disability-waterfall] Prospeo key ready via ensureEnv');
  } else {
    console.warn('[disability-waterfall] No valid Prospeo key — Prospeo stages skipped');
  }

  const ckPath = join(args.runDir, 'checkpoint.json');
  let ck = loadCheckpoint(ckPath);
  const apolloOptions: ApolloClientOptions = { useFixtures: false };
  const apiKey = process.env.APOLLO_API_KEY!;

  // -------- Discover --------
  if (args.stage !== 'enrich' && ck.discovered.length === 0) {
    ck.stage = 'discover';
    const candidates: DiscoveredRow[] = [];

    // Seeds
    for (const seed of SEED_CONTACTS) {
      if (!carriers.includes(seed.company)) continue;
      const key = rowKey(seed.company, seed.contact_name);
      if (existingKeys.has(key)) continue;
      const row = toDiscovered({
        company: seed.company,
        domain: COMPANY_DOMAINS[seed.company] || '',
        name: seed.contact_name,
        title: seed.title,
        source: 'seed',
        priority: seed.priority,
        functionFit: seed.function_fit,
        note: seed.outreach_note,
      });
      candidates.push(row);
      bump(ck.tallies.by_discovery_source, 'seed');
    }

    for (const company of carriers) {
      if (args.maxApollo != null && ck.tallies.apollo_org_calls + ck.tallies.apollo_search_calls >= args.maxApollo) {
        ck.status = 'credit_limit';
        ck.stop_reason = 'max_apollo_calls';
        break;
      }

      const domain = COMPANY_DOMAINS[company] || '';
      let orgId = '';

      try {
        const org = await enrichOrganization({ domain, name: company }, apolloOptions);
        ck.tallies.apollo_org_calls += 1;
        const mapped = mapOrganization(org);
        orgId = mapped.apollo_org_id;
        console.log(`[discover] org ${company} → ${orgId || 'not_found'} (${domain})`);
      } catch (e) {
        ck.tallies.apollo_org_calls += 1;
        console.warn(
          `[discover] org resolve failed ${company}:`,
          e instanceof Error ? e.message : e,
        );
      }

      await sleep(REQUEST_GAP_MS);

      let people: ApiSearchPerson[] = [];
      try {
        const body: Record<string, unknown> = {
          person_titles: APOLLO_TITLES,
          person_seniorities: [...PERSON_SENIORITIES],
          person_locations: [...PERSON_LOCATIONS],
          include_similar_titles: true,
          page: 1,
          per_page: 25,
        };
        if (orgId) body.organization_ids = [orgId];
        else if (domain) body.q_organization_domains_list = [domain];

        people = await apolloPeopleSearch(body, apiKey);
        ck.tallies.apollo_search_calls += 1;
      } catch (e) {
        ck.tallies.apollo_search_calls += 1;
        console.warn(
          `[discover] apollo search failed ${company}:`,
          e instanceof Error ? e.message : e,
        );
      }

      let apolloHits = 0;
      for (const p of people) {
        const name =
          [p.first_name, p.last_name].filter(Boolean).join(' ').trim() ||
          (p.name || '').trim();
        const title = (p.title || '').trim();
        if (!isUsablePersonName(name, p.first_name || '', p.last_name || '')) continue;
        if (!name || isExcludedTitle(title)) continue;
        if (titleRank(title) < 40) continue;
        const key = rowKey(company, name);
        if (existingKeys.has(key)) continue;
        candidates.push(
          toDiscovered({
            company,
            domain,
            name,
            title,
            source: 'apollo_search',
            linkedin: p.linkedin_url || '',
            apolloPersonId: p.id || '',
            apolloOrgId: orgId,
          }),
        );
        apolloHits += 1;
        bump(ck.tallies.by_discovery_source, 'apollo_search');
      }
      console.log(`[discover] apollo ${company}: ${apolloHits} candidates`);

      // Prospeo search if company still short of cap (counting only new for this company)
      const companyNew = candidates.filter((c) => c.company === company);
      if (
        companyNew.length < args.maxNewPerCompany &&
        process.env.PROSPEO_API_KEY?.trim() &&
        (args.maxProspeo == null || ck.tallies.prospeo_search_calls < args.maxProspeo)
      ) {
        try {
          const filters: Record<string, unknown> = {
            person_job_title: {
              include: [
                'disability',
                'invalidité',
                'invalidite',
                'claims',
                'réclamations',
                'reclamations',
                'group life',
                'assurance salaire',
                'AMCS',
              ],
              match_mode: 'CONTAINS',
            },
            company: domain
              ? { websites: { include: [domain] } }
              : { names: { include: [company] } },
          };
          const search = await searchPerson(filters, { page: 1 });
          ck.tallies.prospeo_search_calls += 1;
          for (const hit of search?.results ?? []) {
            const person = hit.person;
            const name =
              (person?.full_name ||
                [person?.first_name, person?.last_name].filter(Boolean).join(' ')).trim() ||
              '';
            const title = (person?.current_job_title || '').trim();
            if (!isUsablePersonName(name, person?.first_name || '', person?.last_name || '')) continue;
            if (!name || isExcludedTitle(title)) continue;
            if (titleRank(title) < 40) continue;
            const key = rowKey(company, name);
            if (existingKeys.has(key)) continue;
            if (candidates.some((c) => c.row_key === key)) continue;
            candidates.push(
              toDiscovered({
                company,
                domain,
                name,
                title,
                source: 'prospeo_search',
                linkedin: person?.linkedin_url || '',
              }),
            );
            bump(ck.tallies.by_discovery_source, 'prospeo_search');
          }
          console.log(
            `[discover] prospeo ${company}: +${(search?.results ?? []).length} raw results`,
          );
        } catch (e) {
          ck.tallies.prospeo_search_calls += 1;
          console.warn(
            `[discover] prospeo search failed ${company}:`,
            e instanceof Error ? e.message : e,
          );
        }
        await sleep(REQUEST_GAP_MS);
      }

      await sleep(REQUEST_GAP_MS);
    }

    // Dedupe candidates by row_key keeping highest title_rank
    const best = new Map<string, DiscoveredRow>();
    for (const row of candidates) {
      const prev = best.get(row.row_key);
      if (!prev || Number(row.title_rank) > Number(prev.title_rank)) best.set(row.row_key, row);
    }
    const deduped = [...best.values()].filter((r) => !existingKeys.has(r.row_key));
    ck.discovered = pickTopPerCompany(deduped, args.maxNewPerCompany);
    ck.tallies.discovered = ck.discovered.length;
    ck.stage = 'enrich';
    saveCheckpoint(ckPath, ck);
    writeCsv(join(args.runDir, 'discovered.csv'), ck.discovered, [...DISCOVERED_COLUMNS]);
    console.log(`[discover] kept ${ck.discovered.length} contacts after per-company cap`);
  }

  // -------- Enrich emails --------
  if (args.stage === 'discover') {
    saveCheckpoint(ckPath, ck);
    writeFileSync(
      join(args.runDir, 'spend_tally.json'),
      `${JSON.stringify({ status: ck.status, stage: ck.stage, tallies: ck.tallies }, null, 2)}\n`,
    );
    return;
  }

  let hunterReady = false;
  let hunterKey = '';

  for (let i = ck.enrich_next_index; i < ck.discovered.length; i++) {
    if (args.maxApollo != null && ck.tallies.apollo_email_calls >= args.maxApollo) {
      ck.status = 'credit_limit';
      ck.stop_reason = 'max_apollo_calls';
      break;
    }
    if (args.maxProspeo != null && ck.tallies.prospeo_email_calls >= args.maxProspeo) {
      ck.status = 'credit_limit';
      ck.stop_reason = 'max_prospeo_credits';
      break;
    }
    if (args.maxHunter != null && ck.tallies.hunter_credits >= args.maxHunter) {
      ck.status = 'credit_limit';
      ck.stop_reason = 'max_hunter_credits';
      break;
    }

    const row = ck.discovered[i]!;
    let email = '';
    let emailSource = '';
    let emailConfidence = '';
    let linkedin = row.linkedin_url;
    let apolloPersonId = row.apollo_person_id;
    let status = 'no_match';
    let error = '';
    let apolloCalls = 0;
    let prospeoCalls = 0;
    let hunterCalls = 0;
    let hunterCredits = 0;

    try {
      const person = await enrichPersonByName(
        {
          firstName: row.first_name,
          lastName: row.last_name,
          organizationName: row.company,
          title: row.title || undefined,
          domain: row.company_domain || undefined,
          linkedinUrl: linkedin || undefined,
        },
        apolloOptions,
      );
      apolloCalls = 1;
      ck.tallies.apollo_email_calls += 1;
      email = apolloEmail(person);
      if (email) {
        emailSource = 'apollo';
        status = 'matched';
        linkedin = person?.linkedin_url || linkedin;
        apolloPersonId = person?.id || apolloPersonId;
        emailConfidence = (person as { email_status?: string })?.email_status || '';
        error = '';
      } else {
        linkedin = person?.linkedin_url || linkedin;
        apolloPersonId = person?.id || apolloPersonId;
        status = person ? 'apollo_no_email' : 'apollo_no_match';
      }
    } catch (e) {
      apolloCalls = 1;
      ck.tallies.apollo_email_calls += 1;
      status = 'apollo_error';
      error = e instanceof Error ? e.message : String(e);
    }

    if (!email && process.env.PROSPEO_API_KEY?.trim()) {
      try {
        const enrich = await enrichPersonEmailOnly({
          firstName: row.first_name,
          lastName: row.last_name,
          fullName: row.contact_name,
          companyName: row.company,
          companyWebsite: row.company_domain ? `https://${row.company_domain}` : null,
          linkedinUrl: linkedin || null,
        });
        prospeoCalls = 1;
        ck.tallies.prospeo_email_calls += 1;
        const pEmail = enrich?.person?.email?.email?.trim() || '';
        if (pEmail.includes('@')) {
          email = pEmail;
          emailSource = 'prospeo';
          status = 'matched';
          emailConfidence = enrich?.person?.email?.status || '';
          linkedin = enrich?.person?.linkedin_url || linkedin;
          error = '';
        } else {
          status = `${status};prospeo_no_match`;
        }
      } catch (e) {
        prospeoCalls = 1;
        ck.tallies.prospeo_email_calls += 1;
        const msg = e instanceof Error ? e.message : String(e);
        error = error ? `${error}; prospeo:${msg}` : `prospeo:${msg}`;
        status = `${status};prospeo_error`;
      }
    }

    if (!email && row.company_domain) {
      try {
        if (!hunterReady) {
          const resolved = await resolveHunterApiKey({ targetEnv });
          hunterKey = resolved.apiKey;
          hunterReady = true;
          console.log(`[disability-waterfall] Hunter key: ${resolved.source}`);
        }
        const hunter = await hunterEmailFinder({
          domain: row.company_domain,
          firstName: row.first_name,
          lastName: row.last_name,
          company: row.company,
          apiKey: hunterKey,
        });
        hunterCalls = 1;
        ck.tallies.hunter_calls += 1;
        if (hunter.credited) {
          hunterCredits = 1;
          ck.tallies.hunter_credits += 1;
        }
        if (hunter.email) {
          email = hunter.email;
          emailSource = 'hunter';
          status = 'matched';
          emailConfidence = hunter.score;
          error = '';
        } else if (hunter.error) {
          error = error ? `${error}; hunter:${hunter.error}` : `hunter:${hunter.error}`;
          status = `${status};hunter_error`;
        } else {
          status = `${status};hunter_no_match`;
        }
      } catch (e) {
        hunterCalls = 1;
        ck.tallies.hunter_calls += 1;
        const msg = e instanceof Error ? e.message : String(e);
        error = error ? `${error}; hunter:${msg}` : `hunter:${msg}`;
        status = `${status};hunter_error`;
      }
    }

    if (email) {
      ck.tallies.matched_email += 1;
      bump(ck.tallies.by_email_source, emailSource);
    }

    const enriched: EnrichedRow = {
      ...row,
      linkedin_url: linkedin,
      apollo_person_id: apolloPersonId,
      email,
      email_source: emailSource,
      email_confidence: emailConfidence,
      status,
      error,
      apollo_calls: String(apolloCalls),
      prospeo_calls: String(prospeoCalls),
      hunter_calls: String(hunterCalls),
      hunter_credits: String(hunterCredits),
    };
    ck.enriched = ck.enriched.filter((r) => r.row_key !== enriched.row_key);
    ck.enriched.push(enriched);
    ck.enrich_next_index = i + 1;
    saveCheckpoint(ckPath, ck);

    console.log(
      `[enrich ${i + 1}/${ck.discovered.length}] ${row.contact_name} @ ${row.company} → ${email || status} (${emailSource || 'none'})`,
    );
    await sleep(REQUEST_GAP_MS);
  }

  if (ck.status === 'in_progress' && ck.enrich_next_index >= ck.discovered.length) {
    ck.status = 'completed';
    ck.stage = 'done';
    ck.stop_reason = 'done';
  }
  saveCheckpoint(ckPath, ck);

  writeCsv(join(args.runDir, 'discovered.csv'), ck.discovered, [...DISCOVERED_COLUMNS]);
  writeCsv(join(args.runDir, 'enriched.csv'), ck.enriched, [...ENRICHED_COLUMNS]);

  // Merge into outreach export
  const enrichedByKey = new Map(ck.enriched.map((r) => [r.row_key, r]));
  const merged = [...existingRows];
  const mergedKeys = new Set(
    merged
      .filter((r) => (r.contact_name || '').trim())
      .map((r) => rowKey(r.company || '', r.contact_name || '')),
  );

  // Company metadata from existing outreach rows (rank, domicile, etc.)
  const companyMeta = new Map<string, Record<string, string>>();
  for (const r of existingRows) {
    const c = (r.company || '').trim();
    if (!c || companyMeta.has(c)) continue;
    companyMeta.set(c, {
      rank: r.rank || '',
      regulated_by: r.regulated_by || '',
      domicile: r.domicile || '',
      size_indicator: r.size_indicator || '',
      carrier_notes: r.carrier_notes || '',
    });
  }

  for (const hit of ck.enriched) {
    if (mergedKeys.has(hit.row_key)) continue;
    const meta = companyMeta.get(hit.company) || {};
    const confidenceNote =
      hit.discovery_source === 'seed'
        ? 'Title from LinkedIn / public research Aug 2026'
        : `Title from ${hit.discovery_source} Aug 2026`;
    merged.push({
      rank: meta.rank || '',
      company: hit.company,
      regulated_by: meta.regulated_by || '',
      domicile: meta.domicile || '',
      size_indicator: meta.size_indicator || '',
      carrier_notes: meta.carrier_notes || '',
      contact_name: hit.contact_name,
      title: hit.title,
      function_fit: hit.function_fit,
      priority: hit.priority,
      email_status: hit.email ? 'Not published' : 'not_found',
      email: hit.email,
      confidence: confidenceNote,
      source_url: '',
      outreach_note: hit.outreach_note,
      company_domain: hit.company_domain,
      email_source: hit.email_source,
      email_confidence: hit.email_confidence,
      contact_linkedin: hit.linkedin_url,
      enrich_status: hit.status,
      enrich_error: hit.error,
      discovery_source: hit.discovery_source,
    });
    mergedKeys.add(hit.row_key);
  }

  // Group new contacts under their company block (originals first, then new by priority)
  const companyOrder: string[] = [];
  const seenCo = new Set<string>();
  for (const r of merged) {
    const c = (r.company || '').trim();
    if (c && !seenCo.has(c)) {
      seenCo.add(c);
      companyOrder.push(c);
    }
  }
  const byCo = new Map<string, Record<string, string>[]>();
  const orphan: Record<string, string>[] = [];
  for (const r of merged) {
    const c = (r.company || '').trim();
    if (!c || !byCo.has(c) && !companyOrder.includes(c)) {
      if (!c) orphan.push(r);
      else {
        companyOrder.push(c);
        byCo.set(c, [r]);
      }
      continue;
    }
    if (!byCo.has(c)) byCo.set(c, []);
    byCo.get(c)!.push(r);
  }
  const ordered: Record<string, string>[] = [];
  for (const c of companyOrder) {
    const group = byCo.get(c) || [];
    const originals = group.filter((r) => !(r.discovery_source || '').trim());
    const news = group
      .filter((r) => (r.discovery_source || '').trim())
      .sort((a, b) => {
        const pa = (a.priority || '').startsWith('A') ? 0 : (a.priority || '').startsWith('B') ? 1 : 2;
        const pb = (b.priority || '').startsWith('A') ? 0 : (b.priority || '').startsWith('B') ? 1 : 2;
        return pa - pb || (a.contact_name || '').localeCompare(b.contact_name || '');
      });
    ordered.push(...originals, ...news);
  }
  ordered.push(...orphan);

  const mergedPath = join(args.runDir, 'outreach_with_emails.csv');
  writeCsvFromObjects(mergedPath, ordered);
  writeFileSync(
    join(args.runDir, 'spend_tally.json'),
    `${JSON.stringify(
      {
        status: ck.status,
        stop_reason: ck.stop_reason,
        tallies: ck.tallies,
        discovered: ck.discovered.length,
        enriched: ck.enriched.length,
        matched_email: ck.tallies.matched_email,
        merged_csv: mergedPath,
      },
      null,
      2,
    )}\n`,
  );

  console.log('[disability-waterfall] done', JSON.stringify(ck.tallies, null, 2));
  console.log(`[disability-waterfall] wrote ${mergedPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
