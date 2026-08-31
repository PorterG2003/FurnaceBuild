export type LookupKind = 'district' | 'school' | 'org';

export type AccountRow = {
  account_name: string;
  account_id: string;
  parent_account: string;
  city: string;
  state: string;
  zip: string;
  street: string;
  skipped: boolean;
  skip_reason: string;
  district_lookup_key: string;
  school_lookup_key: string;
  org_lookup_key: string;
};

export type Lookup = {
  lookup_key: string;
  kind: LookupKind;
  name: string;
  city: string;
  state: string;
  mega: boolean;
};

export const TEST_ACCOUNT_NAMES = new Set(['JP TEST ACCOUNT', 'Test District Account']);

const VAGUE_PARENTS = new Set([
  '',
  'no parent account',
  'state sponsored charter schools (nv)',
]);

const MEGA_NAME_RE =
  /los angeles unified|\blausd\b|new york city geographic|hawaii department of education|houston isd|boston public schools|clark county school district|memphis-shelby|metro nashville/i;

export function normalizeOrgKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isTestAccount(name: string): boolean {
  const n = name.trim();
  if (TEST_ACCOUNT_NAMES.has(n)) return true;
  return /\btest account\b/i.test(n);
}

export function isVagueParent(parent: string, accountName: string): boolean {
  const p = parent.trim().toLowerCase();
  if (VAGUE_PARENTS.has(p)) return true;
  const parentKey = normalizeOrgKey(parent);
  const accountKey = normalizeOrgKey(accountName);
  return Boolean(parentKey && accountKey && parentKey === accountKey);
}

export function looksPrivateOrCharter(name: string): boolean {
  return /\b(charter|catholic|christian|episcopal|lutheran|jewish|ptach|parochial|independent school)\b/i.test(
    name,
  ) || /\b(st\.|saint)\b/i.test(name);
}

export function looksLikeDistrictName(name: string): boolean {
  return /\b(unified|usd|isd|cisd|boces|district|public schools|department of education)\b/i.test(
    name,
  );
}

export function isMegaDistrictName(name: string): boolean {
  return MEGA_NAME_RE.test(name);
}

export function isMegaEmailDomain(domain: string): boolean {
  return /^(lausd\.net|schools\.nyc\.gov|houstonisd\.org|bostonpublicschools\.org|hawaiipublicschools\.org|k12\.hi\.us|ccsd\.net|nv\.ccsd\.net|scsk12\.org|mnps\.org)$/i.test(
    domain,
  );
}

export function lookupKey(kind: LookupKind, name: string): string {
  return `${kind}:${normalizeOrgKey(name)}`;
}

export function csvField(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim()) return String(row[name]).trim();
  }
  const lower = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const name of names) {
    const v = lower[name.trim().toLowerCase()];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

export function parseAccountRow(row: Record<string, string>): AccountRow {
  const account_name = csvField(row, 'Account Name');
  const parent_account = csvField(row, 'Parent Account');
  const skipped = isTestAccount(account_name);
  return {
    account_name,
    account_id: csvField(row, 'Account ID'),
    parent_account,
    city: csvField(row, 'Billing City'),
    state: csvField(row, 'Billing State'),
    zip: csvField(row, 'Billing ZIP'),
    street: csvField(row, 'Billing Street'),
    skipped,
    skip_reason: skipped ? 'test_account' : '',
    district_lookup_key: '',
    school_lookup_key: '',
    org_lookup_key: '',
  };
}

export function websiteQuery(lookup: Lookup): string {
  const loc = [lookup.city, lookup.state].filter(Boolean).join(' ');
  const kind =
    lookup.kind === 'district' ? 'official school district website' : 'official school website';
  if (loc) return `"${lookup.name}" ${loc} ${kind}`;
  return `"${lookup.name}" ${kind}`;
}

export function buildLookups(accounts: AccountRow[]): { accounts: AccountRow[]; lookups: Lookup[] } {
  const byKey = new Map<string, Lookup>();

  const add = (kind: LookupKind, name: string, city: string, state: string): string => {
    const trimmed = name.trim();
    if (!trimmed) return '';
    const key = lookupKey(kind, trimmed);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        lookup_key: key,
        kind,
        name: trimmed,
        city,
        state,
        mega: isMegaDistrictName(trimmed),
      });
    } else if (!existing.city && city) {
      existing.city = city;
      existing.state = state || existing.state;
    }
    return key;
  };

  for (const account of accounts) {
    if (account.skipped) continue;
    const vague = isVagueParent(account.parent_account, account.account_name);

    if (!vague) {
      account.district_lookup_key = add(
        'district',
        account.parent_account,
        account.city,
        account.state,
      );
      if (looksPrivateOrCharter(account.account_name)) {
        account.school_lookup_key = add('school', account.account_name, account.city, account.state);
      }
    } else {
      const kind: LookupKind = looksLikeDistrictName(account.account_name) ? 'org' : 'school';
      const key = add(kind, account.account_name, account.city, account.state);
      if (kind === 'org') account.org_lookup_key = key;
      else account.school_lookup_key = key;
    }
  }

  return { accounts, lookups: [...byKey.values()] };
}
