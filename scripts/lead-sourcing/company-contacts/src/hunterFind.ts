/**
 * Full Hunter.io domain-search pass on Apollo rejects.
 *
 * Usage (from scripts/lead-sourcing/company-contacts):
 *   npm run hunter-find -- \
 *     --run-dir output/runs/2026-07-21-no-contact-found \
 *     --min-employees 11 \
 *     --additional-credits 3000 \
 *     --dry-run
 *
 * Resume-safe. Seeds from hunter-sample/ if present (no re-spend on those domains).
 * Early-stops if MV-pass rate falls below threshold after a minimum sample.
 *
 * Requires HUNTER_API_KEY (env or Amplify SSM). Optional MILLION_VERIFIER_API_KEY.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  loadSelfRecoveryEnv,
  resolveHunterApiKey,
  resolveMillionVerifierApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../self-recovery-env.ts';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { verifyEmailWithMillionVerifier } from '../../email-from-linkedin/src/millionVerifier.js';

type RejectedRow = {
  company_name: string;
  company_domain: string;
  employee_count?: string;
  industry?: string;
  apollo_org_id?: string;
  rejection_reason?: string;
  source_lists?: string;
};

type HunterEmail = {
  value?: string;
  type?: string;
  confidence?: number;
  first_name?: string;
  last_name?: string;
  position?: string;
  linkedin?: string;
};

type HunterResultRow = {
  company_name: string;
  company_domain: string;
  employee_count: string;
  industry: string;
  apollo_org_id: string;
  source_lists: string;
  apollo_rejection_reason: string;
  person_name: string;
  person_title: string;
  email: string;
  hunter_confidence: string;
  hunter_type: string;
  linkedin: string;
  mv_result: string;
  outcome: string;
  error: string;
};

type HunterCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed' | 'early_stop' | 'credit_limit';
  started_at: string;
  updated_at: string;
  next_index: number;
  total: number;
  credits_used: number;
  max_credits: number;
  stop_reason: string;
  stats: {
    with_exec_person: number;
    with_email: number;
    mv_pass: number;
    errors: number;
    by_outcome: Record<string, number>;
  };
  results: HunterResultRow[];
  seen_domains: string[];
  /** Domains searched (including no_emails). Optional for older checkpoints. */
  requests?: number;
  /** Credits billed this resume wave (additional-credits mode). */
  wave_credits_used?: number;
};

const HUNTER_COLUMNS = [
  'company_name',
  'company_domain',
  'employee_count',
  'industry',
  'apollo_org_id',
  'source_lists',
  'apollo_rejection_reason',
  'person_name',
  'person_title',
  'email',
  'hunter_confidence',
  'hunter_type',
  'linkedin',
  'mv_result',
  'outcome',
  'error',
] as const;

const CHECKPOINT_FILE = 'hunter_checkpoint.json';
const LOG_FILE = 'hunter_log.jsonl';
const REQUEST_GAP_MS = 200;

/** Historical overcount: every HTTP 200 was counted. True billed ≈ results with emails. */
const LEGACY_BILLED_CREDITS = 8080;

function parseArgs(argv: string[]): {
  runDir: string;
  maxCredits: number | null;
  additionalCredits: number | null;
  minEmployees: number;
  minDomainsBeforeStop: number;
  minMvPassRate: number;
  skipMv: boolean;
  dryRun: boolean;
  outDir: string;
} {
  let runDir = 'output/runs/2026-07-21-no-contact-found';
  let maxCredits: number | null = null;
  let additionalCredits: number | null = null;
  let minEmployees = 0;
  let minDomainsBeforeStop = 500;
  let minMvPassRate = 0.08;
  let skipMv = false;
  let dryRun = false;
  let outDir = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run-dir' && argv[i + 1]) runDir = argv[++i]!;
    else if (arg === '--max-credits' && argv[i + 1]) maxCredits = Number(argv[++i]) || 0;
    else if (arg === '--additional-credits' && argv[i + 1]) {
      additionalCredits = Number(argv[++i]) || 0;
    } else if (arg === '--min-employees' && argv[i + 1]) {
      minEmployees = Number(argv[++i]) || 0;
    } else if (arg === '--min-domains-before-stop' && argv[i + 1]) {
      minDomainsBeforeStop = Number(argv[++i]) || 500;
    } else if (arg === '--min-mv-pass-rate' && argv[i + 1]) {
      minMvPassRate = Number(argv[++i]) || 0.08;
    } else if (arg === '--skip-mv') skipMv = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--out-dir' && argv[i + 1]) outDir = argv[++i]!;
  }
  const resolvedRun = resolve(runDir);
  return {
    runDir: resolvedRun,
    maxCredits: maxCredits != null ? Math.max(0, maxCredits) : null,
    additionalCredits: additionalCredits != null ? Math.max(0, additionalCredits) : null,
    minEmployees: Math.max(0, minEmployees),
    minDomainsBeforeStop: Math.max(50, minDomainsBeforeStop),
    minMvPassRate: Math.min(1, Math.max(0, minMvPassRate)),
    skipMv,
    dryRun,
    outDir: outDir ? resolve(outDir) : join(resolvedRun, 'hunter'),
  };
}

