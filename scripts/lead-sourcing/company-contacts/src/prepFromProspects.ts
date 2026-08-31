import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import {
  hostFromAny,
  isUnusableProspectHost,
} from '../../ce-vendor-providers/src/lib/url.js';
import { normalizeDomain } from './prepCompanies.js';
import { COMPANY_COLUMNS, type CompanyRow } from './types.js';

export type ProspectPrepRow = {
  company_name: string;
  company_domain: string;
  fit_tier: string;
  self_provided: string;
  has_live_online: string;
  source_directories: string;
  domain_source: string;
};

const META_COLUMNS = [
  'company_name',
  'company_domain',
  'fit_tier',
  'self_provided',
  'has_live_online',
  'source_directories',
  'domain_source',
] as const;

function collectUrlCandidates(prospect: Record<string, string>, fitRows: Record<string, string>[]): string[] {
  const out: string[] = [];
  for (const row of fitRows) {
    if (row.homepage_url) out.push(row.homepage_url);
    if (row.listed_website) out.push(row.listed_website);
    if (row.registration_host_domain) out.push(row.registration_host_domain);
  }
  if (prospect.registration_host_domain) out.push(prospect.registration_host_domain);
  for (const part of (prospect.example_urls ?? '').split('|')) {
    if (part.trim()) out.push(part.trim());
  }
  return out;
}

export function pickCompanyDomain(
  prospect: Record<string, string>,
  fitRows: Record<string, string>[],
): { domain: string; source: string } | null {
  for (const raw of collectUrlCandidates(prospect, fitRows)) {
    const host = hostFromAny(raw);
    if (!host) continue;
    if (isUnusableProspectHost(host)) continue;
    const domain = normalizeDomain(host);
    if (!domain) continue;
    return { domain, source: raw.trim() };
  }
  return null;
}

export function splitProspectCompanies(
  prospects: Record<string, string>[],
  fitEntries: Record<string, string>[],
): { withDomain: ProspectPrepRow[]; platformOnly: ProspectPrepRow[] } {
  const fitByName = new Map<string, Record<string, string>[]>();
  for (const row of fitEntries) {
    const name = (row.provider_name ?? '').trim();
    if (!name) continue;
    const list = fitByName.get(name) ?? [];
    list.push(row);
    fitByName.set(name, list);
  }

  const withDomain: ProspectPrepRow[] = [];
  const platformOnly: ProspectPrepRow[] = [];
  const seenDomain = new Set<string>();

  const candidates = prospects.filter((p) => p.fit_tier === '1' || p.fit_tier === '2');
  for (const prospect of candidates) {
    const name = (prospect.company_name ?? '').trim();
    if (!name) continue;
    const fitRows = fitByName.get(name) ?? [];
    const picked = pickCompanyDomain(prospect, fitRows);
    const base: ProspectPrepRow = {
      company_name: name,
      company_domain: picked?.domain ?? '',
      fit_tier: prospect.fit_tier ?? '',
      self_provided: prospect.self_provided ?? '',
      has_live_online: prospect.has_live_online ?? '',
      source_directories: prospect.source_directories ?? '',
      domain_source: picked?.source ?? '',
    };
    if (!picked) {
      platformOnly.push(base);
      continue;
    }
    if (seenDomain.has(picked.domain)) continue;
    seenDomain.add(picked.domain);
    withDomain.push(base);
  }

  return { withDomain, platformOnly };
}

export function prepFromProspects(options: {
  prospectsPath: string;
  fitEntriesPath: string;
  runDir: string;
}): {
  runDir: string;
  companiesPath: string;
  platformOnlyPath: string;
  withDomain: number;
  platformOnly: number;
} {
  const runDir = resolve(options.runDir);
  mkdirSync(runDir, { recursive: true });
  const prospects = readCsv(options.prospectsPath);
  const fitEntries = readCsv(options.fitEntriesPath);
  const { withDomain, platformOnly } = splitProspectCompanies(prospects, fitEntries);

  const companies: CompanyRow[] = withDomain.map((row) => ({
    company_name: row.company_name,
    company_domain: row.company_domain,
    source_lists: 'ce-vendor-prospects',
  }));

  const companiesPath = join(runDir, 'companies.csv');
  const platformOnlyPath = join(runDir, 'platform_only.csv');
  const metaPath = join(runDir, 'candidates_meta.csv');

  writeCsv(
    companiesPath,
    companies.map((c) => ({ ...c })),
    [...COMPANY_COLUMNS],
  );
  writeCsv(
    platformOnlyPath,
    platformOnly.map((r) => ({ ...r })),
    [...META_COLUMNS],
  );
  writeCsv(
    metaPath,
    withDomain.map((r) => ({ ...r })),
    [...META_COLUMNS],
  );

  return {
    runDir,
    companiesPath,
    platformOnlyPath,
    withDomain: withDomain.length,
    platformOnly: platformOnly.length,
  };
}
