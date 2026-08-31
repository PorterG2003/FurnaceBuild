import { join } from 'node:path';
import { readCsv, writeCsv, rowToRecord } from './lib/csv.js';
import { writeJson } from './lib/io.js';
import type { LookupResult } from './resolve.js';
import type { AccountRow } from './lookups.js';

export const ROW_REVIEW_COLUMNS = [
  'account_name',
  'account_id',
  'parent_account',
  'city',
  'state',
  'zip',
  'skipped',
  'skip_reason',
  'website',
  'website_title',
  'extracted_emails',
  'district_domain',
  'school_domain',
  'org_domain',
  'chosen_domains',
  'scope',
  'confidence',
  'notes',
] as const;

export const UNIQUE_DOMAIN_COLUMNS = [
  'domain',
  'type',
  'source_accounts',
  'scope',
  'confidence',
  'notes',
] as const;

export const ASK_QUEUE_COLUMNS = [
  'account_name',
  'parent_account',
  'city',
  'state',
  'website',
  'extracted_emails',
  'candidate_domains',
  'reason',
  'notes',
] as const;

function resultMap(rows: Record<string, string>[]): Map<string, LookupResult> {
  const map = new Map<string, LookupResult>();
  for (const row of rows) {
    map.set(row.lookup_key, {
      lookup_key: row.lookup_key,
      kind: row.kind as LookupResult['kind'],
      name: row.name,
      city: row.city,
      state: row.state,
      mega: row.mega === 'true',
      serper_query: row.serper_query ?? '',
      website_url: row.website_url ?? '',
      website_host: row.website_host ?? '',
      website_title: row.website_title ?? '',
      website_kind: (row.website_kind as LookupResult['website_kind']) || 'none',
      extracted_emails: row.extracted_emails ?? '',
      email_domains: row.email_domains ?? '',
      chosen_domain: row.chosen_domain ?? '',
      confidence: (row.confidence as LookupResult['confidence']) || 'ask',
      notes: row.notes ?? '',
    });
  }
  return map;
}

const CONF_RANK: Record<LookupResult['confidence'], number> = { high: 3, medium: 2, ask: 1 };