function parseEmployeeCount(value: string | undefined): number {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function employeeBucket(n: number): string {
  if (n <= 0) return '0';
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 200) return '51-200';
  return '200+';
}

/** Hunter Domain Search bills when the domain returns at least one email. */
function resultLooksBilled(row: Pick<HunterResultRow, 'outcome' | 'email'>): boolean {
  if (row.outcome === 'no_emails' || row.outcome === 'error') return false;
  return true;
}

function billedFromResults(results: HunterResultRow[]): number {
  return results.filter((row) => resultLooksBilled(row)).length;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], rand: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

/** Prefer CEO/founder/owner/president; never treat VP/SVP as president. */
function titleTier(position: string | undefined): number {
  const p = (position ?? '').toLowerCase();
  if (!p) return 0;
  if (/\bvice\s+president\b/.test(p)) return 0;
  if (/\b(ceo|chief executive)\b/.test(p) || /\b(co-?founder|founder)\b/.test(p)) return 100;
  if (/\bowner\b/.test(p)) return 90;
  if (/\bpresident\b/.test(p)) return 80;
  if (/\bmanaging (partner|director)\b/.test(p)) return 70;
  return 0;
}

function pickBest(emails: HunterEmail[]): HunterEmail | null {
  let best: HunterEmail | null = null;
  let bestScore = -1;
  for (const email of emails) {
    if (!email.value?.includes('@')) continue;
    const tier = titleTier(email.position);
    if (tier <= 0) continue;
    const score = tier + (email.confidence ?? 0) / 100;
    if (score > bestScore) {
      bestScore = score;
      best = email;
    }
  }
  return best;
}

async function domainSearch(
  domain: string,
  apiKey: string,
): Promise<{ emails: HunterEmail[]; error?: string; creditUsed: boolean }> {
  const url = new URL('https://api.hunter.io/v2/domain-search');
  url.searchParams.set('domain', domain);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('limit', '10');

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url);
      const body = (await response.json()) as {
        data?: { emails?: HunterEmail[] };
        errors?: Array<{ details?: string; id?: string }>;
      };
      if (!response.ok) {
        const detail = body.errors?.[0]?.details ?? `HTTP ${response.status}`;
        // Errors rarely bill; treat as unbilled unless Hunter returns a clear charge path.
        const creditUsed = false;
        void creditUsed;
        return { emails: [], error: detail, creditUsed: false };
      }
      const emails = body.data?.emails ?? [];
      // Domain Search bills only when at least one email is returned.
      return { emails, creditUsed: emails.length > 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) {
        return { emails: [], error: `fetch failed: ${message}`, creditUsed: false };
      }
      const backoffMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      console.error(`\n[hunter] fetch retry ${attempt}/${maxAttempts} for ${domain}: ${message}`);
      await sleep(backoffMs);
    }
  }
  return { emails: [], error: 'fetch failed', creditUsed: false };
}

async function resolveHunterKey(): Promise<{ apiKey: string; source: string }> {
  const fromEnv = process.env.HUNTER_API_KEY?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: 'HUNTER_API_KEY environment variable' };

  const targets: Array<'prod' | 'dev'> = ['dev', resolveSelfRecoveryTargetEnv()];
  for (const targetEnv of [...new Set(targets)]) {
    try {
      return await resolveHunterApiKey({ targetEnv });
    } catch {
      // try next
    }
  }
  throw new Error('Missing HUNTER_API_KEY. Run: npx ampx sandbox secret set HUNTER_API_KEY');
}

