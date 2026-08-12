import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import {
  enrichPersonByLinkedIn,
  type ApolloClientOptions,
} from '../../webinar-hosts/src/stage3-enrich/apolloClient.js';
import { asNumber, ensureEnv, outputDir, packageRoot, parseArgs } from './env.js';
import { ensureDir, loadJson, readCsv, writeCsv, writeJson } from './io.js';
import { companyKey } from './pass2Prep.js';
import { normalizeLinkedInProfileUrl, prepPass5 } from './pass5Prep.js';
import { enrichPersonEmailOnly } from './prospeo.js';

type Submission = {
  ad_id: string;
  platform?: string;
  company_name?: string;
  company_domain?: string;
  person_name_hint?: string;
  ad_library_url?: string;
  linkedin_url: string;
  note?: string;
  status?: string;
};

type EnrichResult = Record<string, string>;

const RESULT_COLUMNS = [
  'ad_id',
  'platform',
  'company_name',
  'company_domain',
  'person_name_hint',
  'note',
  'linkedin_url',
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
  'error',
  'credits_this_row',
];

function loadSubmissions(path: string): Submission[] {
  if (!existsSync(path)) throw new Error(`Missing submissions file: ${path}`);
  if (path.endsWith('.csv')) {
    return readCsv(path)
      .map((r) => ({
        ad_id: r.ad_id,
        platform: r.platform,
        company_name: r.company_name,
        company_domain: r.company_domain,
        person_name_hint: r.person_name_hint || r.person_name || '',
        ad_library_url: r.ad_library_url,
        linkedin_url: r.linkedin_url,
        note: r.note,
        status: r.status || 'saved',
      }))
      .filter((r) => r.ad_id && r.linkedin_url);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    submissions?: Submission[];
  };
  const list = raw.submissions ?? (Array.isArray(raw) ? (raw as Submission[]) : []);
  return list.filter((r) => r.ad_id && (r.linkedin_url || '').trim() && (r.status ?? 'saved') === 'saved');
}

function splitHintName(hint: string): { first: string; last: string; full: string } {
  const full = hint.trim();
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '', full: '' };
  if (parts.length === 1) return { first: parts[0]!, last: '', full };
  return { first: parts[0]!, last: parts.slice(1).join(' '), full };
}

