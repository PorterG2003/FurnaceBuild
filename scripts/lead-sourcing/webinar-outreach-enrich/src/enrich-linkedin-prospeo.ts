import { join } from 'node:path';
import {
  ensureDir,
  loadJson,
  readCsv,
  writeCsv,
  writeJson,
} from './io.js';
import { asNumber, ensureEnv, outputDir, parseArgs } from './env.js';
import { prepCohorts } from './cohortPrep.js';
import {
  companySearchFilters,
  enrichPersonEmailOnly,
  searchPerson,
  type ProspeoEnrichResponse,
} from './prospeo.js';
import type { CohortCompany } from './types.js';
import { toCohortCompany } from './types.js';

export type LinkedInResultRow = Record<string, string>;

export type LinkedInCheckpoint = {
  next_index: number;
  attempted: number;
  matched: number;
  no_match: number;
  credits_spent: number;
  search_calls: number;
  enrich_calls: number;
  results: LinkedInResultRow[];
};

const RESULT_COLUMNS = [
  'company_name',
  'company_domain',
  'company_url',
  'ad_library_url',
  'ad_id',
  'person_name_source',
  'contact_full_name',
  'contact_title',
  'contact_email',
  'contact_linkedin',
  'prospeo_company_domain',
  'prospeo_company_website',
  'match_path',
  'status',
  'error',
  'credits_this_row',
];

function emptyCheckpoint(): LinkedInCheckpoint {
  return {
    next_index: 0,
    attempted: 0,
    matched: 0,
    no_match: 0,
    credits_spent: 0,
    search_calls: 0,
    enrich_calls: 0,
    results: [],
  };
}

function rowFromEnrich(
  company: CohortCompany,
  enrich: ProspeoEnrichResponse,
  matchPath: string,
  credits: number,
): LinkedInResultRow {
  const person = enrich.person;
  const companyData = enrich.company;
  return {
    company_name: company.company_name,
    company_domain: company.company_domain,
    company_url: company.company_url,
    ad_library_url: company.ad_library_url,
    ad_id: company.ad_id,
    person_name_source: company.person_name,
    contact_full_name: person?.full_name ?? '',
    contact_title: person?.current_job_title ?? '',
    contact_email: person?.email?.email ?? '',
    contact_linkedin: person?.linkedin_url ?? '',
    prospeo_company_domain: companyData?.domain ?? '',
    prospeo_company_website: companyData?.website ?? '',
    match_path: matchPath,
    status: person?.email?.email ? 'matched' : 'matched_no_email',
    error: '',
    credits_this_row: String(credits),
  };
}

function missRow(company: CohortCompany, matchPath: string, error: string, credits: number): LinkedInResultRow {
  return {
    company_name: company.company_name,
    company_domain: company.company_domain,
    company_url: company.company_url,
    ad_library_url: company.ad_library_url,
    ad_id: company.ad_id,
    person_name_source: company.person_name,
    contact_full_name: '',
    contact_title: '',
    contact_email: '',
    contact_linkedin: '',
    prospeo_company_domain: '',
    prospeo_company_website: '',
    match_path: matchPath,
    status: 'no_match',
    error,
    credits_this_row: String(credits),
  };
}

async function enrichNamed(company: CohortCompany): Promise<{
  row: LinkedInResultRow;
  credits: number;
  enrichCalls: number;
}> {
  const website = company.company_domain
    ? `https://${company.company_domain}`
    : undefined;
  const linkedin = company.has_company_linkedin ? company.company_url : undefined;
  const enrich = await enrichPersonEmailOnly({
    fullName: company.person_name,
    companyName: company.company_name,
    companyWebsite: website ?? company.company_domain ?? null,
    companyLinkedinUrl: linkedin ?? null,
  });
  if (!enrich?.person) {
    return {
      row: missRow(company, 'named_enrich', 'NO_MATCH', 0),
      credits: 0,
      enrichCalls: 1,
    };
  }
  const charged = enrich.free_enrichment ? 0 : enrich.person.email?.email ? 1 : 0;
  return {
    row: rowFromEnrich(company, enrich, 'named_enrich', charged),
    credits: charged,
    enrichCalls: 1,
  };
}