async function ensureMvKey(): Promise<boolean> {
  if (process.env.MILLION_VERIFIER_API_KEY?.trim()) return true;
  const targets: Array<'prod' | 'dev'> = ['dev', resolveSelfRecoveryTargetEnv()];
  for (const targetEnv of [...new Set(targets)]) {
    try {
      const { apiKey } = await resolveMillionVerifierApiKey({ targetEnv });
      process.env.MILLION_VERIFIER_API_KEY = apiKey;
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

function emptyStats(): HunterCheckpoint['stats'] {
  return {
    with_exec_person: 0,
    with_email: 0,
    mv_pass: 0,
    errors: 0,
    by_outcome: {},
  };
}

function bumpOutcome(stats: HunterCheckpoint['stats'], outcome: string): void {
  stats.by_outcome[outcome] = (stats.by_outcome[outcome] ?? 0) + 1;
}

function applyResultStats(stats: HunterCheckpoint['stats'], row: HunterResultRow): void {
  bumpOutcome(stats, row.outcome);
  if (row.outcome === 'error') stats.errors += 1;
  if (row.person_title || row.email) stats.with_exec_person += 1;
  if (row.email) stats.with_email += 1;
  if (row.outcome === 'mv_pass') stats.mv_pass += 1;
}

function loadCheckpoint(outDir: string): HunterCheckpoint | null {
  const path = join(outDir, CHECKPOINT_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as HunterCheckpoint;
}

function saveCheckpoint(outDir: string, checkpoint: HunterCheckpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, CHECKPOINT_FILE), `${JSON.stringify(checkpoint, null, 2)}\n`);

  writeCsv(
    join(outDir, 'hunter_all.csv'),
    checkpoint.results.map((r) => ({ ...r })),
    [...HUNTER_COLUMNS],
  );

  const leads = checkpoint.results.filter(
    (r) => r.email && (r.outcome === 'mv_pass' || r.mv_result === 'ok' || r.mv_result === 'catch_all'),
  );
  writeCsv(
    join(outDir, 'hunter_leads.csv'),
    leads.map((r) => ({ ...r })),
    [...HUNTER_COLUMNS],
  );

  const summary = {
    status: checkpoint.status,
    stop_reason: checkpoint.stop_reason,
    processed: checkpoint.next_index,
    total: checkpoint.total,
    credits_used: checkpoint.credits_used,
    max_credits: checkpoint.max_credits,
    requests: checkpoint.requests ?? checkpoint.seen_domains.length,
    wave_credits_used: checkpoint.wave_credits_used ?? 0,
    ...checkpoint.stats,
    person_rate: checkpoint.next_index ? checkpoint.stats.with_exec_person / checkpoint.next_index : 0,
    email_rate: checkpoint.next_index ? checkpoint.stats.with_email / checkpoint.next_index : 0,
    mv_pass_rate: checkpoint.next_index ? checkpoint.stats.mv_pass / checkpoint.next_index : 0,
    leads: leads.length,
  };
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
}

function appendLog(outDir: string, row: Record<string, unknown>): void {
  appendFileSync(join(outDir, LOG_FILE), `${JSON.stringify(row)}\n`);
}

function sampleRowToResult(row: Record<string, string>): HunterResultRow {
  return {
    company_name: row.company_name ?? '',
    company_domain: (row.company_domain ?? '').trim().toLowerCase(),
    employee_count: row.employee_count ?? '',
    industry: '',
    apollo_org_id: '',
    source_lists: '',
    apollo_rejection_reason: 'seeded_from_hunter_sample',
    person_name: row.person_name ?? '',
    person_title: row.person_title ?? '',
    email: (row.email ?? '').trim().toLowerCase(),
    hunter_confidence: row.hunter_confidence ?? '',
    hunter_type: row.hunter_type ?? '',
    linkedin: row.linkedin ?? '',
    mv_result: row.mv_result ?? '',
    outcome: row.outcome ?? '',
    error: row.error ?? '',
  };
}

function buildCompanyPool(runDir: string): RejectedRow[] {
  const rejectsPath = join(runDir, 'rejected_companies.csv');
  if (!existsSync(rejectsPath)) {
    throw new Error(`rejected_companies.csv not found at ${rejectsPath}`);
  }
  const rejects = readCsv(rejectsPath) as RejectedRow[];

  const leadDomains = new Set<string>();
  const leadsPath = join(runDir, 'leads.csv');
  if (existsSync(leadsPath)) {
    for (const row of readCsv(leadsPath) as Array<{ website?: string }>) {
      const domain = (row.website ?? '').trim().toLowerCase();
      if (domain) leadDomains.add(domain);
    }
  }

  const byDomain = new Map<string, RejectedRow>();
  for (const row of rejects) {
    const domain = (row.company_domain ?? '').trim().toLowerCase();
    if (!domain || leadDomains.has(domain) || byDomain.has(domain)) continue;
    byDomain.set(domain, {
      ...row,
      company_domain: domain,
    });
  }

  const pool = [...byDomain.values()];
  const seed = createHash('sha256').update('hunter-full-v1').digest().readUInt32BE(0);
  shuffleInPlace(pool, mulberry32(seed));
  return pool;
}

function seedFromSample(runDir: string, checkpoint: HunterCheckpoint, pool: RejectedRow[]): void {
  const samplePath = join(runDir, 'hunter-sample', 'hunter_contacts.csv');
  if (!existsSync(samplePath)) return;

  const sampleRows = readCsv(samplePath) as Array<Record<string, string>>;
  const poolByDomain = new Map(pool.map((c) => [c.company_domain, c]));
  const seen = new Set(checkpoint.seen_domains);

  for (const raw of sampleRows) {
    const domain = (raw.company_domain ?? '').trim().toLowerCase();
    if (!domain || seen.has(domain)) continue;
    const company = poolByDomain.get(domain);
    const row = sampleRowToResult(raw);
    if (company) {
      row.employee_count = company.employee_count ?? row.employee_count;
      row.industry = company.industry ?? '';
      row.apollo_org_id = company.apollo_org_id ?? '';
      row.source_lists = company.source_lists ?? '';
      row.apollo_rejection_reason = company.rejection_reason ?? row.apollo_rejection_reason;
    }
    // Re-score VP false positives from sample as no_exec_title
    if (row.email && titleTier(row.person_title) <= 0) {
      row.outcome = 'no_exec_title';
      row.email = '';
      row.person_name = '';
      row.person_title = '';
      row.mv_result = '';
    } else if (row.mv_result === 'ok' || row.mv_result === 'catch_all') {
      row.outcome = 'mv_pass';
    }

    checkpoint.results.push(row);
    checkpoint.seen_domains.push(domain);
    seen.add(domain);
    // Sample credits were spent before the current balance — don't count against max_credits.
    applyResultStats(checkpoint.stats, row);
  }
}

function meetsMinEmployees(company: RejectedRow, minEmployees: number): boolean {
  if (minEmployees <= 0) return true;
  return parseEmployeeCount(company.employee_count) >= minEmployees;
}

function summarizeEligible(
  pool: RejectedRow[],
  seen: Set<string>,
  minEmployees: number,
): {
  unseenEligible: number;
  unseenSkippedSmall: number;
  byBucket: Record<string, number>;
} {
  const byBucket: Record<string, number> = {
    '0': 0,
    '1-10': 0,
    '11-50': 0,
    '51-200': 0,
    '200+': 0,
  };
  let unseenEligible = 0;
  let unseenSkippedSmall = 0;
  for (const company of pool) {
    if (seen.has(company.company_domain)) continue;
    const emp = parseEmployeeCount(company.employee_count);
    byBucket[employeeBucket(emp)] = (byBucket[employeeBucket(emp)] ?? 0) + 1;
    if (meetsMinEmployees(company, minEmployees)) unseenEligible += 1;
    else unseenSkippedSmall += 1;
  }
  return { unseenEligible, unseenSkippedSmall, byBucket };
}

async function processCompany(
  company: RejectedRow,
  hunterKey: string,
  mvReady: boolean,
): Promise<{ row: HunterResultRow; creditUsed: boolean }> {
  const domain = company.company_domain;
  const base: HunterResultRow = {
    company_name: company.company_name,
    company_domain: domain,
    employee_count: company.employee_count ?? '',
    industry: company.industry ?? '',
    apollo_org_id: company.apollo_org_id ?? '',
    source_lists: company.source_lists ?? '',
    apollo_rejection_reason: company.rejection_reason ?? '',
    person_name: '',
    person_title: '',
    email: '',
    hunter_confidence: '',
    hunter_type: '',
    linkedin: '',
    mv_result: '',
    outcome: '',
    error: '',
  };

  const { emails, error, creditUsed } = await domainSearch(domain, hunterKey);
  if (error) {
    return {
      row: { ...base, outcome: 'error', error },
      creditUsed,
    };
  }

  const best = pickBest(emails);
  if (!best) {
    return {
      row: {
        ...base,
        outcome: emails.length ? 'no_exec_title' : 'no_emails',
      },
      creditUsed,
    };
  }

  const email = (best.value ?? '').trim().toLowerCase();
  const personName = [best.first_name, best.last_name].filter(Boolean).join(' ').trim();
  const row: HunterResultRow = {
    ...base,
    person_name: personName,
    person_title: best.position ?? '',
    email,
    hunter_confidence: best.confidence != null ? String(best.confidence) : '',
    hunter_type: best.type ?? '',
    linkedin: best.linkedin ?? '',
    outcome: email ? 'person_and_email' : 'person_no_email',
  };

  if (email && mvReady) {
    try {
      const mv = await verifyEmailWithMillionVerifier(email);
      row.mv_result = mv.result;
      row.outcome =
        mv.result === 'ok' || mv.result === 'catch_all' ? 'mv_pass' : `mv_${mv.result}`;
    } catch (mvError) {
      row.mv_result = 'error';
      row.outcome = 'mv_error';
      row.error = mvError instanceof Error ? mvError.message : String(mvError);
    }
  }

  return { row, creditUsed };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveCreditCap(args: {
  maxCredits: number | null;
  additionalCredits: number | null;
  creditsUsedBaseline: number;
}): { mode: 'absolute' | 'additional'; cap: number; label: string } {
  if (args.additionalCredits != null) {
    return {
      mode: 'additional',
      cap: args.additionalCredits,
      label: `additional ${args.additionalCredits}`,
    };
  }
  const absolute = args.maxCredits ?? 11_000;
  return {
    mode: 'absolute',
    cap: absolute,
    label: `max ${absolute}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadSelfRecoveryEnv();
  mkdirSync(args.outDir, { recursive: true });

  const pool = buildCompanyPool(args.runDir);
  console.error(`Pool: ${pool.length} unique reject domains (excl. Apollo lead domains)`);
  if (args.minEmployees > 0) {
    console.error(`Filter: employees >= ${args.minEmployees}`);
  }

  let checkpoint = loadCheckpoint(args.outDir);
  if (!checkpoint) {
    checkpoint = {
      version: 1,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      next_index: 0,
      total: pool.length,
      credits_used: 0,
      max_credits: args.maxCredits ?? args.additionalCredits ?? 11_000,
      stop_reason: '',
      stats: emptyStats(),
      results: [],
      seen_domains: [],
      requests: 0,
      wave_credits_used: 0,
    };
    seedFromSample(args.runDir, checkpoint, pool);
    checkpoint.next_index = 0;
    checkpoint.total = pool.length;
    checkpoint.requests = checkpoint.seen_domains.length;
    console.error(
      `Seeded ${checkpoint.seen_domains.length} domains from hunter-sample (not counted against credit budget)`,
    );
  } else {
    checkpoint.total = pool.length;
    if (checkpoint.requests == null) {
      checkpoint.requests = checkpoint.seen_domains.length;
    }
    // Correct legacy overcount (every HTTP 200 counted as a credit).
    if (checkpoint.credits_used > LEGACY_BILLED_CREDITS) {
      const fromResults = billedFromResults(checkpoint.results);
      const corrected = Math.max(LEGACY_BILLED_CREDITS, fromResults);
      if (corrected < checkpoint.credits_used) {
        console.error(
          `Correcting credits_used ${checkpoint.credits_used} → ${corrected} (bill-only; was request overcount)`,
        );
        checkpoint.credits_used = corrected;
      }
    }
    console.error(
      `Resuming; done=${checkpoint.seen_domains.length} credits_used=${checkpoint.credits_used} requests=${checkpoint.requests}`,
    );
  }

  const seen = new Set(checkpoint.seen_domains);
  const eligible = summarizeEligible(pool, seen, args.minEmployees);
  console.error(
    `Unseen eligible (emp>=${args.minEmployees || 0}): ${eligible.unseenEligible}; skipped small: ${eligible.unseenSkippedSmall}`,
  );
  console.error(`Unseen by size: ${JSON.stringify(eligible.byBucket)}`);

  if (args.dryRun) {
    const creditPlan = resolveCreditCap({
      maxCredits: args.maxCredits,
      additionalCredits: args.additionalCredits,
      creditsUsedBaseline: checkpoint.credits_used,
    });
    const summary = {
      dry_run: true,
      status: checkpoint.status,
      pool: pool.length,
      seen: checkpoint.seen_domains.length,
      min_employees: args.minEmployees,
      unseen_eligible: eligible.unseenEligible,
      unseen_skipped_small: eligible.unseenSkippedSmall,
      unseen_by_bucket: eligible.byBucket,
      credits_used: checkpoint.credits_used,
      mv_pass: checkpoint.stats.mv_pass,
      credit_cap: creditPlan,
      api_calls: 0,
    };
    console.log('\n=== Hunter find dry-run ===');
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const creditPlan = resolveCreditCap({
    maxCredits: args.maxCredits,
    additionalCredits: args.additionalCredits,
    creditsUsedBaseline: checkpoint.credits_used,
  });

  if (checkpoint.status === 'credit_limit' && args.additionalCredits != null) {
    console.error(
      `Resuming past credit_limit with --additional-credits ${args.additionalCredits} (wave billed cap)`,
    );
    checkpoint.status = 'in_progress';
    checkpoint.stop_reason = '';
    checkpoint.wave_credits_used = 0;
    checkpoint.max_credits = checkpoint.credits_used + args.additionalCredits;
  } else if (
    checkpoint.status === 'credit_limit' &&
    args.maxCredits != null &&
    args.maxCredits > checkpoint.credits_used
  ) {
    console.error(
      `Resuming past credit_limit with --max-credits ${args.maxCredits} (> credits_used ${checkpoint.credits_used})`,
    );
    checkpoint.status = 'in_progress';
    checkpoint.stop_reason = '';
    checkpoint.max_credits = args.maxCredits;
  } else if (
    checkpoint.status === 'completed' ||
    checkpoint.status === 'early_stop' ||
    checkpoint.status === 'credit_limit'
  ) {
    console.error(`Already finished with status=${checkpoint.status}: ${checkpoint.stop_reason}`);
    console.log(
      JSON.stringify(
        {
          status: checkpoint.status,
          credits_used: checkpoint.credits_used,
          mv_pass: checkpoint.stats.mv_pass,
          leads: checkpoint.results.filter((r) => r.outcome === 'mv_pass').length,
          unseen_eligible: eligible.unseenEligible,
        },
        null,
        2,
      ),
    );
    return;
  } else if (args.maxCredits != null) {
    checkpoint.max_credits = args.maxCredits;
  } else if (args.additionalCredits != null) {
    checkpoint.wave_credits_used = checkpoint.wave_credits_used ?? 0;
    checkpoint.max_credits = checkpoint.credits_used + args.additionalCredits;
  }

  const { apiKey: hunterKey, source: hunterSource } = await resolveHunterKey();
  console.error(`Hunter key from ${hunterSource}`);
  console.error(`Credit cap: ${creditPlan.label}`);

  const mvReady = args.skipMv ? false : await ensureMvKey();
  if (!args.skipMv && !mvReady) {
    console.error('Million Verifier key not found; continuing without MV');
  } else if (mvReady) {
    console.error('Million Verifier enabled');
  }

  let processedThisRun = 0;
  let billedThisRun = 0;
  let mergesSinceSave = 0;
  let waveCredits = checkpoint.wave_credits_used ?? 0;

  const waveExhausted = (): boolean => {
    if (creditPlan.mode === 'additional') return waveCredits >= creditPlan.cap;
    return checkpoint!.credits_used >= creditPlan.cap;
  };

  for (let i = 0; i < pool.length; i++) {
    const company = pool[i]!;
    const domain = company.company_domain;
    if (seen.has(domain)) continue;
    if (!meetsMinEmployees(company, args.minEmployees)) continue;

    if (waveExhausted()) {
      checkpoint.status = 'credit_limit';
      checkpoint.stop_reason =
        creditPlan.mode === 'additional'
          ? `Hit additional credits (${creditPlan.cap}) this wave`
          : `Hit max credits (${creditPlan.cap})`;
      break;
    }

    const doneCount = checkpoint.seen_domains.length;
    if (mvReady && doneCount >= args.minDomainsBeforeStop && doneCount % 100 === 0) {
      const rate = checkpoint.stats.mv_pass / doneCount;
      if (rate < args.minMvPassRate) {
        checkpoint.status = 'early_stop';
        checkpoint.stop_reason = `MV-pass rate ${(rate * 100).toFixed(1)}% < ${(args.minMvPassRate * 100).toFixed(0)}% after ${doneCount} domains`;
        break;
      }
    }

    const creditDisplay =
      creditPlan.mode === 'additional'
        ? `wave ${waveCredits}/${creditPlan.cap}`
        : `${checkpoint.credits_used}/${creditPlan.cap}`;
    process.stdout.write(
      `[${doneCount + 1}/${pool.length}] credits ${creditDisplay} | ${domain}... `,
    );

    const { row, creditUsed } = await processCompany(company, hunterKey, mvReady);

    // Stop cleanly if Hunter is out of credits — do not mark domain done.
    const errLower = (row.error || '').toLowerCase();
    if (
      row.outcome === 'error' &&
      (errLower.includes('credit') ||
        errLower.includes('payment') ||
        errLower.includes('quota') ||
        errLower.includes('upgrade') ||
        errLower.includes('http 402') ||
        errLower.includes('http 403'))
    ) {
      console.log(`credit_exhausted: ${row.error}`);
      checkpoint.status = 'credit_limit';
      checkpoint.stop_reason = `Hunter API: ${row.error}`;
      break;
    }

    checkpoint.requests = (checkpoint.requests ?? checkpoint.seen_domains.length) + 1;
    if (creditUsed) {
      checkpoint.credits_used += 1;
      waveCredits += 1;
      billedThisRun += 1;
      checkpoint.wave_credits_used = waveCredits;
    }

    checkpoint.results.push(row);
    checkpoint.seen_domains.push(domain);
    seen.add(domain);
    checkpoint.next_index = seen.size;
    applyResultStats(checkpoint.stats, row);
    appendLog(args.outDir, {
      at: new Date().toISOString(),
      domain,
      outcome: row.outcome,
      email: row.email,
      credits_used: checkpoint.credits_used,
      wave_credits_used: waveCredits,
      billed: creditUsed,
    });

    console.log(
      row.outcome === 'mv_pass'
        ? `mv_pass | ${row.person_name} <${row.email}> ${row.person_title}`
        : row.email
          ? `${row.outcome} | ${row.person_name} <${row.email}>`
          : row.error
            ? `error: ${row.error}`
            : row.outcome,
    );

    processedThisRun += 1;
    mergesSinceSave += 1;
    if (mergesSinceSave >= 10) {
      mergesSinceSave = 0;
      saveCheckpoint(args.outDir, checkpoint);
    }

    await sleep(REQUEST_GAP_MS);
  }

  if (checkpoint.status === 'in_progress') {
    const remainingEligible = summarizeEligible(pool, seen, args.minEmployees).unseenEligible;
    if (remainingEligible === 0) {
      checkpoint.status = 'completed';
      checkpoint.stop_reason =
        args.minEmployees > 0
          ? `No remaining domains with employees >= ${args.minEmployees}`
          : 'Processed all reject domains';
    } else if (waveExhausted()) {
      checkpoint.status = 'credit_limit';
      checkpoint.stop_reason =
        creditPlan.mode === 'additional'
          ? `Hit additional credits (${creditPlan.cap}) this wave`
          : `Hit max credits (${creditPlan.cap})`;
    }
  }

  checkpoint.wave_credits_used = waveCredits;
  saveCheckpoint(args.outDir, checkpoint);

  const leads = checkpoint.results.filter((r) => r.outcome === 'mv_pass').length;
  const remaining = summarizeEligible(pool, seen, args.minEmployees);
  const summary = {
    status: checkpoint.status,
    stop_reason: checkpoint.stop_reason,
    processed: checkpoint.seen_domains.length,
    total: pool.length,
    credits_used: checkpoint.credits_used,
    wave_credits_used: waveCredits,
    processed_this_run: processedThisRun,
    billed_this_run: billedThisRun,
    remaining_eligible: remaining.unseenEligible,
    stats: checkpoint.stats,
    mv_pass_rate: checkpoint.seen_domains.length
      ? checkpoint.stats.mv_pass / checkpoint.seen_domains.length
      : 0,
    leads,
    out_dir: args.outDir,
  };
  console.log('\n=== Hunter find summary ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
