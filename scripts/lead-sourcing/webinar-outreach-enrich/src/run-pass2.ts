import { join } from 'node:path';
import { asNumber, outputDir, parseArgs } from './env.js';
import { prepPass2 } from './pass2Prep.js';
import { runProspeoCohort, type ProspeoMode } from './prospeoCohort.js';
import { runApolloMissCohort } from './apolloMissCohort.js';
import { existsSync } from 'node:fs';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stage = typeof args.stage === 'string' ? args.stage : '';
  const dryRun = Boolean(args['dry-run']);
  const live = Boolean(args.live);

  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass2Dir =
    typeof args['pass2-dir'] === 'string'
      ? args['pass2-dir']
      : join(pass1Dir, 'pass2');

  if (!dryRun && !live) {
    console.error('Pass --dry-run or --live (live requires prior spend OK).');
    process.exit(2);
  }

  if (!existsSync(join(pass2Dir, 'named_prospeo.csv'))) {
    prepPass2({ pass1Dir, pass2Dir });
  }

  const maxRows = asNumber(args['max-rows'], null);
  const maxProspeo = asNumber(args['max-prospeo-credits'], 200);
  const maxApolloOrg = asNumber(args['max-apollo-org-calls'], 80);
  const maxEnrich = asNumber(args['max-enrichment-credits'], 80);

  if (stage === '2a' || stage === 'all') {
    await runProspeoCohort({
      inputCsv: join(pass2Dir, 'named_prospeo.csv'),
      outDir: pass2Dir,
      stage: '2a',
      mode: 'named_only' satisfies ProspeoMode,
      dryRun,
      maxRows,
      maxProspeoCredits: maxProspeo,
      liveConfirmed: live,
      pass1Dir,
      pass2Dir,
      outputCsvName: '2a_named_enriched.csv',
    });
  }

  if (stage === '2b' || stage === 'all') {
    // Refresh manifests so 2B skips 2A hits
    if (!dryRun && live) prepPass2({ pass1Dir, pass2Dir });
    await runApolloMissCohort({
      pass1Dir,
      pass2Dir,
      stage: '2b',
      dryRun,
      maxRows,
      maxApolloOrgCalls: maxApolloOrg,
      maxEnrichmentCredits: maxEnrich,
      liveConfirmed: live,
    });
  }

  if (stage === '2c' || stage === 'all') {
    if (!dryRun && live) prepPass2({ pass1Dir, pass2Dir });
    await runProspeoCohort({
      inputCsv: join(pass2Dir, 'meta_gated_to_prospeo.csv'),
      outDir: pass2Dir,
      stage: '2c',
      mode: 'company_only',
      dryRun,
      maxRows,
      maxProspeoCredits: maxProspeo,
      liveConfirmed: live,
      pass1Dir,
      pass2Dir,
      outputCsvName: '2c_meta_gated_prospeo_enriched.csv',
    });
  }

  if (stage === '2d' || stage === 'all') {
    if (!dryRun && live) prepPass2({ pass1Dir, pass2Dir });
    await runProspeoCohort({
      inputCsv: join(pass2Dir, 'name_only.csv'),
      outDir: pass2Dir,
      stage: '2d',
      mode: 'auto', // named first when present, else company name search
      dryRun,
      maxRows,
      maxProspeoCredits: maxProspeo,
      liveConfirmed: live,
      pass1Dir,
      pass2Dir,
      outputCsvName: '2d_name_only_enriched.csv',
    });
  }

  if (!['2a', '2b', '2c', '2d', 'all'].includes(stage)) {
    console.error('Usage: --stage 2a|2b|2c|2d|all --dry-run|--live');
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
