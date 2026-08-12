import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractAdCopySignals } from './adCopySignals.js';
import { ensureDir, readCsv, writeCsv, writeJson } from './io.js';
import { normalizeDomain } from './types.js';

export const PASS7_CANDIDATE_COLUMNS = [
  'bucket',
  'platform',
  'company_name',
  'company_domain',
  'discovered_domain',
  'person_name',
  'ad_id',
  'ad_library_url',
  'landing_url',
  'expandable_url',
  'copy_domains',
  'best_company_query',
  'signals_note',
] as const;

function loadRehydrated(pass7Dir: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const path = join(pass7Dir, 'rehydrated_landings.csv');
  if (!existsSync(path)) return out;
  for (const row of readCsv(path)) {
    if (row.ad_id) out.set(row.ad_id, row);
  }
  return out;
}

/**
 * Bucket pass5 dark leftovers for href rehydrate + bare-copy + short expand.
 */
export function prepPass7(options: {
  pass1Dir: string;
  pass7Dir: string;
}): {
  already_has_domain: number;
  copy_domain: number;
  rehydrate: number;
  expand: number;
} {
  const pass7Dir = ensureDir(options.pass7Dir);
  const darkPath = join(options.pass1Dir, 'pass5', 'dark_advertisers.csv');
  if (!existsSync(darkPath)) {
    throw new Error(`Missing ${darkPath} — run pass5 --stage prep first`);
  }

  const rehydrated = loadRehydrated(pass7Dir);
  const buckets: Record<string, Record<string, string>[]> = {
    already_has_domain: [],
    copy_domain: [],
    rehydrate: [],
    expand: [],
  };

  for (const row of readCsv(darkPath)) {
    const adId = (row.ad_id || '').trim();
    if (!adId) continue;

    const companyName = (row.company_name || '').trim();
    const signals = extractAdCopySignals({
      company_name: companyName,
      ad_copy: row.ad_copy,
      ad_headline: row.ad_headline,
    });

    const re = rehydrated.get(adId);
    const reDomain =
      re?.status === 'recovered' ? normalizeDomain(re.normalized_domain || re.href || '') : '';
    const reHref = (re?.href || '').trim();
    const reGeneric = re?.status === 'generic_or_stripped' ? reHref : '';

    const cohortDom =
      normalizeDomain(row.company_domain || '') || normalizeDomain(row.landing_domain || '');
    const rawLanding = (row.landing_url || '').trim();
    const landingUrl = reHref || rawLanding;
    const copyDom = signals.domains[0] || '';
    const person_name = row.person_name || '';

    const base: Record<string, string> = {
      bucket: '',
      platform: row.platform || '',
      company_name: companyName,
      company_domain: reDomain || cohortDom || copyDom,
      discovered_domain: '',
      person_name,
      ad_id: adId,
      ad_library_url: row.ad_library_url || '',
      landing_url: landingUrl,
      expandable_url: '',
      copy_domains: signals.domains.join('|'),
      best_company_query: signals.best_company_query,
      signals_note: '',
    };

    if (reDomain) {
      buckets.copy_domain.push({
        ...base,
        bucket: 'copy_domain',
        company_domain: reDomain,
        discovered_domain: reDomain,
        landing_url: reHref || landingUrl,
        signals_note: 'rehydrated_href',
      });
      continue;
    }

    if (copyDom) {
      buckets.copy_domain.push({
        ...base,
        bucket: 'copy_domain',
        company_domain: copyDom,
        discovered_domain: copyDom,
        signals_note: `ad_copy_domain:${signals.domains.join(',')}`,
      });
      continue;
    }

    if (cohortDom) {
      buckets.already_has_domain.push({
        ...base,
        bucket: 'already_has_domain',
        discovered_domain: cohortDom,
        company_domain: cohortDom,
        signals_note: 'dark_has_domain',
      });
      continue;
    }

    // Generic landing (or rehydrated generic) → expand redirects
    const expandUrl = reGeneric || (rawLanding && /^https?:\/\//i.test(rawLanding) ? rawLanding : '');
    if (expandUrl) {
      buckets.expand.push({
        ...base,
        bucket: 'expand',
        landing_url: expandUrl,
        expandable_url: expandUrl,
        signals_note: reGeneric ? 'rehydrated_generic' : 'short_or_generic_landing',
      });
      continue;
    }

    if ((row.ad_library_url || '').trim()) {
      buckets.rehydrate.push({
        ...base,
        bucket: 'rehydrate',
        signals_note: 'empty_landing_open_library',
      });
      continue;
    }

    buckets.already_has_domain.push({
      ...base,
      bucket: 'already_has_domain',
      signals_note: 'no_library_url',
    });
  }

  for (const [name, rows] of Object.entries(buckets)) {
    writeCsv(join(pass7Dir, `${name}.csv`), rows, [...PASS7_CANDIDATE_COLUMNS]);
  }

  // Synthetic high-tier discovered for confirm
  const discovered = buckets.copy_domain.map((r) => ({
    ad_id: r.ad_id,
    company_name: r.company_name,
    platform: r.platform,
    person_name: r.person_name,
    discovered_domain: r.discovered_domain,
    score: '0.95',
    tier: 'high',
    reasons: r.signals_note.startsWith('rehydrated') ? 'rehydrated_href' : 'ad_copy_url',
    query: r.signals_note,
    status: 'candidate',
    error: '',
    ad_library_url: r.ad_library_url,
    best_company_query: r.best_company_query,
  }));
  writeCsv(
    join(pass7Dir, 'copy_domain_discovered.csv'),
    discovered,
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

  // Expand input shape for expandLandings
  writeCsv(
    join(pass7Dir, 'expand_input.csv'),
    buckets.expand.map((r) => ({
      ad_id: r.ad_id,
      company_name: r.company_name,
      platform: r.platform,
      person_name: r.person_name,
      expandable_url: r.expandable_url,
      ad_library_url: r.ad_library_url,
    })),
    ['ad_id', 'company_name', 'platform', 'person_name', 'expandable_url', 'ad_library_url'],
  );

  writeCsv(
    join(pass7Dir, 'rehydrate_input.csv'),
    buckets.rehydrate,
    [...PASS7_CANDIDATE_COLUMNS],
  );

  const tally = {
    already_has_domain: buckets.already_has_domain.length,
    copy_domain: buckets.copy_domain.length,
    rehydrate: buckets.rehydrate.length,
    expand: buckets.expand.length,
  };
  writeJson(join(pass7Dir, 'prep_tally.json'), tally);
  console.log(JSON.stringify({ done: true, stage: 'prep', ...tally }, null, 2));
  return tally;
}

/**
 * After rehydrate + expand, rebuild copy_domain_discovered including new domains.
 */
export function mergePass7Discovered(pass7Dir: string): number {
  const byId = new Map<string, Record<string, string>>();
  const cols = [
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
  ];

  const add = (row: Record<string, string>) => {
    if (!row.ad_id || !row.discovered_domain) return;
    const prev = byId.get(row.ad_id);
    if (!prev) {
      byId.set(row.ad_id, row);
      return;
    }
    const rank = (t: string) => (t === 'high' ? 2 : t === 'medium' ? 1 : 0);
    if (rank(row.tier || '') >= rank(prev.tier || '')) byId.set(row.ad_id, row);
  };

  if (existsSync(join(pass7Dir, 'copy_domain_discovered.csv'))) {
    for (const row of readCsv(join(pass7Dir, 'copy_domain_discovered.csv'))) add(row);
  }

  const rePath = join(pass7Dir, 'rehydrated_landings.csv');
  if (existsSync(rePath)) {
    for (const row of readCsv(rePath)) {
      if (row.status !== 'recovered' || !row.normalized_domain) continue;
      add({
        ad_id: row.ad_id,
        company_name: row.company_name,
        platform: row.platform,
        person_name: row.person_name,
        discovered_domain: row.normalized_domain,
        score: '0.95',
        tier: 'high',
        reasons: 'rehydrated_href',
        query: row.href,
        status: 'candidate',
        error: '',
        ad_library_url: row.ad_library_url,
        best_company_query: row.company_name,
      });
    }
  }

  const expandPath = join(pass7Dir, 'domains_from_redirect.csv');
  if (existsSync(expandPath)) {
    for (const row of readCsv(expandPath)) {
      if (row.status !== 'candidate' || !row.discovered_domain) continue;
      if (row.tier !== 'high' && row.tier !== 'medium') continue;
      add({
        ad_id: row.ad_id,
        company_name: row.company_name,
        platform: row.platform,
        person_name: row.person_name,
        discovered_domain: row.discovered_domain,
        score: row.score || '0.8',
        tier: row.tier === 'medium' ? 'medium' : 'high',
        reasons: 'redirect_expand',
        query: row.source_url || row.final_url,
        status: 'candidate',
        error: '',
        ad_library_url: row.ad_library_url,
        best_company_query: row.company_name,
      });
    }
  }

  // Also fold generic rehydrated hrefs into expand_input if not already expanded
  if (existsSync(rePath)) {
    const expandRows = existsSync(join(pass7Dir, 'expand_input.csv'))
      ? readCsv(join(pass7Dir, 'expand_input.csv'))
      : [];
    const seen = new Set(expandRows.map((r) => r.ad_id));
    for (const row of readCsv(rePath)) {
      if (row.status !== 'generic_or_stripped' || !(row.href || '').trim()) continue;
      if (seen.has(row.ad_id)) continue;
      expandRows.push({
        ad_id: row.ad_id,
        company_name: row.company_name,
        platform: row.platform,
        person_name: row.person_name,
        expandable_url: row.href,
        ad_library_url: row.ad_library_url,
      });
      seen.add(row.ad_id);
    }
    writeCsv(
      join(pass7Dir, 'expand_input.csv'),
      expandRows,
      ['ad_id', 'company_name', 'platform', 'person_name', 'expandable_url', 'ad_library_url'],
    );
  }

  writeCsv(join(pass7Dir, 'domains_discovered.csv'), [...byId.values()], cols);
  return byId.size;
}
