import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const srcDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = resolve(srcDir, '..');
export const configDir = join(packageRoot, 'config');
export const fixturesDir = join(packageRoot, 'fixtures');
export const outputDir = join(packageRoot, 'output');

export type ContactTiersConfig = {
  executive: string[];
  revops_function: string[];
  revops_seniority: string[];
  sales_marketing_function: string[];
  sales_marketing_seniority: string[];
  exclude: string[];
};

export type ContactSearchConfig = {
  max_contacts_per_company: number;
  per_page: number;
  fill_order: Array<'executive' | 'revops' | 'sales_marketing'>;
  contact_tiers: ContactTiersConfig;
};

export type IcpConfig = {
  contact_search: ContactSearchConfig;
};

export function loadIcpConfig(): IcpConfig {
  const raw = readFileSync(join(configDir, 'icp.yaml'), 'utf8');
  return parseYaml(raw) as IcpConfig;
}
