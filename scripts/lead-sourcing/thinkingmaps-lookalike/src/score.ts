import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assignBins, geoCounts, isCcdSentinel, loadFeaturesConfig } from './features.js';
import { createRunDir, parseCliArgs } from './lib/cli.js';
import { rowToRecord, writeCsv } from './lib/csv.js';
import { loadEnv, packageRoot } from './lib/env.js';
import { writeJson } from './lib/io.js';
import { LOOKALIKE_COLUMNS, loadCcdUniverse } from './ioCcd.js';
import { loadWonDistrictsCsv } from './match.js';
import { matchDistricts } from './matchDistricts.js';
import { loadMatchesCsv } from './profile.js';
import { formatReasons, scoreDistrict, scoredMatches } from './profileModel.js';
import type { CcdDistrict, FeatureProfile, FeaturesConfig, ScoredDistrict } from './types.js';

export function excludeReasons(
  district: CcdDistrict,
  wonLeaids: Set<string>,
  avoidLeaids: Set<string>,
): string {
  if (isCcdSentinel(district.enrollment) || district.enrollment === 0) return 'missing_enrollment';
  if (wonLeaids.has(district.leaid)) return 'existing_customer';
  if (avoidLeaids.has(district.leaid)) return 'avoid_list';
  return '';
}

export function scoreUniverse(options: {
  universe: CcdDistrict[];
  profile: FeatureProfile;
  wonLeaids: Set<string>;
  avoidLeaids: Set<string>;
  config?: FeaturesConfig;
  geoWon: CcdDistrict[];
}): ScoredDistrict[] {
  const config = options.config ?? loadFeaturesConfig();
  const scored: ScoredDistrict[] = [];
  for (const district of options.universe) {
    const exclude_reason = excludeReasons(district, options.wonLeaids, options.avoidLeaids);
    const geo = geoCounts(district, options.geoWon, config.nearby_miles);
    const bins = assignBins(district, config, geo);
    const { score, contributions } = scoreDistrict(bins, options.profile);
    scored.push({
      ...district,
      bins,
      score,
      reasons: formatReasons(contributions),
      excluded: Boolean(exclude_reason),
      exclude_reason,
    });
  }
  return scored;
}

export function rankLookalikes(scored: ScoredDistrict[]): ScoredDistrict[] {
  return scored
    .filter((row) => !row.excluded)
    .sort((a, b) => b.score - a.score || (b.enrollment ?? 0) - (a.enrollment ?? 0));
}

export function writeLookalikeOutputs(runDir: string, ranked: ScoredDistrict[]): void {
  const rows = ranked.map((row, i) =>
    rowToRecord({
      rank: i + 1,
      leaid: row.leaid,
      lea_name: row.lea_name,
      state: row.state,
      city: row.city,
      zip: row.zip,
      enrollment: row.enrollment ?? '',
      locale: row.bins.locale,
      grade_span: row.bins.grade_span,
      agency: row.bins.agency,
      ell_share: row.bins.ell_share,
      spec_ed_share: row.bins.spec_ed_share,
      poverty_share: row.bins.poverty_share,
      score: row.score.toFixed(4),
      reasons: row.reasons,
    }),
  );
  writeCsv(join(runDir, 'lookalike_districts.csv'), rows, LOOKALIKE_COLUMNS);

  const byState = new Map<string, { count: number; top_score: number }>();
  for (const row of ranked) {
    const cur = byState.get(row.state) ?? { count: 0, top_score: -Infinity };
    cur.count += 1;
    cur.top_score = Math.max(cur.top_score, row.score);
    byState.set(row.state, cur);
  }
  const stateRows = [...byState.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([state, info]) =>
      rowToRecord({ state, lookalike_count: info.count, top_score: info.top_score.toFixed(4) }),
    );
  writeCsv(join(runDir, 'lookalike_by_state.csv'), stateRows, ['state', 'lookalike_count', 'top_score']);
}

export function scoreRun(options: {
  runDir: string;
  universe: CcdDistrict[];
  profile: FeatureProfile;
}): ScoredDistrict[] {
  const matches = scoredMatches(loadMatchesCsv(join(options.runDir, 'matches.csv')));
  const wonLeaids = new Set(matches.map((m) => m.leaid));
  const byLeaid = new Map(options.universe.map((d) => [d.leaid, d]));
  const geoWon = matches.map((m) => byLeaid.get(m.leaid)).filter((d): d is CcdDistrict => Boolean(d));

  let avoidLeaids = new Set<string>();
  const avoidPath = join(options.runDir, 'avoid_districts.csv');
  if (existsSync(avoidPath)) {
    const avoidWon = loadWonDistrictsCsv(avoidPath);
    avoidLeaids = new Set(
      matchDistricts(avoidWon, options.universe)
        .filter((m) => m.leaid && (m.confidence === 'high' || m.confidence === 'medium'))
        .map((m) => m.leaid),
    );
  }

  const scored = scoreUniverse({
    universe: options.universe,
    profile: options.profile,
    wonLeaids,
    avoidLeaids,
    geoWon,
  });
  const ranked = rankLookalikes(scored);
  writeLookalikeOutputs(options.runDir, ranked);
  writeJson(join(options.runDir, 'score_summary.json'), {
    universe: options.universe.length,
    ranked: ranked.length,
    excluded_customer: scored.filter((s) => s.exclude_reason === 'existing_customer').length,
    excluded_avoid: scored.filter((s) => s.exclude_reason === 'avoid_list').length,
    excluded_enrollment: scored.filter((s) => s.exclude_reason === 'missing_enrollment').length,
    top_score: ranked[0]?.score ?? 0,
  });
  console.error(`[score] ranked=${ranked.length} excluded_customer=${wonLeaids.size} avoid=${avoidLeaids.size}`);
  return ranked;
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  const universePath = cli.fixtures
    ? join(packageRoot, 'fixtures/ccd-universe.json')
    : join(packageRoot, 'data/ccd-universe-2024.json');
  if (!existsSync(universePath)) throw new Error(`CCD universe missing: ${universePath}`);
  const { loadJson } = await import('./lib/io.js');
  const profile = loadJson<FeatureProfile>(join(runDir, 'profile.json'));
  if (!profile) throw new Error('profile.json missing. Run profile first.');
  scoreRun({ runDir, universe: loadCcdUniverse(universePath), profile });
}

const isDirect = resolve(process.argv[1] ?? '') === resolve(packageRoot, 'src/score.ts');
if (isDirect) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
