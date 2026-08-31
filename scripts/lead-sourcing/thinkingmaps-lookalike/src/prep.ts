import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRunDir, parseCliArgs, truncateRows } from './lib/cli.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import {
  defaultAvoidCsv,
  defaultInputCsv,
  downloadsAvoidCsv,
  downloadsClosedWonCsv,
  loadEnv,
  packageRoot,
  useFixtures,
} from './lib/env.js';
import { ensureDir, writeJson } from './lib/io.js';
import { WON_DISTRICT_COLUMNS } from './ioCcd.js';
import { parseAvoidAccountRow, parseWonAccountRow, rollupDistricts } from './rollup.js';
import type { WonDistrict } from './types.js';

export function resolveInputCsv(cliInput: string | undefined, fixtures: boolean): string {
  if (cliInput) return resolve(cliInput);
  if (process.env.CLOSED_WON_CSV?.trim()) return resolve(process.env.CLOSED_WON_CSV.trim());
  if (fixtures) return defaultInputCsv();
  const downloads = downloadsClosedWonCsv();
  if (existsSync(downloads)) return downloads;
  return defaultInputCsv();
}

export function resolveAvoidCsv(cliAvoid: string | undefined, fixtures: boolean): string | null {
  if (cliAvoid) return resolve(cliAvoid);
  if (process.env.AVOID_CSV?.trim()) return resolve(process.env.AVOID_CSV.trim());
  if (fixtures) return defaultAvoidCsv();
  const downloads = downloadsAvoidCsv();
  if (existsSync(downloads)) return downloads;
  if (existsSync(defaultAvoidCsv())) return defaultAvoidCsv();
  return null;
}

export function prepWonDistricts(options: {
  inputCsv: string;
  avoidCsv?: string | null;
  runDir: string;
  maxRows?: number | null;
}): { won: WonDistrict[]; avoid: WonDistrict[] } {
  const runDir = ensureDir(options.runDir);
  let raw = readCsv(options.inputCsv);
  raw = truncateRows(raw, options.maxRows ?? null);
  const won = rollupDistricts(raw.map(parseWonAccountRow));
  writeCsv(join(runDir, 'won_districts.csv'), won.map((row) => rowToRecord(row)), WON_DISTRICT_COLUMNS);

  let avoid: WonDistrict[] = [];
  if (options.avoidCsv && existsSync(options.avoidCsv)) {
    avoid = rollupDistricts(readCsv(options.avoidCsv).map(parseAvoidAccountRow));
    writeCsv(join(runDir, 'avoid_districts.csv'), avoid.map((row) => rowToRecord(row)), WON_DISTRICT_COLUMNS);
  }

  writeJson(join(runDir, 'prep_summary.json'), {
    input_rows: raw.length,
    won_districts: won.length,
    won_revenue: won.reduce((sum, row) => sum + row.revenue, 0),
    avoid_districts: avoid.length,
    charter_won: won.filter((row) => row.is_charter).length,
    nyc_subunits: won.filter((row) => row.is_nyc_subunit).length,
  });
  console.error(`[prep] accounts=${raw.length} districts=${won.length} avoid=${avoid.length} → ${runDir}`);
  return { won, avoid };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const fixtures = cli.fixtures || useFixtures();
  const input = resolveInputCsv(cli.input, fixtures);
  if (!existsSync(input)) throw new Error(`Input CSV not found: ${input}`);
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  prepWonDistricts({
    inputCsv: input,
    avoidCsv: resolveAvoidCsv(cli.avoid, fixtures),
    runDir,
    maxRows: cli.maxRows,
  });
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/prep.ts');
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
