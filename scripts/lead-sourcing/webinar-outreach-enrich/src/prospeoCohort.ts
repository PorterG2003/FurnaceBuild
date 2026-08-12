import { join } from 'node:path';
import {
  ensureDir,
  loadJson,
  readCsv,
  writeCsv,
  writeJson,
} from './io.js';
import { ensureEnv } from './env.js';
import {
  companySearchFilters,
  enrichPersonEmailOnly,
  searchPerson,
  type ProspeoEnrichResponse,
} from './prospeo.js';
import type { CohortCompany } from './types.js';
import { toCohortCompany } from './types.js';
import { companyKey, loadHaveEmailKeys } from './pass2Prep.js';

export type ProspeoResultRow = Record<string, string>;

export type ProspeoCheckpoint = {
  next_index: number;
  attempted: number;
  matched: number;
  no_match: number;
  credits_spent: number;
  search_calls: number;
  enrich_calls: number;
  skipped_have_email: number;
  results: ProspeoResultRow[];
};

export const PROSPEO_RESULT_COLUMNS = [
  'platform',
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
  'provider',
  'pass2_stage',
];

function emptyCheckpoint(): ProspeoCheckpoint {
  return {
    next_index: 0,
    attempted: 0,
    matched: 0,
    no_match: 0,
    credits_spent: 0,
    search_calls: 0,
    enrich_calls: 0,
    skipped_have_email: 0,
    results: [],
  };
}

function toCompany(row: Record<string, string>): CohortCompany {
  return toCohortCompany({
    platform: row.platform ?? '',
    company_name: row.company_name ?? '',
    company_url: row.company_url ?? '',
    landing_url: row.landing_url ?? '',
    landing_domain: row.landing_domain || row.company_domain || '',
    person_name: row.person_name || row.person_name_source || '',
    ad_library_url: row.ad_library_url ?? '',
    ad_id: row.ad_id ?? '',
    ad_headline: '',
    ad_copy: '',
    ad_active_from: '',
    phrases_found: '',
    qualifying_ad_count: '',
    source_runs: '',
  });
}

function rowFromEnrich(
  company: CohortCompany,
  enrich: ProspeoEnrichResponse,
  matchPath: string,
  credits: number,
  stage: string,
): ProspeoResultRow {
  const person = enrich.person;
  const companyData = enrich.company;
  return {
    platform: company.platform,
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
    provider: 'prospeo',
    pass2_stage: stage,
  };
}

function missRow(
  company: CohortCompany,
  matchPath: string,
  error: string,
  credits: number,
  stage: string,
): ProspeoResultRow {
  return {
    platform: company.platform,
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
    provider: 'prospeo',
    pass2_stage: stage,
  };
}

async function enrichNamed(company: CohortCompany, stage: string) {
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
      row: missRow(company, 'named_enrich', 'NO_MATCH', 0, stage),
      credits: 0,
      enrichCalls: 1,
      searchCalls: 0,
    };
  }
  const charged = enrich.free_enrichment ? 0 : enrich.person.email?.email ? 1 : 0;
  return {
    row: rowFromEnrich(company, enrich, 'named_enrich', charged, stage),
    credits: charged,
    enrichCalls: 1,
    searchCalls: 0,
  };
}

async function enrichCompanyPath(company: CohortCompany, stage: string) {
  const website = company.company_domain || undefined;
  const name = company.company_name || undefined;
  if (!website && !name) {
    return {
      row: missRow(company, 'company_path', 'no_company_identifier', 0, stage),
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
      row: missRow(company, 'company_path', 'NO_RESULTS', credits, stage),
      credits,
      searchCalls,
      enrichCalls: 0,
    };
  }

  const enrich = await enrichPersonEmailOnly({ personId });
  if (!enrich?.person) {
    return {
      row: missRow(company, 'company_path', 'ENRICH_NO_MATCH', credits, stage),
      credits,
      searchCalls,
      enrichCalls: 1,
    };
  }
  const charged = enrich.free_enrichment ? 0 : enrich.person.email?.email ? 1 : 0;
  credits += charged;
  return {
    row: rowFromEnrich(company, enrich, 'company_path', credits, stage),
    credits,
    searchCalls,
    enrichCalls: 1,
  };
}

export type ProspeoMode = 'named_only' | 'company_only' | 'auto';

