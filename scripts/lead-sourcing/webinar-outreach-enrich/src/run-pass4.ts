import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asNumber, outputDir, parseArgs } from './env.js';
import { confirmDomains } from './confirmDomains.js';
import { enrichPass3 } from './enrichPass3.js';
import { runProspeoCohort } from './prospeoCohort.js';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import {
  enrichPersonByName,
  type ApolloClientOptions,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { ensureEnv } from './env.js';
import {
  ensureDir,
  loadJson,
  readCsv,
  writeCsv,
  writeJson,
} from './io.js';
import { companyKey } from './pass2Prep.js';
import { mergePass3 } from './mergePass3.js';

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function loadAcceptedIds(pass3Dir: string): Set<string> {
  const path = join(pass3Dir, 'domains_review_accepted.json');
  if (!existsSync(path)) return new Set();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { accepted_ad_ids?: string[] };
  return new Set(raw.accepted_ad_ids ?? []);
}

function appendConfirmed(pass3Dir: string, mediumConfirmedPath: string): void {
  const mainPath = join(pass3Dir, 'domains_confirmed.csv');
  const cols = [
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
  ];
  const main = existsSync(mainPath) ? readCsv(mainPath) : [];
  const byId = new Map(main.map((r) => [r.ad_id, r]));
  for (const row of readCsv(mediumConfirmedPath)) {
    byId.set(row.ad_id, row);
  }
  writeCsv(mainPath, [...byId.values()], cols);
}

async function enrichNamedPass4(options: {
  pass4Dir: string;
  inputCsv: string;
  maxProspeoCredits: number;
  live: boolean;
  dryRun: boolean;
}): Promise<{ apolloMatched: number; prospeoMatched: number }> {
  const rows = readCsv(options.inputCsv).filter((r) => (r.person_name || '').trim());
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          stage: '4_named',
          rows: rows.length,
          waterfall: 'apollo people/match → prospeo named',
          max_prospeo_credits: options.maxProspeoCredits,
        },
        null,
        2,
      ),
    );
    return { apolloMatched: 0, prospeoMatched: 0 };
  }
  if (!options.live) throw new Error('Named enrich requires --live');

  await ensureEnv({ apollo: true, prospeo: false });
  const counter = new CallCounter();
  const apolloOptions: ApolloClientOptions = { useFixtures: false, counter };
  const outPath = join(options.pass4Dir, '4_named_apollo_enriched.csv');
  const ckPath = join(options.pass4Dir, '4_named_apollo_checkpoint.json');
  type Ck = {
    next_index: number;
    results: Record<string, string>[];
    matched: number;
    prospeo_queue: Record<string, string>[];
  };
  let ck = loadJson<Ck>(ckPath) ?? {
    next_index: 0,
    results: [],
    matched: 0,
    prospeo_queue: [],
  };
  const cols = [
    'ad_id',
    'platform',
    'company_name',
    'company_domain',
    'person_name_source',
    'contact_email',
    'contact_first_name',
    'contact_last_name',
    'contact_full_name',
    'contact_title',
    'contact_linkedin',
    'match_path',
    'status',
    'provider',
    'pass3_stage',
    'ad_library_url',
  ];

  for (let i = ck.next_index; i < rows.length; i++) {
    const row = rows[i]!;
    const { first, last } = splitName(row.person_name);
    const domain = row.company_domain || row.landing_domain;
    console.error(`[4-named-apollo] ${i + 1}/${rows.length} ${row.person_name} @ ${row.company_name}`);
    let email = '';
    let title = '';
    let linkedin = '';
    let status = 'no_match';
    try {
      if (first && last) {
        const person = await enrichPersonByName(
          {
            firstName: first,
            lastName: last,
            organizationName: row.company_name,
            domain: domain || undefined,
          },
          apolloOptions,
        );
        email = person?.email?.trim() || '';
        title = person?.title?.trim() || '';
        linkedin = person?.linkedin_url?.trim() || '';
        if (email) {
          status = 'matched';
          ck.matched += 1;
        }
      } else status = 'invalid_name';
    } catch (e) {
      status = `error:${e instanceof Error ? e.message : String(e)}`;
    }
    ck.results.push({
      ad_id: row.ad_id ?? '',
      platform: row.platform ?? '',
      company_name: row.company_name ?? '',
      company_domain: domain ?? '',
      person_name_source: row.person_name ?? '',
      contact_email: email,
      contact_first_name: first,
      contact_last_name: last,
      contact_full_name: row.person_name ?? '',
      contact_title: title,
      contact_linkedin: linkedin,
      match_path: 'apollo_named_match',
      status,
      provider: 'apollo',
      pass3_stage: '4_named_apollo',
      ad_library_url: row.ad_library_url ?? '',
    });
    if (!email) {
      ck.prospeo_queue.push({ ...row });
    }
    ck.next_index = i + 1;
    writeJson(ckPath, ck);
    writeCsv(outPath, ck.results, cols);
    await new Promise((r) => setTimeout(r, 200));
  }

  const queuePath = join(options.pass4Dir, '4_named_prospeo_queue.csv');
  writeCsv(queuePath, ck.prospeo_queue, [
    'platform',
    'company_name',
    'company_url',
    'company_domain',
    'landing_url',
    'landing_domain',
    'person_name',
    'ad_library_url',
    'ad_id',
  ]);

  let prospeoMatched = 0;
  if (ck.prospeo_queue.length > 0 && options.maxProspeoCredits > 0) {
    const { checkpoint } = await runProspeoCohort({
      inputCsv: queuePath,
      outDir: options.pass4Dir,
      stage: '4_named_prospeo',
      mode: 'named_only',
      dryRun: false,
      maxProspeoCredits: options.maxProspeoCredits,
      liveConfirmed: true,
      outputCsvName: '4_named_prospeo_enriched.csv',
    });
    prospeoMatched = checkpoint.matched;
  }

  const combined = [
    ...ck.results.filter((r) => r.contact_email),
    ...(existsSync(join(options.pass4Dir, '4_named_prospeo_enriched.csv'))
      ? readCsv(join(options.pass4Dir, '4_named_prospeo_enriched.csv')).filter(
          (r) => r.contact_email,
        )
      : []),
  ];
  writeCsv(join(options.pass4Dir, '4_named_enriched.csv'), combined, cols);
  return { apolloMatched: ck.matched, prospeoMatched };
}

