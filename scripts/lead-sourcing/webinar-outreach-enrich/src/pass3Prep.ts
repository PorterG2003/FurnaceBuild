import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';
import { companyKey, loadHaveEmailKeys } from './pass2Prep.js';

export const PASS3_MISS_COLUMNS = [
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
  'expandable_url',
] as const;

function expandableUrl(row: Record<string, string>): string {
  const landing = (row.landing_url || '').trim();
  if (landing && /^https?:\/\//i.test(landing)) return landing;
  const company = (row.company_url || '').trim();
  // short links / http only — not linkedin company pages as "expand to website"
  if (company && /^https?:\/\//i.test(company) && !/linkedin\.com\/company\//i.test(company)) {
    return company;
  }
  return '';
}

export function prepPass3(options: {
  pass1Dir: string;
  pass2Dir?: string;
  pass3Dir: string;
}): {
  pass3Dir: string;
  counts: Record<string, number>;
} {
  const pass1Dir = options.pass1Dir;
  const pass2Dir = options.pass2Dir ?? join(pass1Dir, 'pass2');
  const pass3Dir = ensureDir(options.pass3Dir);

  const haveEmail = loadHaveEmailKeys(pass1Dir, pass2Dir);
  // Also keys from pass2 combined enriched if present
  const pass2Combined = join(pass2Dir, 'enriched_leads.csv');
  if (existsSync(pass2Combined)) {
    for (const row of readCsv(pass2Combined)) {
      if ((row.contact_email || '').trim()) haveEmail.add(companyKey(row));
    }
  }

  const linkedin = readCsv(join(pass1Dir, 'linkedin_cohort.csv'));
  const meta = readCsv(join(pass1Dir, 'meta_cohort.csv'));
  const misses: Record<string, string>[] = [];

  for (const row of [...linkedin, ...meta]) {
    const key = companyKey(row);
    if (haveEmail.has(key)) continue;
    const hasDomain =
      row.has_usable_domain === 'true' || Boolean((row.company_domain || '').trim());
    if (hasDomain) continue; // plan: only no-domain misses

    const url = expandableUrl(row);
    misses.push({
      platform: row.platform ?? '',
      company_name: row.company_name ?? '',
      company_url: row.company_url ?? '',
      company_domain: row.company_domain ?? '',
      landing_url: row.landing_url ?? '',
      landing_domain: row.landing_domain ?? '',
      person_name: row.person_name ?? '',
      ad_library_url: row.ad_library_url ?? '',
      ad_id: row.ad_id ?? '',
      has_usable_domain: 'false',
      has_person_name: row.has_person_name ?? (row.person_name ? 'true' : 'false'),
      expandable_url: url,
    });
  }

  // dedupe
  const seen = new Set<string>();
  const deduped = misses.filter((r) => {
    const k = companyKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  writeCsv(join(pass3Dir, 'no_domain_misses.csv'), deduped, [...PASS3_MISS_COLUMNS]);

  const withExpandable = deduped.filter((r) => r.expandable_url).length;
  const needsSerper = deduped.length - withExpandable;
  const estimates = {
    no_domain_misses: deduped.length,
    expandable_urls: withExpandable,
    serper_needed_if_expand_fails: withExpandable + needsSerper, // worst: all need serper
    serper_needed_residual_est: needsSerper,
    hard_caps: {
      serper_pilot: 30,
      serper_full: 120,
      apollo_org: 100,
      enrichment: 80,
    },
  };
  writeJson(join(pass3Dir, 'prep_estimates.json'), estimates);

  return {
    pass3Dir,
    counts: {
      no_domain_misses: deduped.length,
      expandable_urls: withExpandable,
      no_url_serper_only: needsSerper,
      have_email_skipped: haveEmail.size,
    },
  };
}
