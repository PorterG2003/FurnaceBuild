import { join, resolve } from 'node:path';
import { createRunDir, parseCliArgs } from './lib/cli.js';
import { loadEnv, packageRoot, useFixtures } from './lib/env.js';
import { ensureDir } from './lib/io.js';
import { ctxFromCli, printWaveAEstimate, runAcquire, runAdmit, runDoors, runEnrich, runOrgEnrich } from './pipeline.js';
import { runStreets } from './enrich/streets.js';
import { runContacts } from './enrich/contacts.js';

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  const fixtures = cli.fixtures || useFixtures();
  const runDir = resolve(cli.runDir ?? join(packageRoot, createRunDir()));
  ensureDir(runDir);
  const ctx = ctxFromCli(runDir, { ...cli, fixtures }, fixtures);
  const stage = cli.stage;

  if (stage === 'streets') {
    console.error('[streets]');
    await runStreets(ctx);
    return;
  }

  if (stage === 'contacts') {
    console.error('[contacts]');
    await runContacts(ctx);
    return;
  }

  if (cli.dryRun && stage === 'all') {
    printWaveAEstimate(ctx);
  }

  let admitted;
  let review;

  if (stage === 'acquire' || stage === 'all') {
    console.error(`[acquire] ${runDir}`);
    await runAcquire(ctx);
    if (cli.dryRun && !fixtures) return;
  }
  if (stage === 'admit' || stage === 'all') {
    console.error('[admit]');
    const result = await runAdmit(ctx);
    admitted = result.admitted;
    review = result.review;
  }
  if (stage === 'org-enrich' || stage === 'all') {
    console.error('[org-enrich]');
    const result = await runOrgEnrich(ctx);
    admitted = result.admitted;
    review = result.review;
    if (cli.dryRun && !fixtures) return;
  }
  if (stage === 'enrich' || stage === 'all') {
    console.error('[enrich]');
    admitted = await runEnrich(ctx, admitted);
    if (cli.dryRun && !fixtures && stage === 'all') return;
  }
  if (stage === 'doors' || stage === 'export' || stage === 'all') {
    console.error('[doors/export]');
    runDoors(ctx, admitted, review);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