function mergePass4IntoLeads(options: {
  pass1Dir: string;
  pass3Dir: string;
  pass4Dir: string;
}): { prior: number; added: number; total: number; path: string } {
  // Start from current pass3 merge, then fold pass4 files
  mergePass3({ pass1Dir: options.pass1Dir, pass3Dir: options.pass3Dir });
  const basePath = join(options.pass3Dir, 'enriched_leads.csv');
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
    byKey.set(companyKey(row), row);
  }
  const prior = [...byKey.values()].filter((r) => r.contact_email).length;
  let added = 0;
  const pass4Files = [
    '4_medium_apollo_enriched.csv',
    '4_prospeo_blanks_enriched.csv',
    '4_named_enriched.csv',
    '4_named_apollo_enriched.csv',
    '4_named_prospeo_enriched.csv',
  ];
  for (const file of pass4Files) {
    const path = join(options.pass4Dir, file);
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (!(row.contact_email || '').trim()) continue;
      const normalized: Record<string, string> = {
        platform: row.platform ?? '',
        provider: row.provider || 'apollo',
        company_name: row.company_name ?? '',
        company_domain: row.company_domain || row.prospeo_company_domain || '',
        contact_email: row.contact_email ?? '',
        contact_full_name:
          row.contact_full_name ||
          [row.contact_first_name, row.contact_last_name].filter(Boolean).join(' '),
        contact_first_name: row.contact_first_name ?? '',
        contact_last_name: row.contact_last_name ?? '',
        contact_title: row.contact_title ?? '',
        contact_linkedin: row.contact_linkedin ?? '',
        company_linkedin: row.company_linkedin ?? '',
        person_name_source: row.person_name_source ?? row.person_name ?? '',
        ad_library_url: row.ad_library_url ?? '',
        ad_id: row.ad_id ?? '',
        match_path: row.match_path ?? '',
        contact_tier: row.contact_tier ?? '',
        status: row.status || 'matched',
        pass2_stage: row.pass2_stage ?? '',
        pass3_stage: row.pass3_stage || file.replace('.csv', ''),
      };
      const k = companyKey(normalized);
      if (byKey.get(k)?.contact_email) continue;
      byKey.set(k, normalized);
      added += 1;
    }
  }
  const rows = [...byKey.values()];
  const outPath = join(options.pass4Dir, 'enriched_leads.csv');
  writeCsv(outPath, rows, cols);
  writeCsv(join(options.pass3Dir, 'enriched_leads.csv'), rows, cols);
  writeCsv(join(options.pass1Dir, 'enriched_leads_pass4.csv'), rows, cols);
  const total = rows.filter((r) => r.contact_email).length;
  writeJson(join(options.pass4Dir, 'merge_tally.json'), {
    prior_with_email: prior,
    pass4_new_emails: added,
    total_with_email: total,
  });
  console.log(JSON.stringify({ enriched_leads: outPath, prior, added, total }, null, 2));
  return { prior, added, total, path: outPath };
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
  const pass3Dir = join(pass1Dir, 'pass3');
  const pass4Dir = ensureDir(join(pass1Dir, 'pass4'));
  const maxProspeo = asNumber(args['max-prospeo-credits'], 100) ?? 100;

  if (!['mediums', 'blanks', 'named', 'merge', 'all'].includes(stage)) {
    console.error('Usage: --stage mediums|blanks|named|merge|all [--dry-run|--live]');
    process.exit(2);
  }
  if (stage !== 'merge' && !dryRun && !live) {
    console.error('Pass --dry-run or --live');
    process.exit(2);
  }

  if (stage === 'mediums' || stage === 'all') {
    const accepted = loadAcceptedIds(pass3Dir);
    console.error(`[pass4] confirming ${accepted.size} accepted mediums`);
    const mediumOutName = 'domains_confirmed_mediums.csv';
    // Write into pass4 via symlink-style relative from pass3: ../pass4/...
    await confirmDomains({
      pass3Dir,
      dryRun,
      liveConfirmed: live,
      includeAcceptedMedium: true,
      onlyAdIds: accepted,
      checkpointName: join('..', 'pass4', 'confirm_mediums_checkpoint.json'),
      outputName: join('..', 'pass4', mediumOutName),
      maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 40),
    });
    const written = join(pass4Dir, mediumOutName);
    if (!dryRun && existsSync(written)) {
      appendConfirmed(pass3Dir, written);
      const confirmed = readCsv(written).filter((r) => r.status === 'confirmed');
      console.error(`[pass4] mediums confirmed ${confirmed.length}/${readCsv(written).length}`);
      const enrichDir = ensureDir(join(pass4Dir, 'medium_enrich'));
      writeCsv(join(enrichDir, 'domains_confirmed.csv'), confirmed, [
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
      ]);
      await enrichPass3({
        pass1Dir,
        pass3Dir: enrichDir,
        dryRun: false,
        liveConfirmed: true,
        maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 40),
        maxEnrichmentCredits: asNumber(args['max-enrichment-credits'], 40),
        maxProspeoCredits: Math.min(20, maxProspeo),
      });
      if (existsSync(join(enrichDir, '3_apollo_enriched.csv'))) {
        const rows = readCsv(join(enrichDir, '3_apollo_enriched.csv'));
        writeCsv(
          join(pass4Dir, '4_medium_apollo_enriched.csv'),
          rows,
          rows[0] ? Object.keys(rows[0]) : ['platform', 'contact_email'],
        );
      }
      if (existsSync(join(enrichDir, '3_named_enriched.csv'))) {
        const rows = readCsv(join(enrichDir, '3_named_enriched.csv'));
        if (rows.length) {
          writeCsv(
            join(pass4Dir, '4_medium_named_enriched.csv'),
            rows,
            Object.keys(rows[0]!),
          );
        }
      }
    }
  }

  if (stage === 'blanks' || stage === 'all') {
    const blanks = join(pass4Dir, 'prospeo_confirmed_blanks.csv');
    if (!existsSync(blanks)) throw new Error(`Missing ${blanks}`);
    await runProspeoCohort({
      inputCsv: blanks,
      outDir: pass4Dir,
      stage: '4_prospeo_blanks',
      mode: 'company_only',
      dryRun,
      maxProspeoCredits: maxProspeo,
      liveConfirmed: live,
      pass1Dir,
      pass2Dir: join(pass1Dir, 'pass2'),
      outputCsvName: '4_prospeo_blanks_enriched.csv',
    });
  }

  if (stage === 'named' || stage === 'all') {
    const named = join(pass4Dir, 'named_people.csv');
    if (!existsSync(named)) throw new Error(`Missing ${named}`);
    // Filter junk names more aggressively for live
    const cleaned = readCsv(named).filter((r) => {
      const p = (r.person_name || '').trim();
      if (p.split(/\s+/).length < 2) return false;
      const junk = /^(psychic medium|west china|medicare get|michigan education|our free|their reactive|new york|peak rock)$/i;
      return !junk.test(p);
    });
    writeCsv(join(pass4Dir, 'named_people_clean.csv'), cleaned, [
      'platform',
      'company_name',
      'company_url',
      'company_domain',
      'landing_url',
      'landing_domain',
      'person_name',
      'ad_library_url',
      'ad_id',
    ]);
    const remainingProspeo = maxProspeo;
    await enrichNamedPass4({
      pass4Dir,
      inputCsv: join(pass4Dir, 'named_people_clean.csv'),
      maxProspeoCredits: remainingProspeo,
      live,
      dryRun,
    });
  }

  if (stage === 'merge' || stage === 'all') {
    if (!dryRun) mergePass4IntoLeads({ pass1Dir, pass3Dir, pass4Dir });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