export async function enrichSubmissions(options: {
  pass5Dir: string;
  submissionsPath: string;
  dryRun?: boolean;
  liveConfirmed?: boolean;
  maxRows?: number | null;
  maxProspeoCredits?: number | null;
}): Promise<{ matched: number; path: string }> {
  const pass5Dir = ensureDir(options.pass5Dir);
  let rows = loadSubmissions(options.submissionsPath);
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  const outPath = join(pass5Dir, '5_linkedin_enriched.csv');
  const ckPath = join(pass5Dir, '5_linkedin_checkpoint.json');

  type Ck = {
    next_index: number;
    results: EnrichResult[];
    matched: number;
    apollo_calls: number;
    prospeo_credits: number;
    no_match: number;
  };
  let ck = loadJson<Ck>(ckPath) ?? {
    next_index: 0,
    results: [],
    matched: 0,
    apollo_calls: 0,
    prospeo_credits: 0,
    no_match: 0,
  };

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      submissions: rows.length,
      remaining: Math.max(0, rows.length - ck.next_index),
      waterfall: 'apollo linkedin match → prospeo linkedin enrich',
      max_prospeo_credits: options.maxProspeoCredits,
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(pass5Dir, '5_linkedin_dry_run.json'), estimate);
    return { matched: 0, path: outPath };
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
  let prospeoReady = false;

  for (let i = ck.next_index; i < rows.length; i++) {
    if (
      options.maxProspeoCredits != null &&
      ck.prospeo_credits >= options.maxProspeoCredits
    ) {
      // Still allow Apollo-only for remaining; only stop Prospeo. Continue Apollo.
    }

    const row = rows[i]!;
    const linkedinUrl = normalizeLinkedInProfileUrl(row.linkedin_url);
    console.error(
      `[5-linkedin] ${i + 1}/${rows.length} ${row.company_name || row.ad_id} ← ${linkedinUrl || row.linkedin_url}`,
    );

    const hint = splitHintName(row.note || row.person_name_hint || '');
    let email = '';
    let first = hint.first;
    let last = hint.last;
    let full = hint.full;
    let title = '';
    let provider = '';
    let matchPath = '';
    let status = 'no_match';
    let error = '';
    let credits = '0';

    if (!linkedinUrl) {
      status = 'invalid_linkedin_url';
      error = `Could not normalize: ${row.linkedin_url}`;
    } else {
      try {
        const person = await enrichPersonByLinkedIn(linkedinUrl, apolloOptions);
        ck.apollo_calls += 1;
        email = person?.email?.trim() || '';
        if (person?.first_name) first = person.first_name;
        if (person?.last_name) last = person.last_name;
        full = [first, last].filter(Boolean).join(' ') || full;
        title = person?.title?.trim() || '';
        if (email) {
          status = 'matched';
          provider = 'apollo';
          matchPath = 'apollo_linkedin_match';
          ck.matched += 1;
        }
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        status = 'apollo_error';
        ck.apollo_calls += 1;
      }

      const canProspeo =
        !email &&
        (options.maxProspeoCredits == null ||
          ck.prospeo_credits < options.maxProspeoCredits);

      if (canProspeo) {
        try {
          if (!prospeoReady) {
            await ensureEnv({ apollo: false, prospeo: true });
            if (!process.env.PROSPEO_API_KEY?.trim()) {
              throw new Error('PROSPEO_API_KEY not available');
            }
            prospeoReady = true;
          }
          const enrich = await enrichPersonEmailOnly({
            linkedinUrl,
            companyName: row.company_name,
            companyWebsite: row.company_domain
              ? `https://${row.company_domain}`
              : undefined,
            fullName: full || undefined,
            firstName: first || undefined,
            lastName: last || undefined,
          });
          ck.prospeo_credits += 1;
          credits = '1';
          const pe = enrich?.person?.email?.email?.trim() || '';
          if (pe) {
            email = pe;
            first = enrich?.person?.first_name?.trim() || first;
            last = enrich?.person?.last_name?.trim() || last;
            full =
              enrich?.person?.full_name?.trim() ||
              [first, last].filter(Boolean).join(' ') ||
              full;
            title = enrich?.person?.current_job_title?.trim() || title;
            status = 'matched';
            provider = 'prospeo';
            matchPath = 'prospeo_linkedin_enrich';
            error = '';
            ck.matched += 1;
          } else if (status !== 'apollo_error') {
            status = 'no_match';
            error = enrich?.error_code || 'PROSPEO_NO_EMAIL';
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          error = error ? `${error}; prospeo:${msg}` : `prospeo:${msg}`;
          if (status !== 'matched') status = 'prospeo_error';
          ck.prospeo_credits += 1;
          credits = '1';
        }
      }
    }

    if (!email && status === 'no_match') ck.no_match += 1;

    ck.results.push({
      ad_id: row.ad_id ?? '',
      platform: row.platform ?? '',
      company_name: row.company_name ?? '',
      company_domain: row.company_domain ?? '',
      person_name_hint: row.person_name_hint ?? '',
      note: row.note ?? '',
      linkedin_url: linkedinUrl || row.linkedin_url || '',
      contact_email: email,
      contact_first_name: first,
      contact_last_name: last,
      contact_full_name: full,
      contact_title: title,
      contact_linkedin: linkedinUrl || row.linkedin_url || '',
      match_path: matchPath,
      status,
      provider,
      pass3_stage: '5_manual_linkedin',
      ad_library_url: row.ad_library_url ?? '',
      error,
      credits_this_row: credits,
    });
    ck.next_index = i + 1;
    writeJson(ckPath, ck);
    writeCsv(outPath, ck.results, RESULT_COLUMNS);
    await new Promise((r) => setTimeout(r, 200));
  }

  writeJson(join(pass5Dir, '5_linkedin_spend_tally.json'), {
    submissions: rows.length,
    matched: ck.matched,
    no_match: ck.no_match,
    apollo_calls: ck.apollo_calls,
    apollo_people_calls_counter: counter.counts.apollo_people_calls,
    prospeo_credits: ck.prospeo_credits,
  });
  console.log(
    JSON.stringify(
      {
        done: true,
        matched: ck.matched,
        apollo_calls: ck.apollo_calls,
        prospeo_credits: ck.prospeo_credits,
      },
      null,
      2,
    ),
  );
  return { matched: ck.matched, path: outPath };
}

