import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { truncateRows } from '../../webinar-hosts/src/lib/cli.js';
import { readCsv, writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import { COMPANY_COLUMNS, type CompanyRow } from './types.js';

const DOMAIN_KEYS = [
  'company_domain',
  'Company Domain',
  'Domain',
  'domain',
  'Website',
  'website',
  'Root Domain',
];

const NAME_KEYS = [
  'company_name',
  'Company Name',
  'Company Name for Emails',
  'Company',
  'company',
  'name',
];

export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return '';
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '');
  value = value.split('/')[0] ?? value;
  value = value.split('?')[0] ?? value;
  return value.replace(/\.$/, '');
}

function pickField(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  // Case-insensitive fallback
  const lowerMap = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const actual = lowerMap.get(key.toLowerCase());
    if (actual) {
      const value = row[actual]?.trim();
      if (value) return value;
    }
  }
  return '';
}

export function rowToCompany(
  row: Record<string, string>,
  sourceLabel: string,
): CompanyRow | null {
  const domain = normalizeDomain(pickField(row, DOMAIN_KEYS));
  if (!domain) return null;
  const name = pickField(row, NAME_KEYS) || domain;
  return {
    company_name: name,
    company_domain: domain,
    source_lists: sourceLabel,
  };
}

export function mergeCompanies(rows: CompanyRow[]): CompanyRow[] {
  const byDomain = new Map<string, CompanyRow>();
  for (const row of rows) {
    const existing = byDomain.get(row.company_domain);
    if (!existing) {
      byDomain.set(row.company_domain, { ...row });
      continue;
    }
    const sources = new Set(
      `${existing.source_lists}|${row.source_lists}`
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    existing.source_lists = [...sources].sort().join('|');
    if (!existing.company_name || existing.company_name === existing.company_domain) {
      if (row.company_name && row.company_name !== row.company_domain) {
        existing.company_name = row.company_name;
      }
    }
  }
  return [...byDomain.values()].sort((a, b) => a.company_domain.localeCompare(b.company_domain));
}

export function prepCompanies(options: {
  inputPaths: string[];
  runDir: string;
  maxRows?: number | null;
}): { companies: CompanyRow[]; companiesPath: string; runDir: string } {
  const runDir = resolve(options.runDir);
  mkdirSync(join(runDir, 'sources'), { recursive: true });

  const collected: CompanyRow[] = [];
  for (const inputPath of options.inputPaths) {
    const abs = resolve(inputPath);
    if (!existsSync(abs)) {
      throw new Error(`Input not found: ${abs}`);
    }
    const label = basename(abs);
    copyFileSync(abs, join(runDir, 'sources', label));
    const rows = readCsv(abs);
    for (const row of rows) {
      const company = rowToCompany(row, label);
      if (company) collected.push(company);
    }
  }

  let companies = mergeCompanies(collected);
  companies = truncateRows(companies, options.maxRows ?? null);

  const companiesPath = join(runDir, 'companies.csv');
  writeCsv(
    companiesPath,
    companies.map((c) => ({ ...c })),
    [...COMPANY_COLUMNS],
  );

  return { companies, companiesPath, runDir };
}
