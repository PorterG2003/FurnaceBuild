import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRunDir, parseCliArgs } from './lib/cli.ts';
import { createHubSpotClient, totalCalls } from './lib/hubspotClient.ts';
import { DEFAULT_ACCREDITATION_NAME } from './lib/types.ts';
import { runStage1Search } from './stage1-search/scrape.ts';
import { runStage2Detail } from './stage2-detail/enrich.ts';

async function main(): Promise<void> {
  const args = parseCliArgs();
  const runDir = args.runDir ?? createRunDir();
  mkdirSync(runDir, { recursive: true });

  const meta = {
    startedAt: new Date().toISOString(),
    accreditationId: args.accreditationId,
    accreditationName: DEFAULT_ACCREDITATION_NAME,
    maxRows: args.maxRows,
    fixtures: args.fixtures,
    resume: args.resume,
    dryRun: args.dryRun,
  };
  writeFileSync(join(runDir, 'run_meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`[run] dir=${runDir}`);
  console.log(
    `[run] accreditation=${args.accreditationId} maxRows=${args.maxRows ?? 'all'} fixtures=${args.fixtures} resume=${args.resume}`,
  );

  const client = createHubSpotClient({
    accreditationId: args.accreditationId,
    fixtures: args.fixtures,
  });

  const stage1 = await runStage1Search({
    runDir,
    client,
    accreditationId: args.accreditationId,
    pageSize: args.pageSize,
    rateMs: args.rateMs,
    maxRows: args.maxRows,
    resume: args.resume,
    dryRun: args.dryRun,
  });

  console.log(`[run] stage1 complete: rows=${stage1.rows.length} api_total=${stage1.total}`);

  if (args.dryRun) {
    console.log(`[run] dry-run complete; HubSpot calls=${totalCalls(client.counter)}`);
    return;
  }

  const stage2 = await runStage2Detail({
    runDir,
    client,
    rateMs: args.rateMs,
    resume: args.resume,
    dryRun: false,
  });

  const ok = stage2.rows.filter((r) => r.detail_status === 'ok').length;
  const err = stage2.rows.filter((r) => r.detail_status === 'error').length;
  const successRate = stage2.rows.length ? ok / stage2.rows.length : 0;

  const summary = {
    finishedAt: new Date().toISOString(),
    searchTotal: stage1.total,
    partnersRows: stage1.rows.length,
    enrichedRows: stage2.rows.length,
    detailOk: ok,
    detailError: err,
    detailSuccessRate: Number(successRate.toFixed(4)),
    calls: { ...client.counter, total: totalCalls(client.counter) },
  };
  writeFileSync(join(runDir, 'run_summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`[run] stage2 complete: ok=${ok} error=${err} successRate=${(successRate * 100).toFixed(1)}%`);
  console.log(`[run] HubSpot calls: ${JSON.stringify(summary.calls)}`);
  console.log(`[run] outputs: ${join(runDir, 'partners.csv')} ${join(runDir, 'partners_enriched.csv')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
