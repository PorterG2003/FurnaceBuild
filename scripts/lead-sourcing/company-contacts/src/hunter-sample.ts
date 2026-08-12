/**
 * Hunter.io domain-search sample on Apollo rejects.
 *
 * Usage (from scripts/lead-sourcing/company-contacts):
 *   npx tsx src/hunter-sample.ts \
 *     --run-dir output/runs/2026-07-21-no-contact-found \
 *     --limit 50
 *
 * Requires HUNTER_API_KEY (env or Amplify SSM via DEV_SECRET_SSM_PREFIX).
 * Optional: MILLION_VERIFIER_API_KEY to score emails (ok/catch_all).
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
  rejection_reason?: string;
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

const EXEC_TITLE_RE =
  /\b(ceo|chief executive|founder|co-?founder|owner|president|managing partner|managing director)\b/i;

function parseArgs(argv: string[]): {
  runDir: string;
  limit: number;
  outDir: string;
  skipMv: boolean;
} {
  let runDir = 'output/runs/2026-07-21-no-contact-found';
  let limit = 50;
  let outDir = '';
  let skipMv = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--run-dir' && argv[i + 1]) runDir = argv[++i]!;
    else if (arg === '--limit' && argv[i + 1]) limit = Number(argv[++i]) || 50;
    else if (arg === '--out-dir' && argv[i + 1]) outDir = argv[++i]!;
    else if (arg === '--skip-mv') skipMv = true;
  }
  const resolvedRun = resolve(runDir);
  return {
    runDir: resolvedRun,
    limit: Math.min(Math.max(limit, 1), 50),
    outDir: outDir ? resolve(outDir) : join(resolvedRun, 'hunter-sample'),
    skipMv,
  };
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

function titleTier(position: string | undefined): number {
  const p = (position ?? '').toLowerCase();
  if (!p) return 0;
  if (/\b(ceo|chief executive)\b/.test(p) || /\b(co-?founder|founder)\b/.test(p)) return 100;
  if (/\bowner\b/.test(p)) return 90;
  if (/\bpresident\b/.test(p) && !/\bvice president\b/.test(p)) return 80;
  if (/\bmanaging (partner|director)\b/.test(p)) return 70;
  if (EXEC_TITLE_RE.test(p)) return 60;
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
): Promise<{ emails: HunterEmail[]; error?: string }> {
  const url = new URL('https://api.hunter.io/v2/domain-search');
  url.searchParams.set('domain', domain);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('limit', '10');

  const response = await fetch(url);
  const body = (await response.json()) as {
    data?: { emails?: HunterEmail[] };
    errors?: Array<{ details?: string; id?: string }>;
  };
  if (!response.ok) {
    const detail = body.errors?.[0]?.details ?? `HTTP ${response.status}`;
    return { emails: [], error: detail };
  }
  return { emails: body.data?.emails ?? [] };
}

async function ensureMvKey(): Promise<boolean> {
  if (process.env.MILLION_VERIFIER_API_KEY?.trim()) return true;
  loadSelfRecoveryEnv();
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

async function main(): Promise<void> {
  const { runDir, limit, outDir, skipMv } = parseArgs(process.argv.slice(2));
  loadSelfRecoveryEnv();

  const rejectsPath = join(runDir, 'rejected_companies.csv');
  const rejects = readCsv(rejectsPath) as RejectedRow[];
  const byDomain = new Map<string, RejectedRow>();
  for (const row of rejects) {
    const domain = (row.company_domain ?? '').trim().toLowerCase();
    if (!domain || byDomain.has(domain)) continue;
    byDomain.set(domain, row);
  }
  const pool = [...byDomain.values()];
  const seed = createHash('sha256').update('hunter-sample-v1').digest().readUInt32BE(0);
  const rand = mulberry32(seed);
  shuffleInPlace(pool, rand);
  const sample = pool.slice(0, limit);

  const hunterTargets: Array<'prod' | 'dev'> = ['dev', resolveSelfRecoveryTargetEnv()];
  let hunterKey = process.env.HUNTER_API_KEY?.trim() ?? '';
  let hunterSource = 'HUNTER_API_KEY environment variable';
  if (!hunterKey) {
    for (const targetEnv of [...new Set(hunterTargets)]) {
      try {
        const resolved = await resolveHunterApiKey({ targetEnv });
        hunterKey = resolved.apiKey;
        hunterSource = resolved.source;
        break;
      } catch {
        // try next
      }
    }
  }
  if (!hunterKey) {
    throw new Error(
      'Missing HUNTER_API_KEY. Run: npx ampx sandbox secret set HUNTER_API_KEY',
    );
  }
  console.error(`Hunter key from ${hunterSource}`);
  console.error(`Sampling ${sample.length} rejected domains (limit=${limit})`);

  const mvReady = skipMv ? false : await ensureMvKey();
  if (!skipMv && !mvReady) {
    console.error('Million Verifier key not found; continuing without MV');
  }

  await mkdir(outDir, { recursive: true });

  const rows: Array<Record<string, string>> = [];
  let withPerson = 0;
  let withEmail = 0;
  let mvOk = 0;
  let errors = 0;

  for (let i = 0; i < sample.length; i++) {
    const company = sample[i]!;
    const domain = company.company_domain.trim().toLowerCase();
    process.stdout.write(`[${i + 1}/${sample.length}] ${domain}... `);
    const { emails, error } = await domainSearch(domain, hunterKey);
    if (error) {
      errors += 1;
      console.log(`error: ${error}`);
      rows.push({
        company_name: company.company_name,
        company_domain: domain,
        employee_count: company.employee_count ?? '',
        person_name: '',
        person_title: '',
        email: '',
        hunter_confidence: '',
        hunter_type: '',
        linkedin: '',
        mv_result: '',
        outcome: 'error',
        error,
      });
      continue;
    }

    const best = pickBest(emails);
    if (!best) {
      console.log(emails.length ? 'no_exec_title' : 'no_emails');
      rows.push({
        company_name: company.company_name,
        company_domain: domain,
        employee_count: company.employee_count ?? '',
        person_name: '',
        person_title: '',
        email: '',
        hunter_confidence: '',
        hunter_type: '',
        linkedin: '',
        mv_result: '',
        outcome: emails.length ? 'no_exec_title' : 'no_emails',
        error: '',
      });
      continue;
    }

    withPerson += 1;
    const email = (best.value ?? '').trim().toLowerCase();
    const personName = [best.first_name, best.last_name].filter(Boolean).join(' ').trim();
    let mvResult = '';
    let outcome = 'person_and_email';
    if (email) {
      withEmail += 1;
      if (mvReady) {
        const mv = await verifyEmailWithMillionVerifier(email);
        mvResult = mv.result;
        if (mvResult === 'ok' || mvResult === 'catch_all') mvOk += 1;
        outcome = mvResult === 'ok' || mvResult === 'catch_all' ? 'mv_pass' : `mv_${mvResult}`;
      }
    } else {
      outcome = 'person_no_email';
    }

    console.log(`${outcome} | ${personName} <${email}> ${best.position ?? ''}`);
    rows.push({
      company_name: company.company_name,
      company_domain: domain,
      employee_count: company.employee_count ?? '',
      person_name: personName,
      person_title: best.position ?? '',
      email,
      hunter_confidence: best.confidence != null ? String(best.confidence) : '',
      hunter_type: best.type ?? '',
      linkedin: best.linkedin ?? '',
      mv_result: mvResult,
      outcome,
      error: '',
    });

    await new Promise((r) => setTimeout(r, 200));
  }

  writeCsv(join(outDir, 'hunter_contacts.csv'), rows, [
    'company_name',
    'company_domain',
    'employee_count',
    'person_name',
    'person_title',
    'email',
    'hunter_confidence',
    'hunter_type',
    'linkedin',
    'mv_result',
    'outcome',
    'error',
  ]);

  const summary = {
    sample_size: sample.length,
    with_exec_person: withPerson,
    with_email: withEmail,
    mv_pass: mvOk,
    errors,
    person_rate: sample.length ? withPerson / sample.length : 0,
    email_rate: sample.length ? withEmail / sample.length : 0,
    mv_pass_rate: sample.length ? mvOk / sample.length : 0,
    recommendation:
      (mvReady ? mvOk / sample.length : withEmail / sample.length) >= 0.1
        ? 'go: >=10% usable — worth buying more Hunter credits'
        : 'stop: <10% usable — try website/pattern or another provider',
  };
  await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log('\n=== Hunter sample summary ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${join(outDir, 'hunter_contacts.csv')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
