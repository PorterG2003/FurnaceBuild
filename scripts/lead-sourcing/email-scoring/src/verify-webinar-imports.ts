/**
 * Verify all webinar host import CSVs, sharing one MV cache/checkpoint.
 *
 * Usage:
 *   npm run verify:webinar
 *   npm run verify:webinar -- --resume path/to/mv_checkpoint.json
 *   npm run verify:webinar -- --max-rows 50   # smoke test
 */

import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureEnv, millionVerifierApiKey, repoRoot } from './lib/env.js';
import { parseCliArgs, truncateRows } from './lib/cli.js';
import { readCsv, writeCsv } from './lib/csv.js';
import { MillionVerifier, type MvResult } from './lib/millionVerifier.js';

const WEBINAR_RUN_DIR = join(
  repoRoot,
  'scripts/lead-sourcing/webinar-hosts/output/runs/stage1-live',
);
const IMPORT_DIR = join(WEBINAR_RUN_DIR, 'campaign-import');
const OUTPUT_DIR = join(WEBINAR_RUN_DIR, 'mv-verified');

const IMPORT_FILES = [
  'furnace_import_core.csv',
  'furnace_import_revenue.csv',
  'furnace_import_community.csv',
] as const;

const KEEP_RESULTS = new Set<MvResult>(['ok', 'catch_all']);
const PROGRESS_EVERY = 25;
const CHECKPOINT_EVERY = 50;

function loadCheckpoint(path: string): Record<string, MvResult> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, MvResult>;
}

function saveCheckpoint(path: string, cache: Record<string, MvResult>): void {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}

function shouldKeep(result: MvResult): boolean {
  return KEEP_RESULTS.has(result);
}

export async function runVerifyWebinarImports(): Promise<void> {
  const cli = parseCliArgs();
  const fixtureMode = cli.fixtures;
  const dryRun = cli.dryRun;
  const maxRows = cli.maxRows;

  let resumePath = join(OUTPUT_DIR, 'mv_checkpoint.json');
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--resume' && process.argv[i + 1]) {
      resumePath = resolve(process.argv[++i]!);
    }
  }

  const allEmails = new Set<string>();
  const fileRows = new Map<string, Record<string, string>[]>();

  for (const file of IMPORT_FILES) {
    const path = join(IMPORT_DIR, file);
    const rows = truncateRows(readCsv(path), maxRows);
    fileRows.set(file, rows);
    for (const row of rows) {
      const email = row.Email?.trim().toLowerCase();
      if (email?.includes('@')) allEmails.add(email);
    }
  }

  if (dryRun) {
    console.log(
      JSON.stringify({
        dry_run: true,
        unique_emails: allEmails.size,
        files: IMPORT_FILES,
        output_dir: OUTPUT_DIR,
        estimated_minutes: Math.ceil((allEmails.size * 0.2) / 60),
        use_fixtures: fixtureMode,
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

  if (existsSync(resumePath)) {
    verifier.loadCache(loadCheckpoint(resumePath));
    console.log(`Resumed checkpoint: ${verifier.cacheSize} cached results`);
  }

  const pending = [...allEmails].filter((email) => !verifier.exportCache()[email]);
  console.log(`Verifying ${pending.length} unique emails (${verifier.cacheSize} cached)`);

  for (let i = 0; i < pending.length; i++) {
    const email = pending[i]!;
    const result = await verifier.getResult(email);
    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === pending.length) {
      console.log(`Verified ${i + 1}/${pending.length} — ${result}: ${email}`);
    }
    if ((i + 1) % CHECKPOINT_EVERY === 0 || i + 1 === pending.length) {
      saveCheckpoint(resumePath, verifier.exportCache());
    }
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const resultByEmail = verifier.exportCache();
  const summary: Record<string, number> = {};
  let totalIn = 0;
  let totalKept = 0;
  let totalRejected = 0;

  for (const file of IMPORT_FILES) {
    const rows = fileRows.get(file) ?? [];
    const verified: Record<string, string>[] = [];
    const rejected: Record<string, string>[] = [];
    const columns = [...Object.keys(rows[0] ?? { Email: '' }), 'mv_result'];

    for (const row of rows) {
      const email = row.Email?.trim().toLowerCase() ?? '';
      const mvResult = resultByEmail[email] ?? 'missing';
      summary[mvResult] = (summary[mvResult] ?? 0) + 1;
      const outRow = { ...row, mv_result: mvResult };
      if (shouldKeep(mvResult)) {
        verified.push(outRow);
      } else {
        rejected.push(outRow);
      }
    }

    const base = file.replace('.csv', '');
    writeCsv(join(OUTPUT_DIR, `${base}_verified.csv`), verified, columns);
    writeCsv(join(OUTPUT_DIR, `${base}_rejected.csv`), rejected, columns);

    totalIn += rows.length;
    totalKept += verified.length;
    totalRejected += rejected.length;
    console.log(`${file}: kept ${verified.length}/${rows.length}`);
  }

  const auditRows = Object.entries(resultByEmail).map(([email, mv_result]) => ({
    email,
    mv_result,
    kept: shouldKeep(mv_result) ? 'yes' : 'no',
  }));
  writeCsv(join(OUTPUT_DIR, 'mv_audit_all.csv'), auditRows, ['email', 'mv_result', 'kept']);

  console.log(
    JSON.stringify({
      output_dir: OUTPUT_DIR,
      checkpoint_path: resumePath,
      rows_in: totalIn,
      rows_kept: totalKept,
      rows_rejected: totalRejected,
      mv_unique_calls: verifier.cacheSize,
      mv_result_counts: summary,
    }),
  );
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runVerifyWebinarImports().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
