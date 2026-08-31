import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadFeaturesConfig } from './features.js';
import { createRunDir, parseCliArgs } from './lib/cli.js';
import { loadEnv, packageRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';
import { loadCcdUniverse } from './ioCcd.js';
import { loadWonDistrictsCsv } from './match.js';
import { loadMatchesCsv } from './profile.js';
import { buildProfile, scoredMatches } from './profileModel.js';
import { rankLookalikes, scoreUniverse } from './score.js';
import type { CcdDistrict } from './types.js';

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function holdoutSplit<T>(items: T[], fraction: number, seed: number): { train: T[]; holdout: T[] } {
  const shuffled = seededShuffle(items, seed);
  const nHold = Math.max(1, Math.round(shuffled.length * fraction));
  return { holdout: shuffled.slice(0, nHold), train: shuffled.slice(nHold) };
}

export function validateRun(options: { runDir: string; universe: CcdDistrict[] }): {
  holdout_count: number;
  top_decile_count: number;
  top_decile_share: number;
  median_percentile: number;
} {
  const config = loadFeaturesConfig();
  const won = loadWonDistrictsCsv(join(options.runDir, 'won_districts.csv'));
  const matches = scoredMatches(loadMatchesCsv(join(options.runDir, 'matches.csv')));
  const { train, holdout } = holdoutSplit(matches, config.holdout_fraction, config.holdout_seed);
  const trainLeaids = new Set(train.map((m) => m.leaid));
  const holdoutLeaids = new Set(holdout.map((m) => m.leaid));
  const profile = buildProfile({
    universe: options.universe,
    won,
    matches,
    config,
    trainingLeaids: trainLeaids,
  });
  const byLeaid = new Map(options.universe.map((d) => [d.leaid, d]));
  const geoWon = train.map((m) => byLeaid.get(m.leaid)).filter((d): d is CcdDistrict => Boolean(d));

  const scored = scoreUniverse({
    universe: options.universe,
    profile,
    wonLeaids: trainLeaids,
    avoidLeaids: new Set(),
    config,
    geoWon,
  });
  const ranked = rankLookalikes(scored);
  const holdoutRanks = holdout
    .map((m) => ranked.findIndex((row) => row.leaid === m.leaid))
    .filter((rank) => rank >= 0)
    .map((rank) => rank + 1);

  const n = ranked.length || 1;
  const percentiles = holdoutRanks.map((rank) => rank / n);
  percentiles.sort((a, b) => a - b);
  const topDecileCount = percentiles.filter((p) => p <= 0.1).length;
  const median = percentiles.length
    ? percentiles[Math.floor(percentiles.length / 2)]!
    : 1;

  const result = {
    holdout_count: holdout.length,
    holdout_ranked: holdoutRanks.length,
    top_decile_count: topDecileCount,
    top_decile_share: holdout.length ? topDecileCount / holdout.length : 0,
    median_percentile: median,
    train_count: train.length,
    universe_ranked: ranked.length,
    holdout_leaids: holdout.map((m) => m.leaid),
  };
  writeJson(join(options.runDir, 'validation.json'), result);
  console.error(
    `[validate] holdout=${holdout.length} top_decile=${topDecileCount} (${(result.top_decile_share * 100).toFixed(0)}%) median_pct=${(median * 100).toFixed(1)}`,
  );
  void holdoutLeaids;
  return result;
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  const universePath = cli.fixtures
    ? join(packageRoot, 'fixtures/ccd-universe.json')
    : join(packageRoot, 'data/ccd-universe-2024.json');
  if (!existsSync(universePath)) throw new Error(`CCD universe missing: ${universePath}`);
  validateRun({ runDir, universe: loadCcdUniverse(universePath) });
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/validate.ts');
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
