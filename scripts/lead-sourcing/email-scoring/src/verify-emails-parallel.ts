/**
 * Parallel Million Verifier for large CSVs. Resumes mv_checkpoint.json.
 *
 * Usage:
 *   npx tsx src/verify-emails-parallel.ts \
 *     --input /path/to.csv --email-column email \
 *     --resume output/runs/2026-07-22-19-16/mv_checkpoint.json \
 *     --run-dir output/runs/2026-07-22-19-16 \
 *     --concurrency 20
 */
import { basename, dirname, extname, join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureEnv, millionVerifierApiKey, packageRoot } from './lib/env.js';
import { parseCliArgs, truncateRows } from './lib/cli.js';
import { readCsv, writeCsv } from './lib/csv.js';
import type { MvResult } from './lib/millionVerifier.js';

const KEEP_RESULTS = new Set<MvResult>(['ok', 'catch_all']);
const PROGRESS_EVERY = 50;
const CHECKPOINT_EVERY = 100;
const MV_ENDPOINT = 'https://api.millionverifier.com/api/v3/';

type Options = {
  input: string;
  emailColumn: string;
  runDir: string;
  resume: string;
  concurrency: number;
  keepUnknown: boolean;
  maxRows: number | null;
};

function parseArgs(argv: string[]): Options {
  const base = parseCliArgs(argv);
  let emailColumn = 'email';
  let resume = '';
  let runDir = '';
  let concurrency = 20;
  let keepUnknown = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--email-column' && argv[i + 1]) emailColumn = argv[++i]!;
    else if (arg === '--resume' && argv[i + 1]) resume = resolve(argv[++i]!);
    else if (arg === '--run-dir' && argv[i + 1]) runDir = resolve(argv[++i]!);
    else if (arg === '--concurrency' && argv[i + 1]) concurrency = Number.parseInt(argv[++i]!, 10);
    else if (arg === '--keep-unknown') keepUnknown = true;
  }

  const input = resolve(base.input ?? '');
  if (!input) throw new Error('Missing --input');
  if (!runDir) {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    runDir = join(packageRoot, `output/runs/${stamp}`);
  }
  if (!resume) resume = join(runDir, 'mv_checkpoint.json');

  return {
    input,
    emailColumn,
    runDir,
    resume,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 20,
    keepUnknown,
    maxRows: base.maxRows,
  };
}

function loadCheckpoint(path: string): Record<string, MvResult> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, MvResult>;
}

function saveCheckpoint(path: string, cache: Record<string, MvResult>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

async function verifyOne(apiKey: string, email: string): Promise<MvResult> {
  const url = new URL(MV_ENDPOINT);
  url.searchParams.set('api', apiKey);
  url.searchParams.set('email', email);
  url.searchParams.set('timeout', '10');

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url);
    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Million Verifier HTTP ${response.status} for ${email}`);
    }
    const body = (await response.json()) as { result?: MvResult };
    return body.result ?? 'unknown';
  }
  return 'unknown';
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

function shouldKeep(result: MvResult, keepUnknown: boolean): boolean {
  if (KEEP_RESULTS.has(result)) return true;
  if (keepUnknown && result === 'unknown') return true;
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = truncateRows(readCsv(options.input), options.maxRows);
  const uniqueEmails = [
    ...new Set(
      rows
        .map((row) => row[options.emailColumn]?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email && email.includes('@'))),
    ),
  ];

  await ensureEnv();
  const apiKey = millionVerifierApiKey();
  const cache = loadCheckpoint(options.resume);
  const pending = uniqueEmails.filter((email) => cache[email] == null);

  console.log(
    JSON.stringify({
      input: options.input,
      runDir: options.runDir,
      resume: options.resume,
      uniqueEmails: uniqueEmails.length,
      cached: Object.keys(cache).length,
      pending: pending.length,
      concurrency: options.concurrency,
    }),
  );

  mkdirSync(options.runDir, { recursive: true });
  let completed = 0;

  await mapPool(pending, options.concurrency, async (email) => {
    const result = await verifyOne(apiKey, email);
    cache[email] = result;
    completed += 1;
    if (completed % PROGRESS_EVERY === 0 || completed === pending.length) {
      console.log(`Verified ${completed}/${pending.length} (${result}: ${email})`);
    }
    if (completed % CHECKPOINT_EVERY === 0 || completed === pending.length) {
      saveCheckpoint(options.resume, cache);
    }
    return result;
  });

  saveCheckpoint(options.resume, cache);

  const base = basename(options.input, extname(options.input));
  const verifiedPath = join(options.runDir, `${base}_verified.csv`);
  const rejectedPath = join(options.runDir, `${base}_rejected.csv`);
  const auditPath = join(options.runDir, `${base}_mv_audit.csv`);

  const verifiedRows: Record<string, string>[] = [];
  const rejectedRows: Record<string, string>[] = [];
  const auditRows: Array<{ email: string; mv_result: string; kept: string }> = [];

  for (const row of rows) {
    const email = row[options.emailColumn]?.trim().toLowerCase() ?? '';
    const mvResult = cache[email] ?? 'missing';
    const kept = shouldKeep(mvResult, options.keepUnknown);
    const outRow = { ...row, mv_result: mvResult };
    if (kept) verifiedRows.push(outRow);
    else rejectedRows.push(outRow);
    auditRows.push({ email, mv_result: mvResult, kept: kept ? 'yes' : 'no' });
  }

  const columns = [...Object.keys(rows[0]!), 'mv_result'];
  writeCsv(verifiedPath, verifiedRows, columns);
  writeCsv(rejectedPath, rejectedRows, columns);
  writeCsv(auditPath, auditRows as unknown as Record<string, string>[], [
    'email',
    'mv_result',
    'kept',
  ]);

  const counts = auditRows.reduce(
    (acc, row) => {
      acc[row.mv_result] = (acc[row.mv_result] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  console.log(
    JSON.stringify({
      verified_path: verifiedPath,
      rejected_path: rejectedPath,
      audit_path: auditPath,
      rows_in: rows.length,
      rows_kept: verifiedRows.length,
      rows_rejected: rejectedRows.length,
      mv_result_counts: counts,
    }),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
