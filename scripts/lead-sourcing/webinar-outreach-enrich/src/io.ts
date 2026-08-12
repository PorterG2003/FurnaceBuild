import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { CohortCompany, OutreachRow } from './types.js';
import { toCohortCompany } from './types.js';

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function readCsv(path: string): Record<string, string>[] {
  const raw = readFileSync(path, 'utf8');
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];
}

export function writeCsv(path: string, rows: Record<string, string>[], columns: string[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((col) => csvEscape(row[col] ?? '')).join(','));
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeText(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

export function ensureDir(path: string): string {
  const resolved = resolve(path);
  mkdirSync(resolved, { recursive: true });
  return resolved;
}

export function loadOutreachCsv(path: string): OutreachRow[] {
  return readCsv(path).map((row) => ({
    platform: row.platform ?? '',
    company_name: row.company_name ?? '',
    company_url: row.company_url ?? '',
    landing_url: row.landing_url ?? '',
    landing_domain: row.landing_domain ?? '',
    person_name: row.person_name ?? '',
    ad_library_url: row.ad_library_url ?? '',
    ad_id: row.ad_id ?? '',
    ad_headline: row.ad_headline ?? '',
    ad_copy: row.ad_copy ?? '',
    ad_active_from: row.ad_active_from ?? '',
    phrases_found: row.phrases_found ?? '',
    qualifying_ad_count: row.qualifying_ad_count ?? '',
    source_runs: row.source_runs ?? '',
  }));
}

export function splitCohorts(rows: OutreachRow[]): {
  linkedin: CohortCompany[];
  meta: CohortCompany[];
} {
  const linkedin: CohortCompany[] = [];
  const meta: CohortCompany[] = [];
  for (const row of rows) {
    const company = toCohortCompany(row);
    if (company.platform === 'linkedin') linkedin.push(company);
    else if (company.platform === 'meta') meta.push(company);
  }
  return { linkedin, meta };
}

export function cohortColumns(): string[] {
  return [
    'platform',
    'company_name',
    'company_url',
    'company_domain',
    'landing_url',
    'landing_domain',
    'person_name',
    'ad_library_url',
    'ad_id',
    'has_usable_domain',
    'has_person_name',
    'has_company_linkedin',
    'phrases_found',
    'source_runs',
  ];
}

export function cohortToRow(company: CohortCompany): Record<string, string> {
  return {
    platform: company.platform,
    company_name: company.company_name,
    company_url: company.company_url,
    company_domain: company.company_domain,
    landing_url: company.landing_url,
    landing_domain: company.landing_domain,
    person_name: company.person_name,
    ad_library_url: company.ad_library_url,
    ad_id: company.ad_id,
    has_usable_domain: company.has_usable_domain ? 'true' : 'false',
    has_person_name: company.has_person_name ? 'true' : 'false',
    has_company_linkedin: company.has_company_linkedin ? 'true' : 'false',
    phrases_found: company.phrases_found,
    source_runs: company.source_runs,
  };
}

export function checkpointPath(runDir: string, name: string): string {
  return join(runDir, name);
}

export function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
