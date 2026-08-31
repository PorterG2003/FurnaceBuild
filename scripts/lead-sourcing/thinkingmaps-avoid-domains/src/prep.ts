import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir, truncateRows } from './lib/cli.js';
import { loadEnv, packageRoot, defaultInputCsv } from './lib/env.js';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { ensureDir, writeJson } from './lib/io.js';
import {
  buildLookups,
  parseAccountRow,
  type AccountRow,
  type Lookup,
} from './lookups.js';

export const ACCOUNT_COLUMNS = [
  'account_name',
  'account_id',
  'parent_account',
  'city',
  'state',
  'zip',
  'street',
  'skipped',
  'skip_reason',
  'district_lookup_key',
  'school_lookup_key',
  'org_lookup_key',
] as const;

export const LOOKUP_COLUMNS = [
  'lookup_key',
  'kind',
  'name',
  'city',
  'state',
  'mega',
] as const;

export function prepAvoidList(options: {
  inputCsv: string;
  runDir: string;
  maxRows?: number | null;
}): { accounts: number; skipped: number; lookups: number } {
  const runDir = ensureDir(options.runDir);
  let raw = readCsv(options.inputCsv);
  raw = truncateRows(raw, options.maxRows ?? null);

  const parsed: AccountRow[] = raw.map(parseAccountRow);
  const { accounts, lookups } = buildLookups(parsed);
  const skipped = accounts.filter((a) => a.skipped).length;

  writeCsv(
    join(runDir, 'accounts.csv'),
    accounts.map((a) => rowToRecord(a)),
    ACCOUNT_COLUMNS,
  );
  writeCsv(
    join(runDir, 'lookups.csv'),
    lookups.map((l: Lookup) => rowToRecord({ ...l, mega: l.mega })),
    LOOKUP_COLUMNS,
  );
  writeJson(join(runDir, 'prep_summary.json'), {
    input_rows: raw.length,
    accounts: accounts.length,
    skipped_test: skipped,
    unique_lookups: lookups.length,
    district_lookups: lookups.filter((l) => l.kind === 'district').length,
    school_lookups: lookups.filter((l) => l.kind === 'school').length,
    org_lookups: lookups.filter((l) => l.kind === 'org').length,
    mega_lookups: lookups.filter((l) => l.mega).length,
  });

  console.error(
    `[prep] rows=${raw.length} skipped=${skipped} lookups=${lookups.length} → ${runDir}`,
  );
  return { accounts: accounts.length, skipped, lookups: lookups.length };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const input = resolve(cli.input ?? defaultInputCsv());
  if (!existsSync(input)) throw new Error(`Input CSV not found: ${input}`);
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  prepAvoidList({ inputCsv: input, runDir, maxRows: cli.maxRows });
}

if (process.argv[1]?.includes('prep.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