export async function runProspeoCohort(options: {
  inputCsv: string;
  outDir: string;
  stage: string;
  mode: ProspeoMode;
  dryRun?: boolean;
  maxRows?: number | null;
  maxProspeoCredits?: number | null;
  liveConfirmed?: boolean;
  pass1Dir?: string;
  pass2Dir?: string;
  outputCsvName?: string;
}): Promise<{ checkpoint: ProspeoCheckpoint; path: string }> {
  const outDir = ensureDir(options.outDir);
  const outputCsvName = options.outputCsvName ?? `${options.stage}_enriched.csv`;
  const outPath = join(outDir, outputCsvName);
  const checkpointPath = join(outDir, `${options.stage}_checkpoint.json`);

  let rows = readCsv(options.inputCsv);
  if (options.maxRows != null) rows = rows.slice(0, options.maxRows);

  const haveEmail =
    options.pass1Dir != null
      ? loadHaveEmailKeys(
          options.pass1Dir,
          options.pass2Dir,
          join(options.pass1Dir, 'pass3'),
        )
      : new Set<string>();

  const named = rows.filter((r) => (r.person_name || r.person_name_source || '').trim()).length;
  const companyPath = rows.length - named;

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      stage: options.stage,
      mode: options.mode,
      rows: rows.length,
      named_rows: named,
      company_path_rows: companyPath,
      estimated_credits_worst:
        options.mode === 'named_only'
          ? named
          : options.mode === 'company_only'
            ? companyPath * 3
            : named + companyPath * 3,
      max_prospeo_credits: options.maxProspeoCredits,
      already_have_email_keys: haveEmail.size,
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(outDir, `${options.stage}_dry_run.json`), estimate);
    return { checkpoint: emptyCheckpoint(), path: outPath };
  }

  if (!options.liveConfirmed) {
    throw new Error('Live Prospeo spend requires --live after explicit spend OK.');
  }

  await ensureEnv({ apollo: false, prospeo: true });
  if (!process.env.PROSPEO_API_KEY?.trim()) {
    throw new Error('PROSPEO_API_KEY not available');
  }

  let checkpoint = loadJson<ProspeoCheckpoint>(checkpointPath) ?? emptyCheckpoint();

  const processOne = async (company: CohortCompany) => {
    const useNamed =
      options.mode === 'named_only' ||
      (options.mode === 'auto' && company.has_person_name);
    if (options.mode === 'named_only' && !company.has_person_name) {
      return {
        row: missRow(company, 'named_enrich', 'no_person_name', 0, options.stage),
        credits: 0,
        searchCalls: 0,
        enrichCalls: 0,
      };
    }
    if (useNamed) return enrichNamed(company, options.stage);
    return enrichCompanyPath(company, options.stage);
  };

  for (let i = checkpoint.next_index; i < rows.length; i++) {
    if (
      options.maxProspeoCredits != null &&
      checkpoint.credits_spent >= options.maxProspeoCredits
    ) {
      console.error(
        `[${options.stage}] hit max credits ${checkpoint.credits_spent} at ${i}/${rows.length}`,
      );
      break;
    }

    const raw = rows[i]!;
    const company = toCompany(raw);
    const key = companyKey({
      company_name: company.company_name,
      ad_id: company.ad_id,
      company_domain: company.company_domain,
    });

    if (haveEmail.has(key)) {
      checkpoint.skipped_have_email += 1;
      checkpoint.next_index = i + 1;
      writeJson(checkpointPath, checkpoint);
      continue;
    }

    console.error(
      `[${options.stage}] ${i + 1}/${rows.length} ${company.company_name} (${company.has_person_name ? 'named' : 'company'})`,
    );

    try {
      const result = await processOne(company);
      checkpoint.results.push(result.row);
      checkpoint.credits_spent += result.credits;
      checkpoint.search_calls += result.searchCalls;
      checkpoint.enrich_calls += result.enrichCalls;
      if (result.row.status.startsWith('matched') && result.row.contact_email) {
        checkpoint.matched += 1;
        haveEmail.add(key);
      } else {
        checkpoint.no_match += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checkpoint.results.push(missRow(company, 'error', message, 0, options.stage));
      checkpoint.no_match += 1;
      console.error(`[${options.stage}] error: ${message}`);
      if (/rate limit/i.test(message)) {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    checkpoint.attempted += 1;
    checkpoint.next_index = i + 1;
    writeJson(checkpointPath, checkpoint);
    writeCsv(outPath, checkpoint.results, PROSPEO_RESULT_COLUMNS);
    await new Promise((r) => setTimeout(r, 800));
  }

  writeCsv(outPath, checkpoint.results, PROSPEO_RESULT_COLUMNS);
  writeJson(join(outDir, `${options.stage}_spend_tally.json`), {
    stage: options.stage,
    attempted: checkpoint.attempted,
    matched: checkpoint.matched,
    no_match: checkpoint.no_match,
    credits_spent: checkpoint.credits_spent,
    search_calls: checkpoint.search_calls,
    enrich_calls: checkpoint.enrich_calls,
    skipped_have_email: checkpoint.skipped_have_email,
  });

  console.log(
    JSON.stringify(
      {
        done: true,
        stage: options.stage,
        attempted: checkpoint.attempted,
        matched: checkpoint.matched,
        no_match: checkpoint.no_match,
        credits_spent: checkpoint.credits_spent,
        skipped_have_email: checkpoint.skipped_have_email,
      },
      null,
      2,
    ),
  );

  return { checkpoint, path: outPath };
}
