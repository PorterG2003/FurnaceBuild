import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import {
  enrichPersonByName,
  type ApolloClientOptions,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { ensureEnv } from './env.js';
import { runApolloMissCohort } from './apolloMissCohort.js';
import { runProspeoCohort } from './prospeoCohort.js';

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

/**
 * Pass-3 contact enrich on Apollo-confirmed domains.
 * Named people: Apollo people/match first → Prospeo only on miss (capped).
 * Everyone else (and named Apollo misses without Prospeo hit): Apollo ICP fill.
 */
export async function enrichPass3(options: {
  pass1Dir: string;
  pass3Dir: string;
  dryRun?: boolean;
  liveConfirmed?: boolean;
  maxRows?: number | null;
  maxApolloOrgCalls?: number | null;
  maxEnrichmentCredits?: number | null;
  maxProspeoCredits?: number | null;
}): Promise<{ leads: number }> {
  const pass3Dir = ensureDir(options.pass3Dir);
  const confirmedPath = join(pass3Dir, 'domains_confirmed.csv');
  if (!existsSync(confirmedPath)) {
    if (options.dryRun) {
      console.log(
        JSON.stringify(
          { dry_run: true, confirmed: 0, note: 'No domains_confirmed.csv yet' },
          null,
          2,
        ),
      );
      return { leads: 0 };
    }
    throw new Error(`Missing ${confirmedPath}. Run confirm first.`);
  }

  const confirmed = readCsv(confirmedPath).filter((r) => r.status === 'confirmed');
  let rows = confirmed;
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  const named = rows.filter((r) => (r.person_name || '').trim());
  const unnamed = rows.filter((r) => !(r.person_name || '').trim());
  const maxProspeo = options.maxProspeoCredits ?? 100;

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          dry_run: true,
          confirmed: rows.length,
          named_apollo_then_prospeo: named.length,
          unnamed_apollo_icp: unnamed.length,
          max_prospeo_credits: maxProspeo,
          waterfall: 'named: Apollo people/match → Prospeo on miss; else Apollo ICP',
        },
        null,
        2,
      ),
    );
    return { leads: 0 };
  }

  if (!options.liveConfirmed) {
    throw new Error('Live enrich requires --live after spend OK.');
  }

  await ensureEnv({ apollo: true, prospeo: false });
  if (!process.env.APOLLO_API_KEY?.trim()) {
    throw new Error('APOLLO_API_KEY not available');
  }

  const counter = new CallCounter();
  const apolloOptions: ApolloClientOptions = { useFixtures: false, counter };
  const namedApolloPath = join(pass3Dir, '3_named_apollo_enriched.csv');
  const namedApolloColumns = [
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

  type NamedCheckpoint = {
    next_index: number;
    results: Record<string, string>[];
    matched: number;
    prospeo_queue: Record<string, string>[];
  };
  const namedCkPath = join(pass3Dir, '3_named_apollo_checkpoint.json');
  let namedCk = loadJson<NamedCheckpoint>(namedCkPath) ?? {
    next_index: 0,
    results: [],
    matched: 0,
    prospeo_queue: [],
  };

  for (let i = namedCk.next_index; i < named.length; i++) {
    const row = named[i]!;
    const domain = row.apollo_domain || row.discovered_domain;
    const { first, last } = splitName(row.person_name);
    console.error(
      `[3-named-apollo] ${i + 1}/${named.length} ${row.person_name} @ ${row.company_name}`,
    );

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
            domain,
          },
          apolloOptions,
        );
        email = person?.email?.trim() || '';
        title = person?.title?.trim() || '';
        linkedin = person?.linkedin_url?.trim() || '';
        if (email) {
          status = 'matched';
          namedCk.matched += 1;
        }
      } else {
        status = 'invalid_name';
      }
    } catch (e) {
      status = `error:${e instanceof Error ? e.message : String(e)}`;
    }

    const result = {
      ad_id: row.ad_id ?? '',
      platform: row.platform ?? '',
      company_name: row.company_name ?? '',
      company_domain: domain,
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
      pass3_stage: '3_named_apollo',
      ad_library_url: row.ad_library_url ?? '',
    };
    namedCk.results.push(result);
    if (!email) {
      namedCk.prospeo_queue.push({
        platform: row.platform,
        company_name: row.company_name,
        company_url: '',
        company_domain: domain,
        landing_url: '',
        landing_domain: domain,
        person_name: row.person_name,
        ad_library_url: row.ad_library_url,
        ad_id: row.ad_id,
      });
    }
    namedCk.next_index = i + 1;
    writeJson(namedCkPath, namedCk);
    writeCsv(namedApolloPath, namedCk.results, namedApolloColumns);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Prospeo waterfall for named Apollo misses only
  const prospeoQueuePath = join(pass3Dir, '3_named_prospeo_queue.csv');
  writeCsv(
    prospeoQueuePath,
    namedCk.prospeo_queue,
    [
      'platform',
      'company_name',
      'company_url',
      'company_domain',
      'landing_url',
      'landing_domain',
      'person_name',
      'ad_library_url',
      'ad_id',
    ],
  );

  if (namedCk.prospeo_queue.length > 0 && maxProspeo > 0) {
    await ensureEnv({ apollo: false, prospeo: true });
    await runProspeoCohort({
      inputCsv: prospeoQueuePath,
      outDir: pass3Dir,
      stage: '3_named_prospeo',
      mode: 'named_only',
      dryRun: false,
      maxRows: null,
      maxProspeoCredits: maxProspeo,
      liveConfirmed: true,
      pass1Dir: options.pass1Dir,
      pass2Dir: join(options.pass1Dir, 'pass2'),
      outputCsvName: '3_named_prospeo_enriched.csv',
    });
  }

  const haveEmailAds = new Set<string>();
  for (const path of [namedApolloPath, join(pass3Dir, '3_named_prospeo_enriched.csv')]) {
    if (!existsSync(path)) continue;
    for (const r of readCsv(path)) {
      if (r.contact_email) haveEmailAds.add(r.ad_id);
    }
  }

  // Apollo ICP for confirmed companies still without email (unnamed + named misses)
  const apolloRows = rows.filter((r) => !haveEmailAds.has(r.ad_id));
  const apolloDir = ensureDir(join(pass3Dir, '3_apollo'));
  writeCsv(
    join(apolloDir, 'companies.csv'),
    apolloRows.map((r) => ({
      company_name: r.company_name,
      company_domain: r.apollo_domain || r.discovered_domain,
      source_lists: `webinar-pass3|${r.ad_id}|${r.ad_library_url}`,
      person_name: r.person_name,
      ad_library_url: r.ad_library_url,
      ad_id: r.ad_id,
      platform: r.platform,
    })),
    [
      'company_name',
      'company_domain',
      'source_lists',
      'person_name',
      'ad_library_url',
      'ad_id',
      'platform',
    ],
  );

  const { leads } = await runApolloMissCohort({
    pass1Dir: options.pass1Dir,
    pass2Dir: pass3Dir,
    companiesCsv: join(apolloDir, 'companies.csv'),
    apolloSubdir: '3_apollo',
    outputCsvName: '3_apollo_enriched.csv',
    stage: '3_apollo',
    dryRun: false,
    maxRows: options.maxRows,
    maxApolloOrgCalls: options.maxApolloOrgCalls ?? 100,
    maxEnrichmentCredits: options.maxEnrichmentCredits ?? 120,
    liveConfirmed: true,
  });

  // Merge named apollo into a combined named file for mergePass3 (expects 3_named_enriched.csv)
  const combinedNamed: Record<string, string>[] = [...namedCk.results.filter((r) => r.contact_email)];
  const prospeoOut = join(pass3Dir, '3_named_prospeo_enriched.csv');
  if (existsSync(prospeoOut)) {
    for (const r of readCsv(prospeoOut)) {
      if (!r.contact_email) continue;
      combinedNamed.push({
        ...r,
        provider: 'prospeo',
        pass3_stage: '3_named_prospeo',
        contact_full_name: r.contact_full_name || r.person_name_source || '',
      });
    }
  }
  writeCsv(join(pass3Dir, '3_named_enriched.csv'), combinedNamed, [
    ...namedApolloColumns,
  ]);

  writeJson(join(pass3Dir, 'enrich_tally.json'), {
    confirmed_input: rows.length,
    named_total: named.length,
    named_apollo_matched: namedCk.matched,
    named_prospeo_queued: namedCk.prospeo_queue.length,
    max_prospeo_credits: maxProspeo,
    apollo_icp_leads: leads,
    apollo_people_calls: counter.counts.apollo_people_calls,
    waterfall: 'apollo_named → prospeo_named → apollo_icp',
  });

  return { leads: leads + combinedNamed.length };
}
