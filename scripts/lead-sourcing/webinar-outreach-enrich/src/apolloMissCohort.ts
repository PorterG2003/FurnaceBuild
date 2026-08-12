import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { resolveOrgs } from '../../company-contacts/src/resolveOrgs.js';
import { findContacts } from '../../company-contacts/src/findContacts.js';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';
import { ensureEnv } from './env.js';
import { companyKey, loadHaveEmailKeys } from './pass2Prep.js';

export async function runApolloMissCohort(options: {
  pass2Dir: string;
  pass1Dir: string;
  companiesCsv?: string;
  apolloSubdir?: string;
  outputCsvName?: string;
  stage?: string;
  dryRun?: boolean;
  maxRows?: number | null;
  maxApolloOrgCalls?: number | null;
  maxEnrichmentCredits?: number | null;
  liveConfirmed?: boolean;
}): Promise<{ leads: number; path: string }> {
  const pass2Dir = ensureDir(options.pass2Dir);
  const stage = options.stage ?? '2b';
  const apolloDir = ensureDir(join(pass2Dir, options.apolloSubdir ?? '2b_apollo'));
  const companiesPath =
    options.companiesCsv ?? join(apolloDir, 'companies.csv');
  const outputCsvName = options.outputCsvName ?? '2b_linkedin_apollo_enriched.csv';
  const outPath = join(pass2Dir, outputCsvName);

  if (!existsSync(companiesPath)) {
    throw new Error(`Missing ${companiesPath}. Run prep-pass2 first.`);
  }

  const haveEmail = loadHaveEmailKeys(
    options.pass1Dir,
    join(options.pass1Dir, 'pass2'),
    join(options.pass1Dir, 'pass3'),
    options.pass2Dir,
  );
  let companies = readCsv(companiesPath).filter((row) => !haveEmail.has(companyKey(row)));
  if (options.maxRows != null) {
    companies = companies.slice(0, options.maxRows);
  }

  // Write filtered working copy so resolve/find don't re-hit have-email rows
  const workingCompanies = join(apolloDir, 'companies_working.csv');
  writeCsv(
    workingCompanies,
    companies,
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

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      stage,
      companies: companies.length,
      estimated_apollo_org_calls: companies.length,
      estimated_email_enrich_credits_max: companies.length,
      max_contacts_per_company: 1,
      max_apollo_org_calls: options.maxApolloOrgCalls,
      max_enrichment_credits: options.maxEnrichmentCredits,
      skipped_have_email: haveEmail.size,
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(pass2Dir, `${stage}_dry_run.json`), estimate);
    await resolveOrgs({
      runDir: apolloDir,
      companiesPath: workingCompanies,
      dryRun: true,
      maxRows: null,
      maxApolloCalls: options.maxApolloOrgCalls,
    });
    return { leads: 0, path: outPath };
  }

  if (!options.liveConfirmed) {
    throw new Error('Live Apollo spend requires --live after explicit spend OK.');
  }

  await ensureEnv({ apollo: true, prospeo: false });
  if (!process.env.APOLLO_API_KEY?.trim()) {
    throw new Error('APOLLO_API_KEY not available');
  }

  const counter = new CallCounter();
  await resolveOrgs({
    runDir: apolloDir,
    companiesPath: workingCompanies,
    dryRun: false,
    maxRows: null,
    maxApolloCalls: options.maxApolloOrgCalls,
    counter,
  });

  const { leads, rejected } = await findContacts({
    runDir: apolloDir,
    dryRun: false,
    maxRows: null,
    maxApolloCalls: null,
    maxEnrichmentCredits: options.maxEnrichmentCredits,
    maxContactsPerCompany: 1,
    counter,
  });

  const byName = new Map(companies.map((c) => [c.company_name.toLowerCase(), c] as const));
  const byDomain = new Map(
    companies
      .filter((c) => c.company_domain)
      .map((c) => [c.company_domain.toLowerCase(), c] as const),
  );

  const enriched = leads.map((lead) => {
    const src =
      byDomain.get(lead.website.toLowerCase()) ??
      byName.get(lead.company_name.toLowerCase());
    return {
      platform: src?.platform || 'linkedin',
      provider: 'apollo',
      pass2_stage: stage,
      company_name: lead.company_name,
      company_domain: lead.website,
      contact_email: lead.email,
      contact_first_name: lead.first_name,
      contact_last_name: lead.last_name,
      contact_full_name: [lead.first_name, lead.last_name].filter(Boolean).join(' '),
      contact_title: lead.contact_title,
      contact_linkedin: lead.linkedin_url,
      company_linkedin: lead.company_linkedin_url,
      contact_tier: lead.contact_tier,
      match_path: lead.contact_pick_reason,
      person_name_source: src?.person_name ?? '',
      ad_library_url: src?.ad_library_url ?? '',
      ad_id: src?.ad_id ?? '',
      status: lead.email ? 'matched' : 'no_email',
    };
  });

  writeCsv(
    outPath,
    enriched,
    [
      'platform',
      'provider',
      'pass2_stage',
      'company_name',
      'company_domain',
      'contact_email',
      'contact_first_name',
      'contact_last_name',
      'contact_full_name',
      'contact_title',
      'contact_linkedin',
      'company_linkedin',
      'contact_tier',
      'match_path',
      'person_name_source',
      'ad_library_url',
      'ad_id',
      'status',
    ],
  );

  const tally = {
    stage,
    org_calls: counter.counts.apollo_org_calls,
    people_calls: counter.counts.apollo_people_calls,
    leads: leads.length,
    rejected: rejected.length,
    companies: companies.length,
  };
  writeJson(join(pass2Dir, `${stage}_spend_tally.json`), tally);
  console.log(JSON.stringify({ done: true, ...tally }, null, 2));
  return { leads: leads.length, path: outPath };
}
