import { basename, extname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureEnv, inputsDir, millionVerifierApiKey, packageRoot } from './lib/env.js';
import { createRunDir, parseCliArgs, truncateRows } from './lib/cli.js';
import { readCsv, writeCsv } from './lib/csv.js';
import { MillionVerifier } from './lib/millionVerifier.js';
import { pickBestEmail } from './lib/scoring.js';

const DEFAULT_INPUT = join(
  inputsDir,
  'Furnace 4_21_2026 - [Need to Call] [Florida] [Utah] [Home Builders].csv',
);

const EMAIL_COLUMNS = ['contact_email_1', 'contact_email_2', 'contact_email_3'] as const;
const PROGRESS_EVERY = 50;

export type PickBestEmailOptions = {
  inputPath?: string;
  outputPath?: string;
  dryRun?: boolean;
  maxRows?: number | null;
  useFixtures?: boolean;
};

export type PickBestEmailResult = {
  inputPath: string;
  outputPath: string;
  rowsProcessed: number;
  bestEmailCount: number;
  mvCacheSize: number;
};

function defaultOutputPath(inputPath: string, runDir: string): string {
  const base = basename(inputPath, extname(inputPath));
  return join(packageRoot, runDir, `${base}_best_email.csv`);
}

export async function runPickBestEmail(options: PickBestEmailOptions = {}): Promise<PickBestEmailResult> {
  const cli = parseCliArgs();
  const inputPath = resolve(options.inputPath ?? cli.input ?? DEFAULT_INPUT);
  const dryRun = options.dryRun ?? cli.dryRun;
  const maxRows = options.maxRows ?? cli.maxRows;
  const fixtureMode = options.useFixtures ?? cli.fixtures ?? false;

  if (!fixtureMode && !dryRun) {
    await ensureEnv();
  }
  const runDir = createRunDir();
  const outputPath = resolve(
    options.outputPath ?? cli.output ?? defaultOutputPath(inputPath, runDir),
  );

  const rows = truncateRows(readCsv(inputPath), maxRows);
  if (rows.length === 0) {
    throw new Error(`No rows found in ${inputPath}`);
  }

  const columns = [...Object.keys(rows[0]!)];
  if (!columns.includes('best_email')) {
    columns.push('best_email');
  }

  if (dryRun) {
    console.log(
      JSON.stringify({
        dry_run: true,
        input_path: inputPath,
        output_path: outputPath,
        row_count: rows.length,
        use_fixtures: fixtureMode,
      }),
    );
    return {
      inputPath,
      outputPath,
      rowsProcessed: rows.length,
      bestEmailCount: 0,
      mvCacheSize: 0,
    };
  }

  const verifier = new MillionVerifier({
    apiKey: fixtureMode ? 'fixture' : millionVerifierApiKey(),
    mock: fixtureMode,
  });

  let bestEmailCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const personName = row.person_name ?? '';
    const emails = EMAIL_COLUMNS.map((col) => row[col]);

    const bestEmail = await pickBestEmail(personName, emails, verifier);
    row.best_email = bestEmail;
    if (bestEmail) bestEmailCount += 1;

    if ((i + 1) % PROGRESS_EVERY === 0 || i + 1 === rows.length) {
      console.log(`Processed ${i + 1}/${rows.length} rows (${bestEmailCount} best emails so far)`);
    }
  }

  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeCsv(outputPath, rows, columns);

  console.log(
    JSON.stringify({
      input_path: inputPath,
      output_path: outputPath,
      rows_processed: rows.length,
      best_email_count: bestEmailCount,
      mv_unique_calls: verifier.cacheSize,
    }),
  );

  return {
    inputPath,
    outputPath,
    rowsProcessed: rows.length,
    bestEmailCount,
    mvCacheSize: verifier.cacheSize,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  runPickBestEmail().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
