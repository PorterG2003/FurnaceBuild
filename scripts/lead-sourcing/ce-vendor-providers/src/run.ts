import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir } from './lib/cli.js';
import { loadEnv, packageRoot, useFixtures } from './lib/env.js';
import { ingestDirectories } from './directories/ingest.js';
import { classifyEntries } from './classify/run.js';
import { resolveFit } from './fit/run.js';
import { harvestSearch } from './search/harvest.js';
import { aggregateRun } from './aggregate/run.js';

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const fixtures = cli.fixtures || useFixtures();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));

  console.error(`[1/6] directories → ${runDir}`);
  await ingestDirectories({ runDir, fixtures, maxRows: cli.maxRows, maxPages: cli.maxPages });

  console.error('[2/6] classify');
  await classifyEntries({ runDir, fixtures, maxRows: cli.maxRows });

  console.error('[3/6] fit');
  await resolveFit({ runDir, fixtures, maxRows: cli.maxRows });

  if (fixtures || cli.live || cli.dryRun) {
    console.error('[4/6] host search');
    await harvestSearch({
      runDir,
      mode: 'host',
      fixtures,
      dryRun: cli.dryRun && !fixtures,
      live: cli.live,
      maxQueries: cli.maxQueries,
      maxPages: cli.maxPages,
      wave: cli.wave,
    });
    console.error('[5/6] grant search');
    await harvestSearch({
      runDir,
      mode: 'grant',
      fixtures,
      dryRun: cli.dryRun && !fixtures,
      live: cli.live,
      maxQueries: cli.maxQueries,
      maxPages: cli.maxPages,
      wave: cli.wave,
    });
  } else {
    console.error('[4-5/6] skipping Serper (pass --fixtures or --live / --dry-run)');
  }

  console.error('[6/6] aggregate');
  const out = aggregateRun(runDir);
  console.error(`Done. ${out.prospectsPath}\n${out.coveragePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