async function enrichCompanyPath(company: CohortCompany): Promise<{
  row: LinkedInResultRow;
  credits: number;
  searchCalls: number;
  enrichCalls: number;
}> {
  const website = company.company_domain || undefined;
  const name = company.company_name || undefined;
  if (!website && !name) {
    return {
      row: missRow(company, 'company_path', 'no_company_identifier', 0),
      credits: 0,
      searchCalls: 0,
      enrichCalls: 0,
    };
  }

  let searchCalls = 0;
  let credits = 0;
  let personId: string | undefined;

  for (const mode of ['founder', 'marketing'] as const) {
    const filters = companySearchFilters({
      website,
      companyName: website ? undefined : name,
      mode,
    });
    const search = await searchPerson(filters);
    searchCalls += 1;
    if (search?.results?.length) {
      if (!search.free) credits += 1;
      personId = search.results[0]?.person?.person_id ?? undefined;
      if (personId) break;
    }
  }

  if (!personId) {
    return {
      row: missRow(company, 'company_path', 'NO_RESULTS', credits),
      credits,
      searchCalls,
      enrichCalls: 0,
    };
  }

  const enrich = await enrichPersonEmailOnly({ personId });
  const enrichCalls = 1;
  if (!enrich?.person) {
    return {
      row: missRow(company, 'company_path', 'ENRICH_NO_MATCH', credits),
      credits,
      searchCalls,
      enrichCalls,
    };
  }
  const charged = enrich.free_enrichment ? 0 : enrich.person.email?.email ? 1 : 0;
  credits += charged;
  return {
    row: rowFromEnrich(company, enrich, 'company_path', credits),
    credits,
    searchCalls,
    enrichCalls,
  };
}

