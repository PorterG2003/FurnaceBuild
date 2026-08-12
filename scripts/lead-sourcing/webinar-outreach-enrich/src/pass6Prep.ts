import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractAdCopySignals } from './adCopySignals.js';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';
import { normalizeDomain } from './types.js';

export const PASS6_ROW_COLUMNS = [
  'bucket',
  'platform',
  'company_name',
  'best_company_query',
  'company_domain',
  'discovered_domain',
  'person_name',
  'ad_id',
  'ad_library_url',
  'ad_headline',
  'ad_copy',
  'org_aliases',
  'copy_domains',
  'signals_note',
] as const;

function loadHaveEmail(pass1Dir: string): {
  byAdId: Set<string>;
  byCompanyName: Set<string>;
} {
  const byAdId = new Set<string>();
  const byCompanyName = new Set<string>();
  const candidates = [
    join(pass1Dir, 'pass5', 'enriched_leads.csv'),
    join(pass1Dir, 'pass4', 'enriched_leads.csv'),
    join(pass1Dir, 'pass3', 'enriched_leads.csv'),
    join(pass1Dir, 'enriched_leads_pass5.csv'),
    join(pass1Dir, 'enriched_leads_pass4.csv'),
    join(pass1Dir, 'enriched_leads.csv'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (!(row.contact_email || '').trim()) continue;
      if (row.ad_id) byAdId.add(row.ad_id);
      const name = (row.company_name || '').trim().toLowerCase();
      if (name) byCompanyName.add(name);
    }
    break;
  }
  return { byAdId, byCompanyName };
}

function loadSourceAds(packageRoot: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const rel of [
    '../meta-webinar-ads/output/exports/webinar-outreach.csv',
    '../linkedin-webinar-ads/output/exports/linkedin-webinar-outreach.csv',
  ]) {
    const path = join(packageRoot, rel);
    if (!existsSync(path)) continue;
    for (const row of readCsv(path)) {
      if (row.ad_id) out.set(row.ad_id, row);
    }
  }
  return out;
}

/**
 * Bucket dark advertisers for pass6 ad-copy → domain recovery.
 */