export function mergePass5(options: {
  pass1Dir: string;
  pass5Dir: string;
}): { prior: number; added: number; total: number; path: string } {
  const pass1Dir = options.pass1Dir;
  const pass5Dir = ensureDir(options.pass5Dir);
  const baseCandidates = [
    join(pass1Dir, 'pass7', 'enriched_leads.csv'),
    join(pass1Dir, 'pass5', 'enriched_leads.csv'),
    join(pass1Dir, 'pass6', 'enriched_leads.csv'),
    join(pass1Dir, 'pass4', 'enriched_leads.csv'),
    join(pass1Dir, 'pass3', 'enriched_leads.csv'),
    join(pass1Dir, 'enriched_leads_pass7.csv'),
    join(pass1Dir, 'enriched_leads_pass6.csv'),
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
    byKey.set(companyKey(row), {
      platform: row.platform ?? '',
      provider: row.provider ?? '',
      company_name: row.company_name ?? '',
      company_domain: row.company_domain ?? '',
      contact_email: row.contact_email ?? '',
      contact_full_name: row.contact_full_name ?? '',
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
      status: row.status ?? '',
      pass2_stage: row.pass2_stage ?? '',
      pass3_stage: row.pass3_stage ?? '',
    });
  }
  const prior = [...byKey.values()].filter((r) => r.contact_email).length;

  let added = 0;
  const enrichPath = join(pass5Dir, '5_linkedin_enriched.csv');
  if (existsSync(enrichPath)) {
    for (const row of readCsv(enrichPath)) {
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
        contact_linkedin: row.contact_linkedin || row.linkedin_url || '',
        company_linkedin: '',
        person_name_source: row.person_name_hint || row.note || '',
        ad_library_url: row.ad_library_url ?? '',
        ad_id: row.ad_id ?? '',
        match_path: row.match_path ?? '',
        contact_tier: '',
        status: row.status || 'matched',
        pass2_stage: '',
        pass3_stage: '5_manual_linkedin',
      };
      const k = companyKey(normalized);
      if (byKey.get(k)?.contact_email) continue;
      byKey.set(k, normalized);
      added += 1;
    }
  }

  const rows = [...byKey.values()];
  const outPath = join(pass5Dir, 'enriched_leads.csv');
  writeCsv(outPath, rows, cols);
  writeCsv(join(pass1Dir, 'enriched_leads_pass5.csv'), rows, cols);
  // Keep pass3/pass4 mirrors current for downstream tools
  writeCsv(join(pass1Dir, 'pass3', 'enriched_leads.csv'), rows, cols);
  if (existsSync(join(pass1Dir, 'pass4'))) {
    writeCsv(join(pass1Dir, 'pass4', 'enriched_leads.csv'), rows, cols);
  }
  const total = rows.filter((r) => r.contact_email).length;
  writeJson(join(pass5Dir, 'merge_tally.json'), {
    prior_with_email: prior,
    pass5_new_emails: added,
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
  const pass5Dir =
    typeof args['pass5-dir'] === 'string'
      ? args['pass5-dir']
      : join(pass1Dir, 'pass5');

  if (!['prep', 'enrich', 'merge', 'all'].includes(stage)) {
    console.error('Usage: --stage prep|enrich|merge|all [--dry-run|--live]');
    process.exit(2);
  }

  if ((stage === 'enrich' || stage === 'all') && stage !== 'prep') {
    if (stage === 'enrich' && !dryRun && !live) {
      console.error('Pass --dry-run or --live for enrich');
      process.exit(2);
    }
  }

  if (stage === 'prep' || stage === 'all') {
    const result = prepPass5({
      pass1Dir,
      pass5Dir,
      packageRoot,
    });
    console.log(
      JSON.stringify(
        {
          done: true,
          stage: 'prep',
          dark: result.dark,
          p1: result.p1,
          p2: result.p2,
          p3: result.p3,
          dropped_consumer: result.dropped_consumer,
          csv: result.csvPath,
          html: result.htmlPath,
        },
        null,
        2,
      ),
    );
  }

  if (stage === 'enrich' || stage === 'all') {
    if (stage === 'all' && !dryRun && !live) {
      console.error('For --stage all with enrich, pass --dry-run or --live');
      process.exit(2);
    }
    const submissionsPath =
      typeof args.submissions === 'string'
        ? args.submissions
        : join(pass5Dir, 'manual_linkedin_submissions.json');
    if (!existsSync(submissionsPath) && !dryRun) {
      console.error(
        `No submissions at ${submissionsPath}. Export from the worklist HTML first, or pass --submissions <path>.`,
      );
      if (stage === 'all') {
        console.error('Prep done. Skipping enrich until submissions exist.');
      } else {
        process.exit(2);
      }
    } else if (existsSync(submissionsPath) || dryRun) {
      // dry-run with missing file: estimate 0
      if (!existsSync(submissionsPath) && dryRun) {
        console.log(
          JSON.stringify(
            {
              dry_run: true,
              submissions: 0,
              note: `No file yet at ${submissionsPath}`,
            },
            null,
            2,
          ),
        );
      } else {
        await enrichSubmissions({
          pass5Dir,
          submissionsPath,
          dryRun,
          liveConfirmed: live,
          maxRows: asNumber(args['max-rows'], null),
          maxProspeoCredits: asNumber(args['max-prospeo-credits'], 40),
        });
      }
    }
  }

  if (stage === 'merge' || (stage === 'all' && live && !dryRun)) {
    if (existsSync(join(pass5Dir, '5_linkedin_enriched.csv'))) {
      mergePass5({ pass1Dir, pass5Dir });
    } else if (stage === 'merge') {
      throw new Error('Missing 5_linkedin_enriched.csv — run enrich first');
    }
  }
}

import { fileURLToPath } from 'node:url';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}