import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asNumber, outputDir, parseArgs } from './env.js';
import { prepPass3 } from './pass3Prep.js';
import { expandLandings } from './expandLandings.js';
import { discoverDomains } from './discoverDomains.js';
import { confirmDomains } from './confirmDomains.js';
import { enrichPass3 } from './enrichPass3.js';
import { mergePass3 } from './mergePass3.js';
import { readCsv } from './io.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stage = typeof args.stage === 'string' ? args.stage : '';
  const dryRun = Boolean(args['dry-run']);
  const live = Boolean(args.live);

  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass3Dir =
    typeof args['pass3-dir'] === 'string'
      ? args['pass3-dir']
      : join(pass1Dir, 'pass3');

  if (!['prep', 'expand', 'serper', 'confirm', 'enrich', 'merge', 'all'].includes(stage)) {
    console.error(
      'Usage: --stage prep|expand|serper|confirm|enrich|merge|all [--dry-run|--live]',
    );
    process.exit(2);
  }

  if (stage !== 'prep' && stage !== 'expand' && stage !== 'merge') {
    if (!dryRun && !live) {
      console.error('Pass --dry-run or --live (paid stages need spend OK).');
      process.exit(2);
    }
  }
  // For --stage all without dry-run/live: allow expand-only path by requiring flag for paid parts
  if (stage === 'all' && !dryRun && !live) {
    console.error('For --stage all, pass --dry-run or --live (live covers Serper/Apollo/Prospeo after free expand).');
    process.exit(2);
  }

  if (!existsSync(join(pass3Dir, 'no_domain_misses.csv')) || stage === 'prep') {
    prepPass3({ pass1Dir, pass2Dir: join(pass1Dir, 'pass2'), pass3Dir });
  }

  const maxRows = asNumber(args['max-rows'], null);
  const misses = join(pass3Dir, 'no_domain_misses.csv');

  if (stage === 'expand' || stage === 'all') {
    // Playwright expand is free — live not required
    await expandLandings({
      inputCsv: misses,
      outDir: pass3Dir,
      dryRun,
      maxRows,
      usePlaywright: args['no-playwright'] ? false : true,
    });
  }

  if (stage === 'serper' || stage === 'all') {
    const skip = new Set<string>();
    const redirectPath = join(pass3Dir, 'domains_from_redirect.csv');
    if (existsSync(redirectPath)) {
      for (const r of readCsv(redirectPath)) {
        if (r.tier === 'high' || r.tier === 'medium') skip.add(r.ad_id);
      }
    }
    await discoverDomains({
      inputCsv: misses,
      outDir: pass3Dir,
      dryRun,
      maxRows,
      liveConfirmed: live,
      skipAdIds: skip,
    });
  }

  if (stage === 'confirm' || stage === 'all') {
    await confirmDomains({
      pass3Dir,
      dryRun,
      liveConfirmed: live,
      maxRows,
      maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 100),
      includeAcceptedMedium: true,
    });
  }

  if (stage === 'enrich' || stage === 'all') {
    await enrichPass3({
      pass1Dir,
      pass3Dir,
      dryRun,
      liveConfirmed: live,
      maxRows,
      maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 100),
      maxEnrichmentCredits: asNumber(args['max-enrichment-credits'], 80),
      maxProspeoCredits: asNumber(args['max-prospeo-credits'], 100),
    });
  }

  if (stage === 'merge' || stage === 'all') {
    if (!dryRun) mergePass3({ pass1Dir, pass3Dir });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