export function prepPass6(options: {
  pass1Dir: string;
  pass6Dir: string;
  packageRoot: string;
}): {
  confirmed_no_email: number;
  copy_domain: number;
  serper_retry: number;
  skip_generic: number;
} {
  const pass6Dir = ensureDir(options.pass6Dir);
  const pass3Dir = join(options.pass1Dir, 'pass3');
  const { byAdId, byCompanyName } = loadHaveEmail(options.pass1Dir);
  const source = loadSourceAds(options.packageRoot);

  const confirmedPath = join(pass3Dir, 'domains_confirmed.csv');
  const confirmed = new Map<string, Record<string, string>>();
  if (existsSync(confirmedPath)) {
    for (const row of readCsv(confirmedPath)) {
      if (row.ad_id) confirmed.set(row.ad_id, row);
    }
  }

  const li = existsSync(join(options.pass1Dir, 'linkedin_cohort.csv'))
    ? readCsv(join(options.pass1Dir, 'linkedin_cohort.csv'))
    : [];
  const meta = existsSync(join(options.pass1Dir, 'meta_cohort.csv'))
    ? readCsv(join(options.pass1Dir, 'meta_cohort.csv'))
    : [];

  const seenCompany = new Set<string>();
  const buckets: Record<string, Record<string, string>[]> = {
    confirmed_no_email: [],
    copy_domain: [],
    serper_retry: [],
    skip_generic: [],
  };

  for (const row of [...li, ...meta]) {
    const adId = (row.ad_id || '').trim();
    if (!adId) continue;
    if (byAdId.has(adId)) continue;
    const companyName = (row.company_name || '').trim();
    const companyKey = companyName.toLowerCase();
    if (companyKey && byCompanyName.has(companyKey)) continue;
    if (companyKey && seenCompany.has(companyKey)) continue;
    if (companyKey) seenCompany.add(companyKey);

    const src = source.get(adId) || {};
    const ad_copy = src.ad_copy || row.ad_copy || '';
    const ad_headline = src.ad_headline || row.ad_headline || '';
    const person_name = row.person_name || src.person_name || '';
    const signals = extractAdCopySignals({
      company_name: companyName,
      ad_copy,
      ad_headline,
    });

    const conf = confirmed.get(adId);
    const confOk = conf?.status === 'confirmed' && (conf.apollo_domain || conf.discovered_domain);
    const landingDom = normalizeDomain(row.landing_url || src.landing_url || row.landing_domain || src.landing_domain || '');
    const cohortDomain =
      normalizeDomain(row.company_domain || row.landing_domain || '') || landingDom;
    const copyDomains = [
      ...signals.domains,
      ...(landingDom && !signals.domains.includes(landingDom) ? [landingDom] : []),
    ];

    const base: Record<string, string> = {
      bucket: '',
      platform: row.platform || src.platform || '',
      company_name: companyName,
      best_company_query: signals.best_company_query,
      company_domain: cohortDomain,
      discovered_domain: '',
      person_name,
      ad_id: adId,
      ad_library_url: row.ad_library_url || src.ad_library_url || '',
      ad_headline,
      ad_copy,
      org_aliases: signals.org_aliases.join('|'),
      copy_domains: copyDomains.join('|'),
      signals_note: '',
    };

    if (confOk) {
      buckets.confirmed_no_email.push({
        ...base,
        bucket: 'confirmed_no_email',
        discovered_domain: conf!.apollo_domain || conf!.discovered_domain || '',
        company_domain: conf!.apollo_domain || conf!.discovered_domain || cohortDomain,
        signals_note: 'pass3 confirmed; skip rediscovery (manual LI)',
      });
      continue;
    }

    if (copyDomains.length > 0) {
      buckets.copy_domain.push({
        ...base,
        bucket: 'copy_domain',
        discovered_domain: copyDomains[0]!,
        company_domain: copyDomains[0]!,
        signals_note: `ad_copy_domain:${copyDomains.join(',')}`,
      });
      continue;
    }

    if (signals.only_generic_urls) {
      buckets.skip_generic.push({
        ...base,
        bucket: 'skip_generic',
        signals_note: 'only generic short links in copy',
      });
      continue;
    }

    // No usable domain (or webinar-host false domain already stripped by normalize)
    buckets.serper_retry.push({
      ...base,
      bucket: 'serper_retry',
      signals_note: signals.org_aliases.length
        ? `alias_query:${signals.best_company_query}`
        : 'serper_with_advertiser',
    });
  }

  for (const [name, rows] of Object.entries(buckets)) {
    writeCsv(join(pass6Dir, `${name}.csv`), rows, [...PASS6_ROW_COLUMNS]);
  }

  // Candidates for confirm: copy_domain as synthetic high-tier discovered rows
  const copyForConfirm = buckets.copy_domain.map((r) => ({
    ad_id: r.ad_id,
    company_name: r.company_name,
    platform: r.platform,
    person_name: r.person_name,
    discovered_domain: r.discovered_domain,
    score: '0.95',
    tier: 'high',
    reasons: 'ad_copy_url',
    query: `ad_copy:${r.copy_domains}`,
    status: 'candidate',
    error: '',
    ad_library_url: r.ad_library_url,
    best_company_query: r.best_company_query,
  }));
  writeCsv(
    join(pass6Dir, 'copy_domain_discovered.csv'),
    copyForConfirm,
    [
      'ad_id',
      'company_name',
      'platform',
      'person_name',
      'discovered_domain',
      'score',
      'tier',
      'reasons',
      'query',
      'status',
      'error',
      'ad_library_url',
      'best_company_query',
    ],
  );

  // Serper input
  writeCsv(
    join(pass6Dir, 'serper_input.csv'),
    buckets.serper_retry.map((r) => ({
      ad_id: r.ad_id,
      company_name: r.company_name,
      best_company_query: r.best_company_query,
      platform: r.platform,
      person_name: r.person_name,
      ad_library_url: r.ad_library_url,
    })),
    [
      'ad_id',
      'company_name',
      'best_company_query',
      'platform',
      'person_name',
      'ad_library_url',
    ],
  );

  const tally = {
    confirmed_no_email: buckets.confirmed_no_email.length,
    copy_domain: buckets.copy_domain.length,
    serper_retry: buckets.serper_retry.length,
    skip_generic: buckets.skip_generic.length,
    samples: {
      copy_domain: buckets.copy_domain.slice(0, 5).map((r) => ({
        company: r.company_name,
        domain: r.discovered_domain,
      })),
      serper_retry: buckets.serper_retry.slice(0, 5).map((r) => ({
        company: r.company_name,
        query: r.best_company_query,
        aliases: r.org_aliases,
      })),
    },
  };
  writeJson(join(pass6Dir, 'prep_tally.json'), tally);
  console.log(JSON.stringify({ done: true, stage: 'prep', ...tally }, null, 2));
  return {
    confirmed_no_email: tally.confirmed_no_email,
    copy_domain: tally.copy_domain,
    serper_retry: tally.serper_retry,
    skip_generic: tally.skip_generic,
  };
}
