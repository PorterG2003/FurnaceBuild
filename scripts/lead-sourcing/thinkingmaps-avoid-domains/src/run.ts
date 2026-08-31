import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs, createRunDir } from './lib/cli.js';
import { loadEnv, packageRoot, defaultInputCsv, useFixtures } from './lib/env.js';
import { prepAvoidList } from './prep.js';
import { resolveLookups } from './resolve.js';
import { mergeResults } from './merge.js';

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
    console.error(`[1/3] prep → ${runDir}`);
    prepAvoidList({ inputCsv: input, runDir, maxRows: cli.maxRows });
  }
  if (stage === 'resolve' || stage === 'all') {
    console.error('[2/3] resolve websites + emails');
    await resolveLookups({
      runDir,
      dryRun: cli.dryRun,
      live: cli.live,
      fixtures,
    });
  }
  if (stage === 'merge' || stage === 'all') {
    if (cli.dryRun && stage === 'all') {
      console.error('[3/3] merge skipped on dry-run (no lookup results yet)');
    } else {
      console.error('[3/3] merge review + unique domains');
      mergeResults(runDir);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
