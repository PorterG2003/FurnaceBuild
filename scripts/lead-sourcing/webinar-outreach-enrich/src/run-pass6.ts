import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { asNumber, outputDir, packageRoot, parseArgs } from './env.js';
import { confirmDomains } from './confirmDomains.js';
import { discoverDomains } from './discoverDomains.js';
import { enrichPass3 } from './enrichPass3.js';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { companyKey } from './pass2Prep.js';
import { prepPass5 } from './pass5Prep.js';
import { prepPass6 } from './pass6Prep.js';

function mergeDiscovered(pass6Dir: string): void {
  const cols = [
    'ad_id',
    'company_name',
    'platform',
    'person_name',
    'discovered_domain',
    'score',
    'tier',
    'reasons',
    'query',
    'status',
    'error',
    'ad_library_url',
    'best_company_query',
  ];
  const byId = new Map<string, Record<string, string>>();
  for (const file of ['copy_domain_discovered.csv', 'domains_discovered.csv']) {
    const path = join(pass6Dir, file);
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (!row.ad_id) continue;
      // Prefer existing high over later low
      const prev = byId.get(row.ad_id);
      if (!prev) {
        byId.set(row.ad_id, row);
        continue;
      }
      const rank = (t: string) => (t === 'high' ? 2 : t === 'medium' ? 1 : 0);
      if (rank(row.tier) >= rank(prev.tier || '')) byId.set(row.ad_id, row);
    }
  }
  writeCsv(join(pass6Dir, 'domains_discovered.csv'), [...byId.values()], cols);
}

