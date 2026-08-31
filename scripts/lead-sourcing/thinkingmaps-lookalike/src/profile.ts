import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRunDir, parseCliArgs } from './lib/cli.js';
import { loadEnv, packageRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';
import { loadCcdUniverse } from './ioCcd.js';
import { loadWonDistrictsCsv } from './match.js';
import { readCsv } from './lib/csv.js';
import { buildProfile } from './profileModel.js';
import type { DistrictMatch } from './types.js';

export function loadMatchesCsv(path: string): DistrictMatch[] {
  return readCsv(path).map((row) => ({
    district_key: row.district_key,
    district_name: row.district_name,
    state: row.state,
    city: row.city,
    zip: row.zip,
    revenue: Number(row.revenue) || 0,
    account_count: Number(row.account_count) || 0,
    is_charter: row.is_charter === 'true',
    is_nyc_subunit: row.is_nyc_subunit === 'true',
    leaid: row.leaid,
    nces_name: row.nces_name,
    nces_city: row.nces_city,
    nces_state: row.nces_state,
    confidence: row.confidence as DistrictMatch['confidence'],
    method: row.method as DistrictMatch['method'],
    score: Number(row.score) || 0,
    needs_review: row.needs_review === 'true',
    review_reason: row.review_reason,
  }));
}

export function profileRun(options: { runDir: string; universe: ReturnType<typeof loadCcdUniverse> }): ReturnType<typeof buildProfile> {
  const won = loadWonDistrictsCsv(join(options.runDir, 'won_districts.csv'));
  const matches = loadMatchesCsv(join(options.runDir, 'matches.csv'));
  const profile = buildProfile({ universe: options.universe, won, matches });
  writeJson(join(options.runDir, 'profile.json'), profile);
  console.error(
    `[profile] won=${profile.won_count} universe=${profile.universe_count} base_rate=${(profile.base_rate * 100).toFixed(2)}% → ${options.runDir}`,
  );
  return profile;
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  const universePath = cli.fixtures
    ? join(packageRoot, 'fixtures/ccd-universe.json')
    : join(packageRoot, 'data/ccd-universe-2024.json');
  if (!existsSync(universePath)) throw new Error(`CCD universe missing: ${universePath}`);
  profileRun({ runDir, universe: loadCcdUniverse(universePath) });
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/profile.ts');
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
