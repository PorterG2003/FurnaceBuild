import { join } from 'node:path';
import {
  cohortColumns,
  cohortToRow,
  ensureDir,
  loadOutreachCsv,
  splitCohorts,
  writeCsv,
  writeJson,
} from './io.js';
import type { CohortCompany } from './types.js';

function tally(companies: CohortCompany[]) {
  return {
    total: companies.length,
    with_usable_domain: companies.filter((c) => c.has_usable_domain).length,
    with_person_name: companies.filter((c) => c.has_person_name).length,
    with_company_linkedin: companies.filter((c) => c.has_company_linkedin).length,
    domain_and_person: companies.filter((c) => c.has_usable_domain && c.has_person_name).length,
    no_domain: companies.filter((c) => !c.has_usable_domain).length,
  };
}

/** Worst-case Prospeo credit ceiling for LinkedIn pass (search + enrich email-only). */
export function estimateLinkedInProspeo(companies: CohortCompany[]) {
  const named = companies.filter((c) => c.has_person_name);
  const companyPath = companies.filter((c) => !c.has_person_name);
  const named_enrich_max = named.length;
  const company_search_max = companyPath.length * 2;
  const company_enrich_max = companyPath.length;
  return {
    companies: companies.length,
    named_person_rows: named.length,
    company_path_rows: companyPath.length,
    estimated_credits_worst: named_enrich_max + company_search_max + company_enrich_max,
    estimated_credits_likely_low: Math.round(companies.length * 0.95),
    estimated_credits_likely_high: Math.round(companies.length * 1.4),
    breakdown: {
      named_enrich_max,
      company_search_max,
      company_enrich_max,
    },
  };
}

/** Apollo org + email credits for domain-gated Meta cohort. */
export function estimateMetaApollo(companies: CohortCompany[]) {
  const gated = companies.filter((c) => c.has_usable_domain);
  const deferred = companies.filter((c) => !c.has_usable_domain);
  return {
    meta_total: companies.length,
    domain_gated: gated.length,
    deferred_no_domain: deferred.length,
    estimated_apollo_org_calls: gated.length,
    estimated_people_searches: gated.length,
    estimated_email_enrich_credits: gated.length,
    estimated_credits_worst: gated.length * 2,
    estimated_credits_likely_low: Math.round(gated.length * 1.2),
    estimated_credits_likely_high: Math.round(gated.length * 1.7),
  };
}

export function prepCohorts(options: {
  inputCsv: string;
  runDir: string;
}): {
  runDir: string;
  linkedin: CohortCompany[];
  meta: CohortCompany[];
  metaGated: CohortCompany[];
  estimates: Record<string, unknown>;
} {
  const rows = loadOutreachCsv(options.inputCsv);
  const { linkedin, meta } = splitCohorts(rows);
  const metaGated = meta.filter((c) => c.has_usable_domain);
  const runDir = ensureDir(options.runDir);

  writeCsv(
    join(runDir, 'linkedin_cohort.csv'),
    linkedin.map(cohortToRow),
    cohortColumns(),
  );
  writeCsv(join(runDir, 'meta_cohort.csv'), meta.map(cohortToRow), cohortColumns());
  writeCsv(
    join(runDir, 'meta_domain_gated.csv'),
    metaGated.map(cohortToRow),
    cohortColumns(),
  );

  writeCsv(
    join(runDir, 'meta_apollo', 'companies.csv'),
    metaGated.map((c) => ({
      company_name: c.company_name,
      company_domain: c.company_domain,
      source_lists: `webinar-meta|${c.ad_id}|${c.ad_library_url}`,
      person_name: c.person_name,
      ad_library_url: c.ad_library_url,
    })),
    ['company_name', 'company_domain', 'source_lists', 'person_name', 'ad_library_url'],
  );

  const estimates = {
    input_csv: options.inputCsv,
    linkedin: {
      ...tally(linkedin),
      prospeo: estimateLinkedInProspeo(linkedin),
    },
    meta: {
      ...tally(meta),
      apollo: estimateMetaApollo(meta),
    },
    hard_caps_recommended: {
      max_prospeo_credits: 120,
      max_apollo_org_calls: 130,
      max_enrichment_credits: 120,
    },
  };

  writeJson(join(runDir, 'prep_estimates.json'), estimates);
  return { runDir, linkedin, meta, metaGated, estimates };
}