function mergePass6(options: {
  pass1Dir: string;
  pass6Dir: string;
}): { prior: number; added: number; total: number } {
  const pass1Dir = options.pass1Dir;
  const pass6Dir = ensureDir(options.pass6Dir);
  const baseCandidates = [
    join(pass1Dir, 'pass5', 'enriched_leads.csv'),
    join(pass1Dir, 'pass4', 'enriched_leads.csv'),
    join(pass1Dir, 'pass3', 'enriched_leads.csv'),
    join(pass1Dir, 'enriched_leads_pass5.csv'),
    join(pass1Dir, 'enriched_leads_pass4.csv'),
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
  const enrichDir = join(pass6Dir, 'enrich');
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
        pass3_stage: '6_ad_copy',
      };
      const k = companyKey(normalized);
      if (byKey.get(k)?.contact_email) continue;
      byKey.set(k, normalized);
      added += 1;
    }
  }

  const rows = [...byKey.values()];
  const outPath = join(pass6Dir, 'enriched_leads.csv');
  writeCsv(outPath, rows, cols);
  writeCsv(join(pass1Dir, 'enriched_leads_pass6.csv'), rows, cols);
  for (const sub of ['pass3', 'pass4', 'pass5']) {
    const dir = join(pass1Dir, sub);
    if (existsSync(dir)) writeCsv(join(dir, 'enriched_leads.csv'), rows, cols);
  }
  const total = rows.filter((r) => (r.contact_email || '').trim()).length;
  writeJson(join(pass6Dir, 'merge_tally.json'), {
    prior_with_email: prior,
    pass6_new_emails: added,
    total_with_email: total,
  });
  console.log(JSON.stringify({ enriched_leads: outPath, prior, added, total }, null, 2));
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
  const pass6Dir =
    typeof args['pass6-dir'] === 'string'
      ? args['pass6-dir']
      : join(pass1Dir, 'pass6');

  if (!['prep', 'serper', 'confirm', 'enrich', 'merge', 'all'].includes(stage)) {
    console.error('Usage: --stage prep|serper|confirm|enrich|merge|all [--dry-run|--live]');
    process.exit(2);
  }

  if (['serper', 'confirm', 'enrich'].includes(stage) || stage === 'all') {
    if (stage !== 'prep' && stage !== 'merge' && !dryRun && !live) {
      console.error('Pass --dry-run or --live for paid stages');
      process.exit(2);
    }
  }

  ensureDir(pass6Dir);

  if (stage === 'prep' || stage === 'all') {
    prepPass6({ pass1Dir, pass6Dir, packageRoot });
  }

  if (stage === 'serper' || stage === 'all') {
    const input = join(pass6Dir, 'serper_input.csv');
    if (!existsSync(input)) throw new Error(`Missing ${input}. Run prep first.`);
    // Write serper results to pass6 domains_discovered (may overwrite; merge after)
    const serperOutDir = ensureDir(join(pass6Dir, 'serper'));
    await discoverDomains({
      inputCsv: input,
      outDir: serperOutDir,
      dryRun,
      liveConfirmed: live,
      maxRows: asNumber(args['max-rows'], null),
    });
    if (!dryRun && existsSync(join(serperOutDir, 'domains_discovered.csv'))) {
      copyFileSync(
        join(serperOutDir, 'domains_discovered.csv'),
        join(pass6Dir, 'domains_discovered_serper.csv'),
      );
      // Merge into domains_discovered alongside copy_domain
      const serperRows = readCsv(join(serperOutDir, 'domains_discovered.csv'));
      writeCsv(
        join(pass6Dir, 'domains_discovered.csv'),
        serperRows,
        Object.keys(serperRows[0] ?? {
          ad_id: '',
          company_name: '',
          platform: '',
          person_name: '',
          discovered_domain: '',
          score: '',
          tier: '',
          reasons: '',
          query: '',
          status: '',
          error: '',
          ad_library_url: '',
          best_company_query: '',
        }),
      );
      mergeDiscovered(pass6Dir);
    }
  }

  if (stage === 'confirm' || stage === 'all') {
    // Ensure copy domains are in domains_discovered
    if (existsSync(join(pass6Dir, 'copy_domain_discovered.csv'))) {
      mergeDiscovered(pass6Dir);
    }
    const discovered = existsSync(join(pass6Dir, 'domains_discovered.csv'))
      ? readCsv(join(pass6Dir, 'domains_discovered.csv'))
      : [];
    // Attach best_company_query from prep buckets
    const queryByAd = new Map<string, string>();
    for (const file of ['copy_domain.csv', 'serper_retry.csv']) {
      const path = join(pass6Dir, file);
      if (!existsSync(path)) continue;
      for (const r of readCsv(path)) {
        if (r.ad_id) queryByAd.set(r.ad_id, r.best_company_query || r.company_name);
      }
    }
    const withQuery = discovered.map((r) => ({
      ...r,
      best_company_query: r.best_company_query || queryByAd.get(r.ad_id) || r.company_name,
      tier: r.tier === 'medium' ? r.tier : r.tier || 'high',
    }));
    // Auto-promote copy_domain reasons to high; keep serper tiers
    writeCsv(
      join(pass6Dir, 'domains_discovered.csv'),
      withQuery.map((r) =>
        r.reasons === 'ad_copy_url' ? { ...r, tier: 'high', score: r.score || '0.95' } : r,
      ),
      [
        'ad_id',
        'company_name',
        'platform',
        'person_name',
        'discovered_domain',
        'score',
        'tier',
        'reasons',
        'query',
        'status',
        'error',
        'ad_library_url',
        'best_company_query',
      ],
    );

    const onlyHigh = new Set(
      readCsv(join(pass6Dir, 'domains_discovered.csv'))
        .filter((r) => r.tier === 'high' && r.discovered_domain)
        .map((r) => r.ad_id),
    );

    await confirmDomains({
      pass3Dir: pass6Dir,
      dryRun,
      liveConfirmed: live,
      includeAcceptedMedium: false,
      onlyAdIds: onlyHigh.size ? onlyHigh : undefined,
      maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 120),
      checkpointName: 'confirm_checkpoint.json',
      outputName: 'domains_confirmed.csv',
    });
  }

  if (stage === 'enrich' || stage === 'all') {
    const confirmedPath = join(pass6Dir, 'domains_confirmed.csv');
    if (!existsSync(confirmedPath) && !dryRun) {
      throw new Error('Missing domains_confirmed.csv — run confirm first');
    }
    const enrichDir = ensureDir(join(pass6Dir, 'enrich'));
    if (existsSync(confirmedPath)) {
      const confirmed = readCsv(confirmedPath).filter((r) => r.status === 'confirmed');
      // Carry person_name + best_company_query onto enrich rows
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
    if (existsSync(join(pass6Dir, 'enrich', '3_apollo_enriched.csv')) || stage === 'merge') {
      mergePass6({ pass1Dir, pass6Dir });
      // Regen pass5 worklist against new have-email set
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
