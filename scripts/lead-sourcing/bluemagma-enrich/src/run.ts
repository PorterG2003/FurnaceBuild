import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir } from './lib/cli.js';
import { loadEnv, packageRoot, defaultInputCsv, useFixtures } from './lib/env.js';
import { prepCompanies } from './prep.js';
import { resolveWebsites } from './resolve-websites.js';
import { classifyRoles } from './classify-role.js';
import { enrichSoc2 } from './enrich-soc2.js';
import { enrichFunding } from './enrich-funding.js';
import { mergeEnriched } from './merge.js';

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const fixtures = cli.fixtures || useFixtures();
  const input = resolve(cli.input ?? defaultInputCsv());
  if (!existsSync(input) && (cli.stage === 'prep' || !cli.stage)) {
    throw new Error(`Input CSV not found: ${input}`);
  }
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  const stage = cli.stage ?? 'all';

  if (stage === 'prep' || stage === 'all') {
    console.error(`[1/5] prep → ${runDir}`);
    prepCompanies({ inputCsv: input, runDir, maxRows: cli.maxRows });
  }
  if (stage === 'resolve' || stage === 'all') {
    console.error('[2/5] resolve websites');
    await resolveWebsites({
      runDir,
      dryRun: cli.dryRun,
      live: cli.live,
      fixtures,
      maxRows: cli.maxRows,
      acceptMedium: cli.acceptMedium || fixtures,
    });
  }
  if (stage === 'classify' || stage === 'all') {
    if (cli.dryRun && stage === 'all') {
      console.error('[3/5] classify skipped on dry-run (no domains yet)');
    } else {
      console.error('[3/5] classify role');
      await classifyRoles({ runDir, fixtures, maxRows: cli.maxRows });
    }
  }
  if (stage === 'soc2' || stage === 'all') {
    console.error('[4/5] enrich SOC2');
    await enrichSoc2({
      runDir,
      dryRun: cli.dryRun,
      live: cli.live,
      fixtures,
      maxRows: cli.maxRows,
    });
  }
  if (stage === 'funding') {
    console.error('[funding] enrich funding (backfill)');
    await enrichFunding({
      runDir,
      dryRun: cli.dryRun,
      live: cli.live,
      fixtures,
      maxRows: cli.maxRows,
    });
  }
  if (stage === 'merge' || stage === 'all') {
    if (cli.dryRun && stage === 'all') {
      console.error('[5/5] merge skipped on dry-run');
    } else {
      console.error('[5/5] merge');
      mergeEnriched(runDir);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
