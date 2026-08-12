import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CallCounter } from '../../webinar-hosts/src/lib/callCounter.js';
import { resolveOrgs } from '../../company-contacts/src/resolveOrgs.js';
import { findContacts } from '../../company-contacts/src/findContacts.js';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';
import { asNumber, ensureEnv, outputDir, parseArgs } from './env.js';
import { prepCohorts } from './cohortPrep.js';
import { defaultOutreachCsv } from './env.js';

export type MetaSpendTally = {
  org_calls: number;
  people_calls: number;
  enrichment_credits: number;
  leads: number;
  rejected: number;
  domain_gated_companies: number;
};

export async function enrichMetaApollo(options: {
  runDir: string;
  dryRun?: boolean;
  maxRows?: number | null;
  maxApolloOrgCalls?: number | null;
  maxEnrichmentCredits?: number | null;
  liveConfirmed?: boolean;
}): Promise<{ tally: MetaSpendTally; leadsPath: string }> {
  const runDir = ensureDir(options.runDir);
  const apolloDir = ensureDir(join(runDir, 'meta_apollo'));
  const companiesPath = join(apolloDir, 'companies.csv');

  if (!existsSync(companiesPath)) {
    throw new Error(`Missing ${companiesPath}. Run prep first.`);
  }

  let companies = readCsv(companiesPath);
  const companyCount =
    options.maxRows != null ? Math.min(companies.length, options.maxRows) : companies.length;

  if (options.dryRun) {
    const estimate = {
      dry_run: true,
      domain_gated_companies: companyCount,
      estimated_apollo_org_calls: companyCount,
      estimated_people_searches: companyCount,
      estimated_email_enrich_credits_max: companyCount,
      max_contacts_per_company: 1,
      max_apollo_org_calls: options.maxApolloOrgCalls,
      max_enrichment_credits: options.maxEnrichmentCredits,
      note: 'Name-only Meta rows without usable domain are deferred (not in this file).',
    };
    console.log(JSON.stringify(estimate, null, 2));
    writeJson(join(runDir, 'meta_dry_run.json'), estimate);
    await resolveOrgs({
      runDir: apolloDir,
      companiesPath,
      dryRun: true,
      maxRows: options.maxRows,
      maxApolloCalls: options.maxApolloOrgCalls,
    });
    return {
      tally: {
        org_calls: 0,
        people_calls: 0,
        enrichment_credits: 0,
        leads: 0,
        rejected: 0,
        domain_gated_companies: companyCount,
      },
      leadsPath: join(apolloDir, 'leads.csv'),
    };
  }

  if (!options.liveConfirmed) {
    throw new Error(
      'Live Apollo spend requires --live and explicit spend confirmation. Re-run after OK with --live.',
    );
  }

  await ensureEnv({ apollo: true, prospeo: false });
  if (!process.env.APOLLO_API_KEY?.trim()) {
    throw new Error('APOLLO_API_KEY not available (env or Amplify SSM)');
  }

  const counter = new CallCounter();

  await resolveOrgs({
    runDir: apolloDir,
    companiesPath,
    dryRun: false,
    maxRows: options.maxRows,
    maxApolloCalls: options.maxApolloOrgCalls,
    counter,
  });

  const { leads, rejected } = await findContacts({
    runDir: apolloDir,
    dryRun: false,
    maxRows: options.maxRows,
    maxApolloCalls: null,
    maxEnrichmentCredits: options.maxEnrichmentCredits,
    maxContactsPerCompany: 1,
    counter,
  });

  // Prefer named ad person when Apollo returned multiple? We cap at 1 already.
  // Attach provenance columns into meta_enriched.csv
  const byDomain = new Map(
    companies.map((c) => [c.company_domain.toLowerCase(), c] as const),
  );
  const enriched = leads.map((lead) => {
    const src = byDomain.get(lead.website.toLowerCase()) ?? byDomain.get(
      (lead as { company_domain?: string }).company_domain?.toLowerCase() ?? '',
    );
    return {
      platform: 'meta',
      company_name: lead.company_name,
      company_domain: lead.website,
      contact_email: lead.email,
      contact_first_name: lead.first_name,
      contact_last_name: lead.last_name,
      contact_title: lead.contact_title,
      contact_linkedin: lead.linkedin_url,
      company_linkedin: lead.company_linkedin_url,
      contact_tier: lead.contact_tier,
      contact_pick_reason: lead.contact_pick_reason,
      apollo_org_id: lead.apollo_org_id,
      employee_count: lead.employee_count,
      industry: lead.industry,
      person_name_source: src?.person_name ?? '',
      ad_library_url: src?.ad_library_url ?? '',
      source_lists: lead.source_lists,
      provider: 'apollo',
    };
  });

  const metaColumns = [
    'platform',
    'company_name',
    'company_domain',
    'contact_email',
    'contact_first_name',
    'contact_last_name',
    'contact_title',
    'contact_linkedin',
    'company_linkedin',
    'contact_tier',
    'contact_pick_reason',
    'apollo_org_id',
    'employee_count',
    'industry',
    'person_name_source',
    'ad_library_url',
    'source_lists',
    'provider',
  ];
  writeCsv(join(runDir, 'meta_enriched.csv'), enriched, metaColumns);

  const tally: MetaSpendTally = {
    org_calls: counter.counts.apollo_org_calls,
    people_calls: counter.counts.apollo_people_calls,
    enrichment_credits: counter.counts.apollo_people_calls, // approx; findContacts also tracks enrichCredits
    leads: leads.length,
    rejected: rejected.length,
    domain_gated_companies: companyCount,
  };
  writeJson(join(runDir, 'meta_spend_tally.json'), {
    ...tally,
    counter: counter.counts,
  });

  console.log(JSON.stringify({ done: true, ...tally }, null, 2));
  return { tally, leadsPath: join(runDir, 'meta_enriched.csv') };
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

  if (!existsSync(join(runDir, 'meta_apollo', 'companies.csv'))) {
    prepCohorts({ inputCsv: defaultOutreachCsv(), runDir });
  }

  await enrichMetaApollo({
    runDir,
    dryRun,
    maxRows: asNumber(args['max-rows'], null),
    maxApolloOrgCalls: asNumber(args['max-apollo-org-calls'], 130),
    maxEnrichmentCredits: asNumber(args['max-enrichment-credits'], 120),
    liveConfirmed: live,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
