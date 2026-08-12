import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asNumber, outputDir, packageRoot, parseArgs } from './env.js';
import { confirmDomains } from './confirmDomains.js';
import { enrichPass3 } from './enrichPass3.js';
import { expandLandings } from './expandLandings.js';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';
import { companyKey } from './pass2Prep.js';
import { prepPass5 } from './pass5Prep.js';
import { mergePass7Discovered, prepPass7 } from './pass7Prep.js';
import { rehydrateLandings } from './rehydrateLandings.js';

function mergePass7(options: {
  pass1Dir: string;
  pass7Dir: string;
}): { prior: number; added: number; total: number } {
  const pass1Dir = options.pass1Dir;
  const pass7Dir = ensureDir(options.pass7Dir);
  const baseCandidates = [
    join(pass1Dir, 'pass5', 'enriched_leads.csv'),
    join(pass1Dir, 'pass6', 'enriched_leads.csv'),
    join(pass1Dir, 'pass4', 'enriched_leads.csv'),
    join(pass1Dir, 'enriched_leads.csv'),
  ];
  const basePath = baseCandidates.find((p) => existsSync(p));
  if (!basePath) throw new Error('No prior enriched_leads.csv found');

  const cols = [
    'platform',
    'provider',
    'company_name',
    'company_domain',
    'contact_email',
    'contact_full_name',
    'contact_first_name',
    'contact_last_name',
    'contact_title',
    'contact_linkedin',
    'company_linkedin',
    'person_name_source',
    'ad_library_url',
    'ad_id',
    'match_path',
    'contact_tier',
    'status',
    'pass2_stage',
    'pass3_stage',
  ];

  const byKey = new Map<string, Record<string, string>>();
  for (const row of readCsv(basePath)) {
    byKey.set(companyKey(row), { ...row });
  }
  const prior = [...byKey.values()].filter((r) => (r.contact_email || '').trim()).length;

  let added = 0;
  const enrichDir = join(pass7Dir, 'enrich');
  for (const file of ['3_apollo_enriched.csv', '3_named_enriched.csv']) {
    const path = join(enrichDir, file);
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (!(row.contact_email || '').trim()) continue;
      const normalized: Record<string, string> = {
        platform: row.platform ?? '',
        provider: row.provider || 'apollo',
        company_name: row.company_name ?? '',
        company_domain: row.company_domain ?? '',
        contact_email: row.contact_email ?? '',
        contact_full_name:
          row.contact_full_name ||
          [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' '),
        contact_first_name: row.contact_first_name ?? '',
        contact_last_name: row.contact_last_name ?? '',
        contact_title: row.contact_title ?? '',
        contact_linkedin: row.contact_linkedin ?? '',
        company_linkedin: row.company_linkedin ?? '',
        person_name_source: row.person_name_source ?? '',
        ad_library_url: row.ad_library_url ?? '',
        ad_id: row.ad_id ?? '',
        match_path: row.match_path ?? '',
        contact_tier: row.contact_tier ?? '',
        status: row.status || 'matched',
        pass2_stage: row.pass2_stage ?? '',
        pass3_stage: '7_embedded_links',
      };
      const k = companyKey(normalized);
      if (byKey.get(k)?.contact_email) continue;
      byKey.set(k, normalized);
      added += 1;
    }
  }

  const rows = [...byKey.values()];
  writeCsv(join(pass7Dir, 'enriched_leads.csv'), rows, cols);
  writeCsv(join(pass1Dir, 'enriched_leads_pass7.csv'), rows, cols);
  for (const sub of ['pass3', 'pass4', 'pass5', 'pass6']) {
    const dir = join(pass1Dir, sub);
    if (existsSync(dir)) writeCsv(join(dir, 'enriched_leads.csv'), rows, cols);
  }
  const total = rows.filter((r) => (r.contact_email || '').trim()).length;
  writeJson(join(pass7Dir, 'merge_tally.json'), {
    prior_with_email: prior,
    pass7_new_emails: added,
    total_with_email: total,
  });
  console.log(JSON.stringify({ enriched_leads: join(pass7Dir, 'enriched_leads.csv'), prior, added, total }, null, 2));
  return { prior, added, total };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const stage = typeof args.stage === 'string' ? args.stage : '';
  const dryRun = Boolean(args['dry-run']);
  const live = Boolean(args.live);
  const pass1Dir =
    typeof args['pass1-dir'] === 'string'
      ? args['pass1-dir']
      : join(outputDir, 'runs', 'pass1');
  const pass7Dir =
    typeof args['pass7-dir'] === 'string'
      ? args['pass7-dir']
      : join(pass1Dir, 'pass7');

  if (
    !['prep', 'rehydrate', 'expand', 'confirm', 'enrich', 'merge', 'all'].includes(stage)
  ) {
    console.error(
      'Usage: --stage prep|rehydrate|expand|confirm|enrich|merge|all [--dry-run|--live]',
    );
    process.exit(2);
  }

  if (['confirm', 'enrich'].includes(stage) && !dryRun && !live) {
    console.error('Pass --dry-run or --live for paid stages');
    process.exit(2);
  }

  ensureDir(pass7Dir);

  if (stage === 'prep' || stage === 'all') {
    // Ensure dark list is current
    prepPass5({
      pass1Dir,
      pass5Dir: join(pass1Dir, 'pass5'),
      packageRoot,
    });
    prepPass7({ pass1Dir, pass7Dir });
  }

  if (stage === 'rehydrate' || stage === 'all') {
    const input = join(pass7Dir, 'rehydrate_input.csv');
    if (!existsSync(input)) throw new Error(`Missing ${input}. Run prep first.`);
    await rehydrateLandings({
      inputCsv: input,
      outDir: pass7Dir,
      dryRun,
      maxRows: asNumber(args['max-rows'], null),
      headless: args.headless !== false && args.headless !== 'false',
    });
    // Re-bucket so recovered domains become copy_domain / expand
    if (!dryRun) {
      prepPass7({ pass1Dir, pass7Dir });
      mergePass7Discovered(pass7Dir);
    }
  }

  if (stage === 'expand' || stage === 'all') {
    const input = join(pass7Dir, 'expand_input.csv');
    if (!existsSync(input)) throw new Error(`Missing ${input}. Run prep/rehydrate first.`);
    await expandLandings({
      inputCsv: input,
      outDir: pass7Dir,
      dryRun,
      maxRows: asNumber(args['max-rows'], null),
    });
    if (!dryRun) mergePass7Discovered(pass7Dir);
  }

  if (stage === 'confirm' || stage === 'all') {
    if (stage === 'all' && !dryRun && !live) {
      console.log(
        JSON.stringify({
          stopped_before: 'confirm',
          reason: 'pass --live (or --dry-run) for Apollo confirm/enrich',
        }, null, 2),
      );
      return;
    }
    if (!dryRun && !live) {
      console.error('Pass --dry-run or --live for paid stages');
      process.exit(2);
    }
    mergePass7Discovered(pass7Dir);
    const discoveredPath = join(pass7Dir, 'domains_discovered.csv');
    if (!existsSync(discoveredPath)) {
      throw new Error('Missing domains_discovered.csv — run prep/rehydrate/expand first');
    }
    const discovered = readCsv(discoveredPath);
    const onlyHigh = new Set(
      discovered
        .filter((r) => (r.tier === 'high' || r.tier === 'medium') && r.discovered_domain)
        .map((r) => r.ad_id),
    );
    await confirmDomains({
      pass3Dir: pass7Dir,
      dryRun,
      liveConfirmed: live,
      includeAcceptedMedium: true,
      onlyAdIds: onlyHigh.size ? onlyHigh : undefined,
      maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 120),
      checkpointName: 'confirm_checkpoint.json',
      outputName: 'domains_confirmed.csv',
    });
  }

  if (stage === 'enrich' || (stage === 'all' && (live || dryRun))) {
    if (stage === 'enrich' && !dryRun && !live) {
      console.error('Pass --dry-run or --live for paid stages');
      process.exit(2);
    }
    const confirmedPath = join(pass7Dir, 'domains_confirmed.csv');
    if (!existsSync(confirmedPath) && !dryRun) {
      throw new Error('Missing domains_confirmed.csv — run confirm first');
    }
    const enrichDir = ensureDir(join(pass7Dir, 'enrich'));
    if (existsSync(confirmedPath)) {
      const confirmed = readCsv(confirmedPath).filter((r) => r.status === 'confirmed');
      writeCsv(
        join(enrichDir, 'domains_confirmed.csv'),
        confirmed,
        [
          'ad_id',
          'company_name',
          'platform',
          'person_name',
          'discovered_domain',
          'tier',
          'score',
          'apollo_org_id',
          'apollo_org_name',
          'apollo_domain',
          'status',
          'error',
          'ad_library_url',
        ],
      );
    }
    await enrichPass3({
      pass1Dir,
      pass3Dir: enrichDir,
      dryRun,
      liveConfirmed: live,
      maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 80),
      maxEnrichmentCredits: asNumber(args['max-enrichment-credits'], 80),
      maxProspeoCredits: asNumber(args['max-prospeo-credits'], 40),
    });
  }

  if (stage === 'merge' || (stage === 'all' && live && !dryRun)) {
    if (
      existsSync(join(pass7Dir, 'enrich', '3_apollo_enriched.csv')) ||
      existsSync(join(pass7Dir, 'enrich', '3_named_enriched.csv')) ||
      stage === 'merge'
    ) {
      mergePass7({ pass1Dir, pass7Dir });
      prepPass5({
        pass1Dir,
        pass5Dir: join(pass1Dir, 'pass5'),
        packageRoot,
      });
      console.log(JSON.stringify({ regen_pass5_worklist: true }, null, 2));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