export async function enrichLinkedInProspeo(options: {
  runDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  maxProspeoCredits?: number | null;
  liveConfirmed?: boolean;
  retryRateLimits?: boolean;
}): Promise<{ checkpoint: LinkedInCheckpoint; path: string }> {
  const runDir = ensureDir(options.runDir);
  const cohortPath = join(runDir, 'linkedin_cohort.csv');
  let companies = readCsv(cohortPath).map((row) =>
    toCohortCompany({
      platform: row.platform ?? 'linkedin',
      company_name: row.company_name ?? '',
      company_url: row.company_url ?? '',
      landing_url: row.landing_url ?? '',
      landing_domain: row.landing_domain ?? row.company_domain ?? '',
      person_name: row.person_name ?? '',
      ad_library_url: row.ad_library_url ?? '',
      ad_id: row.ad_id ?? '',
      ad_headline: '',
      ad_copy: '',
      ad_active_from: '',
      phrases_found: row.phrases_found ?? '',
      qualifying_ad_count: '',
      source_runs: row.source_runs ?? '',
    }),
  );

  if (options.maxRows != null) {
    companies = companies.slice(0, options.maxRows);
  }

  const named = companies.filter((c) => c.has_person_name).length;
  const companyPath = companies.length - named;

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      companies: companies.length,
      named_enrich_attempts: named,
      company_search_attempts_max: companyPath * 2,
      company_enrich_attempts_max: companyPath,
      estimated_credits_worst: named + companyPath * 3,
      max_prospeo_credits: options.maxProspeoCredits,
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'linkedin_dry_run.json'), estimate);
    return { checkpoint: emptyCheckpoint(), path: join(runDir, 'linkedin_enriched.csv') };
  }

  if (!options.liveConfirmed) {
    throw new Error(
      'Live Prospeo spend requires --live and explicit spend confirmation. Re-run after OK with --live.',
    );
  }

  await ensureEnv({ apollo: false, prospeo: true });
  if (!process.env.PROSPEO_API_KEY?.trim()) {
    throw new Error('PROSPEO_API_KEY not available (env or Amplify SSM)');
  }

  const checkpointPath = join(runDir, 'linkedin_checkpoint.json');
  let checkpoint = loadJson<LinkedInCheckpoint>(checkpointPath) ?? emptyCheckpoint();

  const processOne = async (company: CohortCompany): Promise<{
    row: LinkedInResultRow;
    credits: number;
    searchCalls: number;
    enrichCalls: number;
  }> => {
    if (company.has_person_name) {
      const result = await enrichNamed(company);
      return {
        row: result.row,
        credits: result.credits,
        searchCalls: 0,
        enrichCalls: result.enrichCalls,
      };
    }
    const result = await enrichCompanyPath(company);
    return {
      row: result.row,
      credits: result.credits,
      searchCalls: result.searchCalls,
      enrichCalls: result.enrichCalls,
    };
  };

  if (options.retryRateLimits) {
    const byName = new Map(companies.map((c) => [c.company_name, c] as const));
    for (let i = 0; i < checkpoint.results.length; i++) {
      const prev = checkpoint.results[i]!;
      if (!/rate limit/i.test(prev.error || '')) continue;
      if (
        options.maxProspeoCredits != null &&
        checkpoint.credits_spent >= options.maxProspeoCredits
      ) {
        break;
      }
      const company = byName.get(prev.company_name);
      if (!company) continue;
      console.error(`[linkedin-prospeo] retry rate-limit ${company.company_name}`);
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const result = await processOne(company);
        const wasMatch = prev.status.startsWith('matched');
        const nowMatch = result.row.status.startsWith('matched');
        if (!wasMatch && nowMatch) {
          checkpoint.matched += 1;
          checkpoint.no_match = Math.max(0, checkpoint.no_match - 1);
        }
        checkpoint.credits_spent += result.credits;
        checkpoint.search_calls += result.searchCalls;
        checkpoint.enrich_calls += result.enrichCalls;
        checkpoint.results[i] = result.row;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checkpoint.results[i] = missRow(company, 'error', message, 0);
        console.error(`[linkedin-prospeo] retry error: ${message}`);
      }
      writeJson(checkpointPath, checkpoint);
      writeCsv(join(runDir, 'linkedin_enriched.csv'), checkpoint.results, RESULT_COLUMNS);
    }
  } else {
    for (let i = checkpoint.next_index; i < companies.length; i++) {
      if (
        options.maxProspeoCredits != null &&
        checkpoint.credits_spent >= options.maxProspeoCredits
      ) {
        console.error(
          `[linkedin-prospeo] hit max credits ${checkpoint.credits_spent} at ${i}/${companies.length}`,
        );
        break;
      }

      const company = companies[i]!;
      console.error(
        `[linkedin-prospeo] ${i + 1}/${companies.length} ${company.company_name} (${company.has_person_name ? 'named' : 'company'})`,
      );

      try {
        const result = await processOne(company);
        checkpoint.results.push(result.row);
        checkpoint.credits_spent += result.credits;
        checkpoint.search_calls += result.searchCalls;
        checkpoint.enrich_calls += result.enrichCalls;
        if (result.row.status.startsWith('matched')) checkpoint.matched += 1;
        else checkpoint.no_match += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checkpoint.results.push(missRow(company, 'error', message, 0));
        checkpoint.no_match += 1;
        console.error(`[linkedin-prospeo] error: ${message}`);
        if (/rate limit/i.test(message)) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      checkpoint.attempted += 1;
      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      writeCsv(join(runDir, 'linkedin_enriched.csv'), checkpoint.results, RESULT_COLUMNS);

      await new Promise((r) => setTimeout(r, 800));
    }
  }

  writeCsv(join(runDir, 'linkedin_enriched.csv'), checkpoint.results, RESULT_COLUMNS);
  writeJson(join(runDir, 'linkedin_spend_tally.json'), {
    attempted: checkpoint.attempted,
    matched: checkpoint.matched,
    no_match: checkpoint.no_match,
    credits_spent: checkpoint.credits_spent,
    search_calls: checkpoint.search_calls,
    enrich_calls: checkpoint.enrich_calls,
  });

  console.log(
    JSON.stringify(
      {
        done: true,
        attempted: checkpoint.attempted,
        matched: checkpoint.matched,
        no_match: checkpoint.no_match,
        credits_spent: checkpoint.credits_spent,
      },
      null,
      2,
    ),
  );

  return { checkpoint, path: join(runDir, 'linkedin_enriched.csv') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const runDir =
    typeof args['run-dir'] === 'string'
      ? args['run-dir']
      : join(outputDir, 'runs', 'latest');
  const dryRun = Boolean(args['dry-run']);
  const live = Boolean(args.live);

  if (!dryRun && !live) {
    console.error('Pass --dry-run or --live (live requires prior spend OK).');
    process.exit(2);
  }

  // Ensure cohort exists
  const cohortPath = join(runDir, 'linkedin_cohort.csv');
  const { existsSync } = await import('node:fs');
  if (!existsSync(cohortPath)) {
    const { defaultOutreachCsv } = await import('./env.js');
    prepCohorts({ inputCsv: defaultOutreachCsv(), runDir });
  }

  await enrichLinkedInProspeo({
    runDir,
    dryRun,
    maxRows: asNumber(args['max-rows'], null),
    maxProspeoCredits: asNumber(args['max-prospeo-credits'], 120),
    liveConfirmed: live,
    retryRateLimits: Boolean(args['retry-rate-limits']),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
