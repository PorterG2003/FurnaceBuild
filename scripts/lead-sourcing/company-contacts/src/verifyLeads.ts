import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  loadSelfRecoveryEnv,
  resolveMillionVerifierApiKey,
  resolveSelfRecoveryTargetEnv,
} from '../../../self-recovery-env.js';
import { parseCliArgs, truncateRows } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { ensureEnv, useFixtures } from '../../webinar-hosts/src/lib/env.js';
import { matchPersonByLinkedIn } from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { verifyEmailWithMillionVerifier } from '../../email-from-linkedin/src/millionVerifier.js';
import {
  HttpStatusError,
  Mutex,
  RequestGate,
  parseRetryAfterMs,
  resolveConcurrency,
} from './apolloGate.js';
import { loadIcpConfig } from './config.js';
import { passesTitleAccuracy } from './contactTier.js';
import { LEAD_COLUMNS, type LeadRow } from './types.js';

const KEEP_MV = new Set(['ok', 'catch_all']);

export type VerifiedLeadRow = LeadRow & {
  mv_result: string;
  mv_quality: string;
  title_ok: string;
  linkedin_title: string;
  linkedin_title_match: string;
  review_reason: string;
};

export const VERIFIED_LEAD_COLUMNS = [
  ...LEAD_COLUMNS,
  'mv_result',
  'mv_quality',
  'title_ok',
  'linkedin_title',
  'linkedin_title_match',
  'review_reason',
] as const;

const MV_CHECKPOINT = 'mv_checkpoint.json';

async function ensureMillionVerifierKey(): Promise<void> {
  if (process.env.MILLION_VERIFIER_API_KEY?.trim()) return;
  loadSelfRecoveryEnv();
  const explicitTarget = process.env.APOLLO_SECRET_TARGET_ENV?.trim().toLowerCase();
  const targets: Array<'prod' | 'dev'> =
    explicitTarget === 'prod' || explicitTarget === 'dev'
      ? [explicitTarget]
      : ['dev', resolveSelfRecoveryTargetEnv()];

  for (const targetEnv of [...new Set(targets)]) {
    try {
      const { apiKey } = await resolveMillionVerifierApiKey({ targetEnv });
      process.env.MILLION_VERIFIER_API_KEY = apiKey;
      return;
    } catch {
      // try next
    }
  }
}

function loadMvCache(runDir: string): Record<string, { result: string; quality: string }> {
  const path = join(runDir, MV_CHECKPOINT);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<
    string,
    { result: string; quality: string }
  >;
}

function saveMvCache(
  runDir: string,
  cache: Record<string, { result: string; quality: string }>,
): void {
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, MV_CHECKPOINT), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function titlesRoughlyMatch(apolloTitle: string, linkedinTitle: string): boolean {
  const a = apolloTitle.toLowerCase();
  const b = linkedinTitle.toLowerCase();
  if (!b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !['and', 'the', 'of'].includes(t)),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return overlap >= 1 && (overlap / Math.max(ta.size, 1) >= 0.4 || overlap >= 2);
}

export type VerifyLeadsOptions = {
  runDir: string;
  inputPath?: string;
  dryRun?: boolean;
  maxRows?: number | null;
  useFixtures?: boolean;
  /** Re-fetch title via Apollo people/match on LinkedIn URL */
  refreshLinkedInTitles?: boolean;
  keepUnknownMv?: boolean;
  concurrency?: number;
};

