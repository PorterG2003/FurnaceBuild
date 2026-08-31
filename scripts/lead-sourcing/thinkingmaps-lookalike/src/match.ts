import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRunDir, parseCliArgs } from './lib/cli.js';
import { readCsv, rowToRecord, writeCsv } from './lib/csv.js';
import { loadEnv, packageRoot } from './lib/env.js';
import { MATCH_COLUMNS, loadCcdUniverse } from './ioCcd.js';
import { matchDistricts } from './matchDistricts.js';
import type { DistrictMatch, WonDistrict } from './types.js';

export function loadWonDistrictsCsv(path: string): WonDistrict[] {
  return readCsv(path).map((row) => ({
    district_key: row.district_key,
    district_name: row.district_name,
    canonical_name: row.canonical_name,
    state: row.state,
    city: row.city,
    zip: row.zip,
    street: row.street,
    revenue: Number(row.revenue) || 0,
    account_count: Number(row.account_count) || 0,
    sample_account_ids: row.sample_account_ids,
    is_charter: row.is_charter === 'true',
    is_nyc_subunit: row.is_nyc_subunit === 'true',
  }));
}

export function writeMatches(runDir: string, matches: DistrictMatch[]): void {
  writeCsv(join(runDir, 'matches.csv'), matches.map((row) => rowToRecord(row)), MATCH_COLUMNS);
  const review = [...matches].sort((a, b) => b.revenue - a.revenue);
  writeCsv(join(runDir, 'match_review.csv'), review.map((row) => rowToRecord(row)), MATCH_COLUMNS);
}

export function matchWonToCcd(options: { runDir: string; universe: ReturnType<typeof loadCcdUniverse> }): DistrictMatch[] {
  const won = loadWonDistrictsCsv(join(options.runDir, 'won_districts.csv'));
  const matches = matchDistricts(won, options.universe);
  writeMatches(options.runDir, matches);
  const high = matches.filter((m) => m.confidence === 'high' && m.leaid).length;
  const unmatched = matches.filter((m) => !m.leaid).length;
  console.error(`[match] won=${won.length} high=${high} unmatched=${unmatched} → ${options.runDir}`);
  return matches;
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  const universePath = cli.fixtures
    ? join(packageRoot, 'fixtures/ccd-universe.json')
    : join(packageRoot, 'data/ccd-universe-2024.json');
  if (!existsSync(universePath)) throw new Error(`CCD universe missing: ${universePath}`);
  matchWonToCcd({ runDir, universe: loadCcdUniverse(universePath) });
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/match.ts');
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
