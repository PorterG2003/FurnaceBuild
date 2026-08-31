import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir } from './lib/cli.js';
import { loadEnv, packageRoot, useFixtures } from './lib/env.js';
import { fetchCcdUniverse } from './fetchCcd.js';
import { matchWonToCcd } from './match.js';
import { prepWonDistricts, resolveAvoidCsv, resolveInputCsv } from './prep.js';
import { profileRun } from './profile.js';
import { scoreRun } from './score.js';
import { validateRun } from './validate.js';

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const fixtures = cli.fixtures || useFixtures();
  const input = resolveInputCsv(cli.input, fixtures);
  if (!existsSync(input) && (cli.stage === 'prep' || !cli.stage)) {
    throw new Error(`Input CSV not found: ${input}`);
  }
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  const stage = cli.stage ?? 'all';

  let universe = fixtures
    ? (await fetchCcdUniverse({ fixtures: true, refresh: false })).rows
    : [];

  if (stage === 'prep' || stage === 'all') {
    console.error(`[1/6] prep → ${runDir}`);
    prepWonDistricts({
      inputCsv: input,
      avoidCsv: resolveAvoidCsv(cli.avoid, fixtures),
      runDir,
      maxRows: cli.maxRows,
    });
  }
  if (stage === 'fetch' || stage === 'all') {
    console.error('[2/6] fetch CCD + SAIPE');
    universe = (await fetchCcdUniverse({ fixtures, refresh: cli.refresh })).rows;
  }
  if (universe.length === 0 && (stage === 'match' || stage === 'profile' || stage === 'score' || stage === 'validate' || stage === 'all')) {
    universe = (await fetchCcdUniverse({ fixtures, refresh: false })).rows;
  }
  if (stage === 'match' || stage === 'all') {
    console.error('[3/6] match won districts to NCES');
    matchWonToCcd({ runDir, universe });
  }
  if (stage === 'profile' || stage === 'all') {
    console.error('[4/6] profile win-rate lift');
    profileRun({ runDir, universe });
  }
  if (stage === 'score' || stage === 'all') {
    console.error('[5/6] score universe');
    const { loadJson } = await import('./lib/io.js');
    const profile = loadJson<ReturnType<typeof profileRun>>(join(runDir, 'profile.json'));
    if (!profile) throw new Error('profile.json missing');
    scoreRun({ runDir, universe, profile });
  }
  if (stage === 'validate' || stage === 'all') {
    console.error('[6/6] holdout validation');
    validateRun({ runDir, universe });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