async function verifyOneLead(
  row: LeadRow,
  options: {
    fixtures: boolean;
    refreshLinkedInTitles: boolean;
    keepUnknownMv?: boolean;
    icp: ReturnType<typeof loadIcpConfig>;
    mvCache: Record<string, { result: string; quality: string }>;
    cacheMutex: Mutex;
    runDir: string;
    mvGate: RequestGate;
    apolloGate: RequestGate;
  },
): Promise<VerifiedLeadRow> {
  const titleOk = passesTitleAccuracy(
    row.contact_title,
    row.contact_tier,
    options.icp.contact_search.contact_tiers,
  );

  let linkedinTitle = '';
  let linkedinMatch = '';
  if (options.refreshLinkedInTitles && row.linkedin_url?.includes('linkedin.com')) {
    try {
      const person = await options.apolloGate.schedule(() =>
        matchPersonByLinkedIn(row.linkedin_url, { useFixtures: options.fixtures }),
      );
      linkedinTitle = person?.title?.trim() ?? '';
      linkedinMatch = linkedinTitle
        ? titlesRoughlyMatch(row.contact_title, linkedinTitle)
          ? 'match'
          : 'mismatch'
        : 'no_title';
    } catch (error) {
      linkedinMatch = `error:${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const email = row.email.trim().toLowerCase();
  let mvResult = '';
  let mvQuality = '';
  if (!email.includes('@')) {
    mvResult = 'missing';
  } else {
    const cached = await options.cacheMutex.runExclusive(() => options.mvCache[email]);
    if (cached) {
      mvResult = cached.result;
      mvQuality = cached.quality;
    } else {
      const mv = await options.mvGate.schedule(async () => {
        try {
          return await verifyEmailWithMillionVerifier(email, {
            useFixtures: options.fixtures,
            fixtureResults: options.fixtures
              ? { [email]: { email, result: 'ok', quality: 'good' } }
              : undefined,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const statusMatch = message.match(/\b([45]\d{2})\b/);
          const status = statusMatch ? Number(statusMatch[1]) : 0;
          if (status === 429 || status >= 500) {
            throw new HttpStatusError(message, status, parseRetryAfterMs(null));
          }
          throw error;
        }
      });
      mvResult = mv.result;
      mvQuality = mv.quality ?? '';
      await options.cacheMutex.runExclusive(() => {
        options.mvCache[email] = { result: mvResult, quality: mvQuality };
        saveMvCache(options.runDir, options.mvCache);
      });
    }
  }

  const mvKeep = KEEP_MV.has(mvResult) || (options.keepUnknownMv && mvResult === 'unknown');

  const out: VerifiedLeadRow = {
    ...row,
    mv_result: mvResult,
    mv_quality: mvQuality,
    title_ok: titleOk ? 'yes' : 'no',
    linkedin_title: linkedinTitle,
    linkedin_title_match: linkedinMatch,
    review_reason: '',
  };

  const reasons: string[] = [];
  if (!titleOk) reasons.push('title_inaccurate');
  if (!mvKeep) reasons.push(`mv_${mvResult || 'fail'}`);
  if (linkedinMatch === 'mismatch') reasons.push('linkedin_title_mismatch');
  if (reasons.length > 0) out.review_reason = reasons.join('|');

  return out;
}

export async function verifyLeads(options: VerifyLeadsOptions): Promise<{
  verified: VerifiedLeadRow[];
  rejected: VerifiedLeadRow[];
  review: VerifiedLeadRow[];
}> {
  const runDir = resolve(options.runDir);
  const inputPath = resolve(options.inputPath ?? join(runDir, 'leads.csv'));
  if (!existsSync(inputPath)) {
    throw new Error(`leads.csv not found at ${inputPath}`);
  }

  const icp = loadIcpConfig();
  let rows = truncateRows(readCsv(inputPath) as LeadRow[], options.maxRows ?? null);
  const fixtures = options.useFixtures ?? useFixtures();
  const concurrency = resolveConcurrency(options.concurrency, 8);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          leads: rows.length,
          refresh_linkedin_titles: Boolean(options.refreshLinkedInTitles),
          million_verifier: !fixtures,
          concurrency,
        },
        null,
        2,
      ),
    );
    return { verified: [], rejected: [], review: [] };
  }

  const mvCache = loadMvCache(runDir);
  const cacheMutex = new Mutex();
  const mvGate = new RequestGate({ minSpacingMs: 100, maxAttempts: 8, label: 'mv' });
  const apolloGate = new RequestGate({ minSpacingMs: 90, maxAttempts: 8, label: 'apollo' });

  const verified: VerifiedLeadRow[] = [];
  const rejected: VerifiedLeadRow[] = [];
  const results: VerifiedLeadRow[] = new Array(rows.length);
  let claimIndex = 0;
  const claimMutex = new Mutex();
  let doneCount = 0;

  const claimNext = async (): Promise<number | null> =>
    claimMutex.runExclusive(() => {
      if (claimIndex >= rows.length) return null;
      const index = claimIndex;
      claimIndex += 1;
      return index;
    });

  console.error(`[verify-leads] ${rows.length} leads, concurrency=${concurrency}`);

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = await claimNext();
      if (index == null) return;
      const row = rows[index]!;
      const out = await verifyOneLead(row, {
        fixtures,
        refreshLinkedInTitles: Boolean(options.refreshLinkedInTitles),
        keepUnknownMv: options.keepUnknownMv,
        icp,
        mvCache,
        cacheMutex,
        runDir,
        mvGate,
        apolloGate,
      });
      results[index] = out;
      doneCount += 1;
      if (doneCount % 10 === 0 || doneCount === rows.length) {
        const keep = results.filter((r) => r && !r.review_reason).length;
        const drop = results.filter((r) => r && r.review_reason).length;
        console.error(`[verify-leads] ${doneCount}/${rows.length} | keep ${keep} | drop ${drop}`);
      }
    }
  };

  const workerCount = Math.min(concurrency, Math.max(1, rows.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const out of results) {
    if (!out) continue;
    if (out.review_reason) rejected.push(out);
    else verified.push(out);
  }

  // Dual-executive companies: keep leads but flag for LinkedIn review
  const byCompany = new Map<string, VerifiedLeadRow[]>();
  for (const lead of verified) {
    const list = byCompany.get(lead.website) ?? [];
    list.push(lead);
    byCompany.set(lead.website, list);
  }
  const review: VerifiedLeadRow[] = [];
  for (const [, leads] of byCompany) {
    const executives = leads.filter((l) => l.contact_tier === 'executive');
    if (executives.length >= 2) {
      for (const lead of executives) {
        const flagged = {
          ...lead,
          review_reason: lead.review_reason
            ? `${lead.review_reason}|dual_executive`
            : 'dual_executive',
        };
        review.push(flagged);
      }
    }
  }

  writeCsv(
    join(runDir, 'leads_verified.csv'),
    verified.map((r) => ({ ...r })),
    [...VERIFIED_LEAD_COLUMNS],
  );
  writeCsv(
    join(runDir, 'leads_rejected.csv'),
    rejected.map((r) => ({ ...r })),
    [...VERIFIED_LEAD_COLUMNS],
  );
  writeCsv(
    join(runDir, 'leads_linkedin_review.csv'),
    review.map((r) => ({ ...r })),
    [...VERIFIED_LEAD_COLUMNS],
  );

  return { verified, rejected, review };
}

function wantsRefresh(argv: string[]): boolean {
  return argv.includes('--refresh-linkedin-titles');
}

export async function runVerifyLeadsCli(): Promise<void> {
  const argv = process.argv.slice(2);
  const cli = parseCliArgs(argv);
  if (cli.fixtures) process.env.USE_FIXTURES = '1';

  await ensureEnv();
  await ensureMillionVerifierKey();

  const fixtures = cli.fixtures || useFixtures();
  const refreshLinkedInTitles = wantsRefresh(argv);

  if (!fixtures && !process.env.MILLION_VERIFIER_API_KEY?.trim()) {
    throw new Error(
      'MILLION_VERIFIER_API_KEY could not be resolved from env or SSM. Set the key or ensure DEV_SECRET_SSM_PREFIX is available.',
    );
  }

  if (refreshLinkedInTitles && !fixtures && !process.env.APOLLO_API_KEY?.trim()) {
    throw new Error('APOLLO_API_KEY required for --refresh-linkedin-titles');
  }

  const runDir = cli.runDir ?? cli.resume;
  if (!runDir) {
    console.error(
      'Usage: npm run verify-leads -- --run-dir output/runs/... [--concurrency 8] [--refresh-linkedin-titles] [--fixtures]',
    );
    process.exit(1);
  }

  const result = await verifyLeads({
    runDir,
    inputPath: cli.input,
    dryRun: cli.dryRun,
    maxRows: cli.maxRows,
    useFixtures: fixtures,
    refreshLinkedInTitles,
    concurrency: resolveConcurrency(cli.concurrency, 8),
  });

  console.log(
    JSON.stringify(
      {
        run_dir: resolve(runDir),
        verified: result.verified.length,
        rejected: result.rejected.length,
        linkedin_review_dual_exec: result.review.length,
        outputs: {
          leads_verified: 'leads_verified.csv',
          leads_rejected: 'leads_rejected.csv',
          leads_linkedin_review: 'leads_linkedin_review.csv',
        },
      },
      null,
      2,
    ),
  );
}