function weaker(a: LookupResult['confidence'] | '', b: LookupResult['confidence'] | ''): LookupResult['confidence'] | '' {
  if (!a) return b;
  if (!b) return a;
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

export function mergeResults(runDir: string): {
  review: number;
  uniqueHighMedium: number;
  ask: number;
} {
  const accounts = readCsv(join(runDir, 'accounts.csv')) as unknown as AccountRow[];
  const lookupResults = resultMap(readCsv(join(runDir, 'lookup_results.csv')));

  const review: Record<string, string>[] = [];
  const askRows: Record<string, string>[] = [];
  const domainAgg = new Map<
    string,
    { accounts: Set<string>; scopes: Set<string>; confidence: LookupResult['confidence']; notes: Set<string> }
  >();

  const addDomain = (
    domain: string,
    accountName: string,
    scope: string,
    confidence: LookupResult['confidence'],
    notes: string,
  ) => {
    const key = domain.trim().toLowerCase();
    if (!key) return;
    const existing = domainAgg.get(key);
    if (!existing) {
      domainAgg.set(key, {
        accounts: new Set([accountName]),
        scopes: new Set([scope]),
        confidence,
        notes: new Set(notes ? [notes] : []),
      });
      return;
    }
    existing.accounts.add(accountName);
    existing.scopes.add(scope);
    existing.confidence = weaker(existing.confidence, confidence) || existing.confidence;
    if (notes) existing.notes.add(notes);
  };

  for (const account of accounts) {
    const skipped = account.skipped === true || String(account.skipped) === 'true';
    if (skipped) {
      review.push(
        rowToRecord({
          account_name: account.account_name,
          account_id: account.account_id,
          parent_account: account.parent_account,
          city: account.city,
          state: account.state,
          zip: account.zip,
          skipped: true,
          skip_reason: account.skip_reason,
          website: '',
          website_title: '',
          extracted_emails: '',
          district_domain: '',
          school_domain: '',
          org_domain: '',
          chosen_domains: '',
          scope: '',
          confidence: '',
          notes: account.skip_reason,
        }),
      );
      continue;
    }

    const district = lookupResults.get(account.district_lookup_key);
    const school = lookupResults.get(account.school_lookup_key);
    const org = lookupResults.get(account.org_lookup_key);
    const primary = school ?? org ?? district;

    const districtDomain = district?.chosen_domain ?? '';
    const schoolDomain = school?.chosen_domain ?? '';
    const orgDomain = org?.chosen_domain ?? '';

    const chosen: { domain: string; scope: string }[] = [];
    if (schoolDomain) chosen.push({ domain: schoolDomain, scope: 'school' });
    if (districtDomain && districtDomain !== schoolDomain) chosen.push({ domain: districtDomain, scope: 'district' });
    if (orgDomain && orgDomain !== schoolDomain && orgDomain !== districtDomain) {
      chosen.push({ domain: orgDomain, scope: 'org' });
    }

    const confidences = [school?.confidence, org?.confidence, district?.confidence].filter(Boolean) as LookupResult['confidence'][];
    let confidence: LookupResult['confidence'] | '' = '';
    for (const c of confidences) confidence = weaker(confidence, c);

    const notes = [school?.notes, org?.notes, district?.notes].filter(Boolean).join(' | ');
    const website = primary?.website_url ?? '';
    const emails = [school?.extracted_emails, org?.extracted_emails, district?.extracted_emails]
      .filter(Boolean)
      .join('|');

    review.push(
      rowToRecord({
        account_name: account.account_name,
        account_id: account.account_id,
        parent_account: account.parent_account,
        city: account.city,
        state: account.state,
        zip: account.zip,
        skipped: false,
        skip_reason: '',
        website,
        website_title: primary?.website_title ?? '',
        extracted_emails: emails,
        district_domain: districtDomain,
        school_domain: schoolDomain,
        org_domain: orgDomain,
        chosen_domains: chosen.map((c) => c.domain).join('|'),
        scope: chosen.map((c) => c.scope).join('|'),
        confidence,
        notes,
      }),
    );

    const lookupForScope = (scope: string): LookupResult | undefined => {
      if (scope === 'school') return school;
      if (scope === 'district') return district;
      return org;
    };

    for (const item of chosen) {
      const hit = lookupForScope(item.scope);
      const domainConf = hit?.confidence ?? 'ask';
      if (domainConf === 'high' || domainConf === 'medium') {
        addDomain(item.domain, account.account_name, item.scope, domainConf, hit?.notes ?? '');
      }
    }

    const isAsk = confidence === 'ask' || chosen.length === 0;
    if (isAsk) {
      askRows.push(
        rowToRecord({
          account_name: account.account_name,
          parent_account: account.parent_account,
          city: account.city,
          state: account.state,
          website,
          extracted_emails: emails,
          candidate_domains:
            chosen.map((c) => c.domain).join('|') ||
            [districtDomain, schoolDomain, orgDomain].filter(Boolean).join('|'),
          reason: chosen.length === 0 ? 'no_domain' : notes.includes('mega_district') ? 'mega_district' : 'needs_review',
          notes,
        }),
      );
    }
  }

  const unique = [...domainAgg.entries()]
    .filter(([, v]) => v.confidence === 'high' || v.confidence === 'medium')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, v]) =>
      rowToRecord({
        domain,
        type: 'domain',
        source_accounts: [...v.accounts].sort().join('|'),
        scope: [...v.scopes].sort().join('|'),
        confidence: v.confidence,
        notes: [...v.notes].join(' | '),
      }),
    );

  writeCsv(join(runDir, 'row_review.csv'), review, ROW_REVIEW_COLUMNS);
  writeCsv(join(runDir, 'unique_domains.csv'), unique, UNIQUE_DOMAIN_COLUMNS);
  writeCsv(join(runDir, 'ask_queue.csv'), askRows, ASK_QUEUE_COLUMNS);
  writeJson(join(runDir, 'merge_summary.json'), {
    review_rows: review.length,
    unique_domains: unique.length,
    ask_queue: askRows.length,
  });
  console.error(
    `[merge] review=${review.length} unique_domains=${unique.length} ask=${askRows.length}`,
  );
  return { review: review.length, uniqueHighMedium: unique.length, ask: askRows.length };
}
