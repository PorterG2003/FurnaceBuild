/**
 * Bulk-verify emails in a CSV via Million Verifier.
 *
 * Usage:
 *   npm run verify -- --input path/to/leads.csv --email-column Email
 *   npm run verify -- --input path/to/leads.csv --email-column email --resume output/runs/.../mv_checkpoint.json
 *
 * Keeps rows where mv_result is ok or catch_all. Writes rejected rows separately.
 */

import { basename, dirname, extname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureEnv, millionVerifierApiKey, packageRoot } from './lib/env.js';
import { parseCliArgs, truncateRows } from './lib/cli.js';
import { readCsv, writeCsv } from './lib/csv.js';
import { MillionVerifier, type MvResult } from './lib/millionVerifier.js';

const KEEP_RESULTS = new Set<MvResult>(['ok', 'catch_all']);
const PROGRESS_EVERY = 25;
const CHECKPOINT_EVERY = 50;

type VerifyCliOptions = {
  input?: string;
  output?: string;
  emailColumn: string;
  dryRun: boolean;
  maxRows: number | null;
  fixtures: boolean;
  resume?: string;
  keepUnknown: boolean;
};

function parseVerifyCliArgs(argv: string[] = process.argv.slice(2)): VerifyCliOptions {
  const base = parseCliArgs(argv);
  let emailColumn = 'Email';
  let resume: string | undefined;
  let keepUnknown = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email-column' && argv[i + 1]) {
      emailColumn = argv[++i]!;
    } else if (arg === '--resume' && argv[i + 1]) {
      resume = argv[++i];
    } else if (arg === '--keep-unknown') {
      keepUnknown = true;
    }
  }

  return {
    input: base.input,
    output: base.output,
    emailColumn,
    dryRun: base.dryRun,
    maxRows: base.maxRows,
    fixtures: base.fixtures,
    resume,
    keepUnknown,
  };
}

function defaultOutputPaths(inputPath: string, runDir: string) {
  const base = basename(inputPath, extname(inputPath));
  const dir = join(packageRoot, runDir);
  return {
    verified: join(dir, `${base}_verified.csv`),
    rejected: join(dir, `${base}_rejected.csv`),
    audit: join(dir, `${base}_mv_audit.csv`),
    checkpoint: join(dir, 'mv_checkpoint.json'),
  };
}

function shouldKeep(result: MvResult, keepUnknown: boolean): boolean {
  if (KEEP_RESULTS.has(result)) return true;
  if (keepUnknown && result === 'unknown') return true;
  return false;
}

function loadCheckpoint(path: string): Record<string, MvResult> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, MvResult>;
}

function saveCheckpoint(path: string, cache: Record<string, MvResult>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

export async function runVerifyEmails(options: Partial<VerifyCliOptions> = {}): Promise<void> {
  const cli = parseVerifyCliArgs();
  const inputPath = resolve(options.input ?? cli.input ?? '');
  if (!inputPath) {
    throw new Error('Missing --input path');
  }

  const emailColumn = options.emailColumn ?? cli.emailColumn;
  const dryRun = options.dryRun ?? cli.dryRun;
  const maxRows = options.maxRows ?? cli.maxRows;
  const fixtureMode = options.fixtures ?? cli.fixtures;
  const keepUnknown = options.keepUnknown ?? cli.keepUnknown;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const runDir = `output/runs/${stamp}`;
  const paths = defaultOutputPaths(inputPath, runDir);
  const checkpointPath = resolve(options.resume ?? cli.resume ?? paths.checkpoint);

  const rows = truncateRows(readCsv(inputPath), maxRows);
  if (rows.length === 0) {
    throw new Error(`No rows in ${inputPath}`);
  }

  const uniqueEmails = [...new Set(
    rows
      .map((row) => row[emailColumn]?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email && email.includes('@'))),
  )];

  if (dryRun) {
    console.log(
      JSON.stringify({
        dry_run: true,
        input_path: inputPath,
        email_column: emailColumn,
        row_count: rows.length,
        unique_emails: uniqueEmails.length,
        estimated_minutes: Math.ceil((uniqueEmails.length * 0.2) / 60),
        use_fixtures: fixtureMode,
        keep_unknown: keepUnknown,
      }),
    );
    return;
  }

  if (!fixtureMode) {
    await ensureEnv();
  }

  const verifier = new MillionVerifier({
    apiKey: fixtureMode ? 'fixture' : millionVerifierApiKey(),
    mock: fixtureMode,
  });

  if (existsSync(checkpointPath)) {
    verifier.loadCache(loadCheckpoint(checkpointPath));
    console.log(`Resumed checkpoint with ${verifier.cacheSize} cached results`);
  }

  const pending = uniqueEmails.filter((email) => !verifier.exportCache()[email]);
  console.log(`Verifying ${pending.length} emails (${verifier.cacheSize} already cached)`);

  for (let i = 0; i < pending.length; i++) {
    const email = pending[i]!;
    const result = await verifier.getResult(email);
    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === pending.length) {
      console.log(`Verified ${i + 1}/${pending.length} (${result}: ${email})`);
    }
    if ((i + 1) % CHECKPOINT_EVERY === 0 || i + 1 === pending.length) {
      saveCheckpoint(checkpointPath, verifier.exportCache());
    }
  }

  const resultByEmail = verifier.exportCache();
  const verifiedRows: Record<string, string>[] = [];
  const rejectedRows: Record<string, string>[] = [];
  const auditRows: Array<{ email: string; mv_result: string; kept: string }> = [];

  for (const row of rows) {
    const email = row[emailColumn]?.trim().toLowerCase() ?? '';
    const mvResult = resultByEmail[email] ?? 'missing';
    const kept = shouldKeep(mvResult, keepUnknown);
    const outRow = { ...row, mv_result: mvResult };
    if (kept) {
      verifiedRows.push(outRow);
    } else {
      rejectedRows.push(outRow);
    }
    auditRows.push({ email, mv_result: mvResult, kept: kept ? 'yes' : 'no' });
  }

  const columns = [...Object.keys(rows[0]!), 'mv_result'];
  mkdirSync(dirname(paths.verified), { recursive: true });
  writeCsv(paths.verified, verifiedRows, columns);
  writeCsv(paths.rejected, rejectedRows, columns);
  writeCsv(paths.audit, auditRows as unknown as Record<string, string>[], ['email', 'mv_result', 'kept']);

  const counts = auditRows.reduce(
    (acc, row) => {
      acc[row.mv_result] = (acc[row.mv_result] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log(
    JSON.stringify({
      input_path: inputPath,
      verified_path: paths.verified,
      rejected_path: paths.rejected,
      audit_path: paths.audit,
      checkpoint_path: checkpointPath,
      rows_in: rows.length,
      rows_kept: verifiedRows.length,
      rows_rejected: rejectedRows.length,
      mv_unique_calls: verifier.cacheSize,
      mv_result_counts: counts,
    }),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runVerifyEmails().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
