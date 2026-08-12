/**
 * Named-person email waterfall: Apollo → Prospeo → Hunter email-finder.
 *
 * Usage:
 *   npx tsx scripts/lead-sourcing/named-email-waterfall.ts \
 *     --input /path/to/list.csv \
 *     --run-dir scripts/lead-sourcing/output/quebec-carriers \
 *     --dry-run
 *
 *   npx tsx scripts/lead-sourcing/named-email-waterfall.ts \
 *     --input /path/to/list.csv \
 *     --run-dir scripts/lead-sourcing/output/quebec-carriers \
 *     --live
 *
 * Live requires explicit --live AND user spend OK (script-spend gate).
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
  enrichPersonByName,
  type ApolloClientOptions,
  type ApolloPerson,
} from './webinar-hosts/src/stage3-enrich/apolloClient.ts';
import { enrichPersonEmailOnly } from './webinar-outreach-enrich/src/prospeo.ts';
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
  'La Mutuelle des fonctionnaires du Quebec': 'mfq.qc.ca',
  'Chubb Life Insurance Company of Canada': 'chubb.com',
  'CIGNA Life Insurance Company of Canada': 'cigna.com',
};

type InputRow = Record<string, string>;

type ResultRow = {
  row_key: string;
  company: string;
  company_domain: string;
  contact_name: string;
  first_name: string;
  last_name: string;
  title: string;
  priority: string;
  seed_email: string;
  email: string;
  email_source: string;
  email_confidence: string;
  linkedin_url: string;
  apollo_person_id: string;
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
  started_at: string;
  updated_at: string;
  next_index: number;
  total: number;
  stop_reason: string;
  tallies: {
    apollo_calls: number;
    prospeo_calls: number;
    hunter_calls: number;
    hunter_credits: number;
    matched: number;
    by_source: Record<string, number>;
    by_status: Record<string, number>;
  };
  results: ResultRow[];
};

const RESULT_COLUMNS = [
  'row_key',
  'company',
  'company_domain',
  'contact_name',
  'first_name',
  'last_name',
  'title',
  'priority',
  'seed_email',
  'email',
  'email_source',
  'email_confidence',
  'linkedin_url',
  'apollo_person_id',
  'status',
  'error',
  'apollo_calls',
  'prospeo_calls',
  'hunter_calls',
  'hunter_credits',
] as const;

const REQUEST_GAP_MS = 250;

function parseArgs(argv: string[]) {
  let input = '';
  let runDir = 'scripts/lead-sourcing/output/named-email-waterfall';
  let live = false;
  let dryRun = false;
  let retryMisses = false;
  let maxRows: number | null = null;
  let maxApollo: number | null = null;
  let maxProspeo: number | null = null;
  let maxHunter: number | null = null;
  let targetEnv: 'prod' | 'dev' | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' && argv[i + 1]) input = argv[++i]!;
    else if (arg === '--run-dir' && argv[i + 1]) runDir = argv[++i]!;
    else if (arg === '--live') live = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--retry-misses') retryMisses = true;
    else if (arg === '--max-rows' && argv[i + 1]) maxRows = Number(argv[++i]) || null;
    else if (arg === '--max-apollo-calls' && argv[i + 1]) maxApollo = Number(argv[++i]) || null;
    else if (arg === '--max-prospeo-credits' && argv[i + 1]) maxProspeo = Number(argv[++i]) || null;
    else if (arg === '--max-hunter-credits' && argv[i + 1]) maxHunter = Number(argv[++i]) || null;
    else if (arg === '--target-env' && argv[i + 1]) {
      const v = argv[++i]!.toLowerCase();
      if (v === 'prod' || v === 'dev') targetEnv = v;
    }
  }
  if (!input) throw new Error('--input is required');
  if (live && dryRun) throw new Error('Pass only one of --live or --dry-run');
  if (!live && !dryRun) throw new Error('Pass --dry-run or --live');
  return {
    input: resolve(input),
    runDir: resolve(runDir),
    live,
    dryRun,
    retryMisses,
    maxRows,
    maxApollo,
    maxProspeo,
    maxHunter,
    targetEnv,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function stripBomKey(row: InputRow): InputRow {
  const out: InputRow = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/^\ufeff/, '')] = v;
  }
  return out;
}

function hasRealEmail(raw: string | undefined): boolean {
  const e = (raw || '').trim();
  if (!e || !e.includes('@') || /\s/.test(e)) return false;
  if (/convention|inferred|reported|unverified/i.test(e)) return false;
  return true;
}

function splitName(full: string): { first: string; last: string } {
  const cleaned = full.trim().replace(/\s+/g, ' ');
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function rowKey(row: InputRow): string {
  return `${(row.company || '').trim()}|${(row.contact_name || '').trim()}`.toLowerCase();
}

function apolloEmail(person: ApolloPerson | null): string {
  const email = person?.email?.trim() || '';
  return email.includes('@') ? email : '';
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
    errors?: Array<{ details?: string; id?: string }>;
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
  if (!email.includes('@')) {
    return { email: '', score: '', credited: false };
  }
  return {
    email,
    score: json.data?.score != null ? String(json.data.score) : '',
    credited: true,
  };
}

function emptyCheckpoint(total: number): Checkpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    started_at: now,
    updated_at: now,
    next_index: 0,
    total,
    stop_reason: '',
    tallies: {
      apollo_calls: 0,
      prospeo_calls: 0,
      hunter_calls: 0,
      hunter_credits: 0,
      matched: 0,
      by_source: {},
      by_status: {},
    },
    results: [],
  };
}

function loadCheckpoint(path: string, total: number): Checkpoint {
  if (!existsSync(path)) return emptyCheckpoint(total);
  const ck = JSON.parse(readFileSync(path, 'utf8')) as Checkpoint;
  if (ck.version !== 1) return emptyCheckpoint(total);
  return ck;
}

function saveCheckpoint(path: string, ck: Checkpoint): void {
  ck.updated_at = new Date().toISOString();
  writeFileSync(path, JSON.stringify(ck, null, 2));
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.runDir, { recursive: true });

  const rows = readCsv(args.input).map(stripBomKey);

  const work = rows.filter((r) => {
    const name = (r.contact_name || '').trim();
    if (!name || name.startsWith('(')) return false;
    return !hasRealEmail(r.email);
  });
  const capped = args.maxRows != null ? work.slice(0, args.maxRows) : work;

  const alreadyHave = rows.filter((r) => {
    const name = (r.contact_name || '').trim();
    return name && !name.startsWith('(') && hasRealEmail(r.email);
  });

  console.log(
    `[named-email-waterfall] input=${args.input} work=${capped.length} seeded_emails=${alreadyHave.length} mode=${args.dryRun ? 'dry-run' : 'live'}`,
  );

  if (args.dryRun) {
    const estimate = {
      mode: 'dry-run',
      named_needing_email: capped.length,
      seeded_emails_skipped: alreadyHave.length,
      companies_missing_domain: [
        ...new Set(
          capped
            .filter((r) => !COMPANY_DOMAINS[(r.company || '').trim()])
            .map((r) => r.company),
        ),
      ],
      max_billable: {
        apollo_people_match: capped.length,
        prospeo_enrich: capped.length,
        hunter_email_finder: capped.length,
      },
      note: 'Worst case if every provider misses until the last. Actual spend is lower when Apollo/Prospeo hit.',
      company_domains: Object.fromEntries(
        [...new Set(capped.map((r) => (r.company || '').trim()))].map((c) => [
          c,
          COMPANY_DOMAINS[c] || '',
        ]),
      ),
    };
    writeFileSync(join(args.runDir, 'dry_run_estimate.json'), JSON.stringify(estimate, null, 2));
    console.log(JSON.stringify(estimate, null, 2));
    return;
  }

  const targetEnv = args.targetEnv ?? resolveSelfRecoveryTargetEnv();
  await loadSelfRecoveryEnv({ targetEnv });

  const apolloResolved = await resolveApolloApiKey({ targetEnv });
  process.env.APOLLO_API_KEY = apolloResolved.apiKey;
  console.log(`[named-email-waterfall] Apollo key: ${apolloResolved.source}`);

  // Prefer a validated Prospeo key (prod often has the live one; sandbox may be stale).
  await ensureEnv({ apollo: false, prospeo: true, serper: false });
  if (!process.env.PROSPEO_API_KEY?.trim()) {
    console.warn('[named-email-waterfall] No valid Prospeo key — will skip Prospeo stage');
  } else {
    console.log('[named-email-waterfall] Prospeo key ready via ensureEnv');
  }

  let hunterReady = false;
  let hunterKey = '';

  const ckPath = join(args.runDir, 'checkpoint.json');
  let ck = loadCheckpoint(ckPath, capped.length);
  ck.total = capped.length;

  // Rebuild work queue: either resume from next_index, or only rows still missing email.
  let indices: number[] = [];
  if (args.retryMisses) {
    const missKeys = new Set(
      ck.results.filter((r) => !r.email?.includes('@')).map((r) => r.row_key),
    );
    indices = capped
      .map((row, idx) => ({ idx, key: rowKey(row) }))
      .filter((x) => missKeys.has(x.key))
      .map((x) => x.idx);
    // Drop prior miss rows so we can replace them
    ck.results = ck.results.filter((r) => r.email?.includes('@'));
    ck.tallies.matched = ck.results.filter((r) => r.email?.includes('@')).length;
    ck.tallies.by_source = {};
    for (const r of ck.results) {
      if (r.email_source) bump(ck.tallies.by_source, r.email_source);
    }
    ck.status = 'in_progress';
    ck.stop_reason = '';
    console.log(`[named-email-waterfall] retry-misses: ${indices.length} rows`);
  } else {
    for (let i = ck.next_index; i < capped.length; i++) indices.push(i);
  }

  const apolloOptions: ApolloClientOptions = { useFixtures: false };

  for (const i of indices) {
    if (args.maxApollo != null && ck.tallies.apollo_calls >= args.maxApollo) {
      ck.status = 'credit_limit';
      ck.stop_reason = 'max_apollo_calls';
      break;
    }
    if (args.maxProspeo != null && ck.tallies.prospeo_calls >= args.maxProspeo) {
      ck.status = 'credit_limit';
      ck.stop_reason = 'max_prospeo_credits';
      break;
    }
    if (args.maxHunter != null && ck.tallies.hunter_credits >= args.maxHunter) {
      ck.status = 'credit_limit';
      ck.stop_reason = 'max_hunter_credits';
      break;
    }

    const row = capped[i]!;
    const company = (row.company || '').trim();
    const contactName = (row.contact_name || '').trim();
    const { first, last } = splitName(contactName);
    const domain = COMPANY_DOMAINS[company] || '';
    const title = (row.title || '').trim();

    let email = '';
    let emailSource = '';
    let emailConfidence = '';
    let linkedin = '';
    let apolloPersonId = '';
    let status = 'no_match';
    let error = '';
    let apolloCalls = 0;
    let prospeoCalls = 0;
    let hunterCalls = 0;
    let hunterCredits = 0;

    // 1) Apollo (skip on retry-misses — already attempted)
    if (!args.retryMisses) {
      try {
        const person = await enrichPersonByName(
          {
            firstName: first,
            lastName: last,
            organizationName: company,
            title: title || undefined,
            domain: domain || undefined,
          },
          apolloOptions,
        );
        apolloCalls = 1;
        ck.tallies.apollo_calls += 1;
        email = apolloEmail(person);
        if (email) {
          emailSource = 'apollo';
          status = 'matched';
          linkedin = person?.linkedin_url || '';
          apolloPersonId = person?.id || '';
          emailConfidence = person?.email_status || '';
        } else {
          linkedin = person?.linkedin_url || '';
          apolloPersonId = person?.id || '';
          status = person ? 'apollo_no_email' : 'apollo_no_match';
        }
      } catch (e) {
        apolloCalls = 1;
        ck.tallies.apollo_calls += 1;
        status = 'apollo_error';
        error = e instanceof Error ? e.message : String(e);
      }
    } else {
      status = 'retry_miss';
    }

    // 2) Prospeo on miss
    if (!email && process.env.PROSPEO_API_KEY?.trim()) {
      try {
        const enrich = await enrichPersonEmailOnly({
          firstName: first,
          lastName: last,
          fullName: contactName,
          companyName: company,
          companyWebsite: domain ? `https://${domain}` : null,
          linkedinUrl: linkedin || null,
        });
        prospeoCalls = 1;
        ck.tallies.prospeo_calls += 1;
        const pEmail = enrich?.person?.email?.email?.trim() || '';
        if (pEmail.includes('@')) {
          email = pEmail;
          emailSource = 'prospeo';
          status = 'matched';
          emailConfidence = enrich?.person?.email?.status || '';
          linkedin = enrich?.person?.linkedin_url || linkedin;
          error = '';
        } else if (status === 'apollo_error') {
          status = 'prospeo_no_match';
        } else {
          status = `${status};prospeo_no_match`;
        }
      } catch (e) {
        prospeoCalls = 1;
        ck.tallies.prospeo_calls += 1;
        const msg = e instanceof Error ? e.message : String(e);
        error = error ? `${error}; prospeo:${msg}` : `prospeo:${msg}`;
        status = status.startsWith('apollo') ? `${status};prospeo_error` : 'prospeo_error';
      }
    } else if (!email) {
      status = `${status};prospeo_skipped`;
    }

    // 3) Hunter email-finder on miss
    if (!email && domain) {
      try {
        if (!hunterReady) {
          const resolved = await resolveHunterApiKey({ targetEnv });
          hunterKey = resolved.apiKey;
          console.log(`[named-email-waterfall] Hunter key: ${resolved.source}`);
          hunterReady = true;
        }
        const hunter = await hunterEmailFinder({
          domain,
          firstName: first,
          lastName: last,
          company,
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
    } else if (!email && !domain) {
      status = `${status};no_domain_for_hunter`;
      error = error || 'missing_company_domain';
    }

    if (email) {
      ck.tallies.matched += 1;
      bump(ck.tallies.by_source, emailSource);
    }
    bump(ck.tallies.by_status, status.split(';')[0] || status);

    const result: ResultRow = {
      row_key: rowKey(row),
      company,
      company_domain: domain,
      contact_name: contactName,
      first_name: first,
      last_name: last,
      title,
      priority: (row.priority || '').trim(),
      seed_email: (row.email || '').trim(),
      email,
      email_source: emailSource,
      email_confidence: emailConfidence,
      linkedin_url: linkedin,
      apollo_person_id: apolloPersonId,
      status,
      error,
      apollo_calls: String(apolloCalls),
      prospeo_calls: String(prospeoCalls),
      hunter_calls: String(hunterCalls),
      hunter_credits: String(hunterCredits),
    };
    // Replace any prior result for this key
    ck.results = ck.results.filter((r) => r.row_key !== result.row_key);
    ck.results.push(result);
    if (!args.retryMisses) ck.next_index = i + 1;
    saveCheckpoint(ckPath, ck);

    console.log(
      `[${i + 1}/${capped.length}] ${contactName} @ ${company} → ${email || status} (${emailSource || 'none'}) | a=${ck.tallies.apollo_calls} p=${ck.tallies.prospeo_calls} h=${ck.tallies.hunter_credits}`,
    );

    await sleep(REQUEST_GAP_MS);
  }

  const allMatchedOrDone =
    ck.results.length >= capped.length ||
    (args.retryMisses && indices.every((idx) => {
      const key = rowKey(capped[idx]!);
      return ck.results.some((r) => r.row_key === key);
    }));
  if (ck.status === 'in_progress' && (ck.next_index >= capped.length || (args.retryMisses && allMatchedOrDone))) {
    ck.status = 'completed';
    ck.stop_reason = args.retryMisses ? 'retry_done' : 'done';
    ck.next_index = capped.length;
  }
  saveCheckpoint(ckPath, ck);

  // Merge seed emails + enriched into outreach export
  const enrichedByKey = new Map(ck.results.map((r) => [r.row_key, r]));
  const merged = rows.map((r) => {
    const key = rowKey(r);
    const hit = enrichedByKey.get(key);
    const seed = hasRealEmail(r.email) ? (r.email || '').trim() : '';
    const email = seed || hit?.email || '';
    const emailSource = seed ? 'seed' : hit?.email_source || '';
    return {
      ...r,
      company_domain: COMPANY_DOMAINS[(r.company || '').trim()] || '',
      email,
      email_source: emailSource,
      email_confidence: seed ? (r.confidence || '').trim() : hit?.email_confidence || '',
      contact_linkedin: hit?.linkedin_url || '',
      enrich_status: seed ? 'seeded' : hit?.status || 'skipped',
      enrich_error: hit?.error || '',
    };
  });

  const resultsPath = join(args.runDir, 'enriched.csv');
  const mergedPath = join(args.runDir, 'outreach_with_emails.csv');
  writeCsv(resultsPath, ck.results, [...RESULT_COLUMNS]);
  writeCsvFromObjects(mergedPath, merged);
  writeFileSync(
    join(args.runDir, 'spend_tally.json'),
    `${JSON.stringify(
      {
        status: ck.status,
        stop_reason: ck.stop_reason,
        tallies: ck.tallies,
        results_csv: resultsPath,
        merged_csv: mergedPath,
      },
      null,
      2,
    )}\n`,
  );

  console.log('[named-email-waterfall] done', JSON.stringify(ck.tallies, null, 2));
  console.log(`[named-email-waterfall] wrote ${resultsPath}`);
  console.log(`[named-email-waterfall] wrote ${mergedPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
