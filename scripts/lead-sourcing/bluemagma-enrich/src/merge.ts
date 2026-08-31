import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCliArgs } from './lib/cli.js';
import { loadEnv } from './lib/env.js';
import { readCsv, writeCsv } from './lib/csv.js';
import { loadJson, writeJson } from './lib/io.js';
import {
  ENRICHED_PERSON_COLUMNS,
  FUNDING_COLUMNS,
  PERSON_COLUMNS,
  companyKey,
  normalizeLinkedInCompanyUrl,
} from './lib/types.js';

function countBy(rows: Record<string, string>[], col: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = (row[col] || '(empty)').trim() || '(empty)';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function mergeEnriched(runDir: string): { outreach: number; dropped: number } {
  const peoplePath = join(runDir, 'people.csv');
  if (!existsSync(peoplePath)) throw new Error(`Missing ${peoplePath}. Run prep first.`);
  const people = readCsv(peoplePath);
  const classifiedPath = join(runDir, 'companies_classified.csv');
  const classified = existsSync(classifiedPath) ? readCsv(classifiedPath) : [];
  const classifiedByKey = new Map(classified.map((c) => [c.company_key, c]));

  let companies = existsSync(join(runDir, 'companies_soc2.csv'))
    ? readCsv(join(runDir, 'companies_soc2.csv'))
    : classified.length
      ? classified
      : existsSync(join(runDir, 'companies_with_domains.csv'))
        ? readCsv(join(runDir, 'companies_with_domains.csv'))
        : [];

  if (classifiedByKey.size) {
    companies = companies.map((row) => {
      const role = classifiedByKey.get(row.company_key);
      if (!role) return row;
      return {
        ...row,
        company_role: role.company_role ?? row.company_role,
        is_compliance_platform: role.is_compliance_platform ?? row.is_compliance_platform,
        role_reason: role.role_reason ?? row.role_reason,
        role_evidence: role.role_evidence ?? row.role_evidence,
      };
    });
  }

  const fundingPath = join(runDir, 'companies_funding.csv');
  const fundingRows = existsSync(fundingPath) ? readCsv(fundingPath) : [];
  const fundingByKey = new Map(fundingRows.map((f) => [f.company_key, f]));

  if (fundingByKey.size) {
    companies = companies.map((row) => {
      const fund = fundingByKey.get(row.company_key);
      if (!fund) return row;
      const out = { ...row };
      for (const col of FUNDING_COLUMNS) {
        if (fund[col]) out[col] = fund[col];
      }
      return out;
    });
  }

  const byKey = new Map(companies.map((c) => [c.company_key, c]));
  const all: Record<string, string>[] = [];

  for (const person of people) {
    const key = companyKey(person.company ?? '', normalizeLinkedInCompanyUrl(person.company_linkedin ?? ''));
    const company = key ? byKey.get(key) : undefined;
    all.push({
      ...Object.fromEntries(PERSON_COLUMNS.map((col) => [col, person[col] ?? ''])),
      company_key: key,
      company_domain: company?.company_domain ?? '',
      domain_source: company?.domain_source ?? '',
      website_status: company?.website_status ?? '',
      company_role: company?.company_role ?? (key ? 'unknown' : ''),
      is_compliance_platform: company?.is_compliance_platform ?? 'false',
      role_reason: company?.role_reason ?? '',
      has_soc2: company?.has_soc2 ?? 'unknown',
      soc2_evidence_url: company?.soc2_evidence_url ?? '',
      soc2_evidence_snippet: company?.soc2_evidence_snippet ?? '',
      soc2_method: company?.soc2_method ?? 'none',
      total_funding: company?.total_funding ?? '',
      total_funding_printed: company?.total_funding_printed ?? '',
      latest_funding_stage: company?.latest_funding_stage ?? '',
      latest_funding_round_date: company?.latest_funding_round_date ?? '',
      funding_events: company?.funding_events ?? '',
    });
  }

  const dropped = all.filter((r) => r.company_role === 'compliance_platform');
  const outreach = all.filter((r) => r.company_role !== 'compliance_platform');

  writeCsv(join(runDir, 'all_enriched.csv'), all, ENRICHED_PERSON_COLUMNS);
  writeCsv(join(runDir, 'outreach_enriched.csv'), outreach, ENRICHED_PERSON_COLUMNS);
  writeCsv(join(runDir, 'dropped_platforms.csv'), dropped, ENRICHED_PERSON_COLUMNS);

  const websitesTally = loadJson<Record<string, number>>(join(runDir, 'websites_tally.json')) ?? {};
  const soc2Tally = loadJson<Record<string, number>>(join(runDir, 'soc2_tally.json')) ?? {};
  const fundingTally = loadJson<Record<string, number>>(join(runDir, 'funding_tally.json')) ?? {};
  const prep = loadJson<Record<string, number>>(join(runDir, 'prep_summary.json')) ?? {};

  const withFunding = companies.filter((c) => c.total_funding).length;

  const summary = {
    people: people.length,
    unique_companies: prep.unique_companies ?? companies.length,
    unresolvable_people: prep.unresolvable_people ?? 0,
    with_domain: companies.filter((c) => c.company_domain && c.website_status !== 'needs_review').length,
    roles: countBy(companies, 'company_role'),
    has_soc2: countBy(companies, 'has_soc2'),
    with_funding: withFunding,
    outreach_people: outreach.length,
    dropped_platform_people: dropped.length,
    apollo_org_calls: (websitesTally.apollo_org_calls ?? 0) + (fundingTally.apollo_org_calls ?? 0),
    serper_website_calls: websitesTally.serper_calls ?? 0,
    serper_soc2_calls: soc2Tally.serper_calls ?? 0,
  };
  writeJson(join(runDir, 'summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
  return { outreach: outreach.length, dropped: dropped.length };
}

async function main(): Promise<void> {
  loadEnv();
  const cli = parseCliArgs();
  if (!cli.runDir) throw new Error('--run-dir is required for merge');
  mergeEnriched(resolve(cli.runDir));
}

if (process.argv[1]?.includes('merge.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
