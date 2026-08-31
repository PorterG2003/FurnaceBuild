import {
  canonicalDistrictName,
  csvField,
  isTestAccount,
  isVagueParent,
  looksLikeDistrictName,
  normalizeCity,
  normalizeState,
  parseMoney,
  zip5,
} from './names.js';
import type { WonAccountRow, WonDistrict } from './types.js';

export function parseWonAccountRow(row: Record<string, string>): WonAccountRow {
  return {
    account_name: csvField(row, 'Account Name'),
    account_id: csvField(row, 'Account ID'),
    parent_account: csvField(row, 'Parent Account'),
    revenue: parseMoney(csvField(row, ' Closed-Won Total ', 'Closed-Won Total')),
    city: csvField(row, 'Billing City'),
    state: normalizeState(csvField(row, 'Billing State')),
    zip: zip5(csvField(row, 'Billing ZIP')),
    street: csvField(row, 'Billing Street'),
  };
}

export function parseAvoidAccountRow(row: Record<string, string>): WonAccountRow {
  return {
    account_name: csvField(row, 'Account Name'),
    account_id: csvField(row, 'Account ID'),
    parent_account: csvField(row, 'Parent Account'),
    revenue: parseMoney(csvField(row, ' Open Pipeline Total ', 'Open Pipeline Total')),
    city: csvField(row, 'Billing City'),
    state: normalizeState(csvField(row, 'Billing State')),
    zip: zip5(csvField(row, 'Billing ZIP')),
    street: csvField(row, 'Billing Street'),
  };
}

export function isNycSubunit(name: string): boolean {
  return /new york city geographic district|nyc geographic district|new york city district\s*#?\s*75|district\s*#?\s*75\s*\(special/i.test(
    name,
  );
}

export function isCharterName(name: string): boolean {
  return /\bcharter\b/i.test(name);
}

export function districtNameForAccount(account: WonAccountRow): string {
  if (isVagueParent(account.parent_account, account.account_name)) {
    return account.account_name;
  }
  if (looksLikeDistrictName(account.parent_account) || account.parent_account.trim()) {
    return account.parent_account.trim();
  }
  return account.account_name;
}

export function districtKey(name: string, state: string): string {
  return `${canonicalDistrictName(name, state)}|${normalizeState(state)}`;
}

export function rollupDistricts(accounts: WonAccountRow[]): WonDistrict[] {
  const byKey = new Map<string, WonDistrict>();

  for (const account of accounts) {
    if (isTestAccount(account.account_name)) continue;
    const name = districtNameForAccount(account);
    if (!name.trim()) continue;
    const state = account.state || 'XX';
    const key = districtKey(name, state);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        district_key: key,
        district_name: name,
        canonical_name: canonicalDistrictName(name, state),
        state,
        city: normalizeCity(account.city),
        zip: account.zip,
        street: account.street,
        revenue: account.revenue,
        account_count: 1,
        sample_account_ids: account.account_id,
        is_charter: isCharterName(name) || isCharterName(account.account_name),
        is_nyc_subunit: isNycSubunit(name) || isNycSubunit(account.account_name),
      });
      continue;
    }
    existing.revenue += account.revenue;
    existing.account_count += 1;
    if (account.account_id) {
      const ids = existing.sample_account_ids ? existing.sample_account_ids.split('|') : [];
      if (ids.length < 5) {
        ids.push(account.account_id);
        existing.sample_account_ids = ids.join('|');
      }
    }
    if (!existing.city && account.city) existing.city = normalizeCity(account.city);
    if (!existing.zip && account.zip) existing.zip = account.zip;
    if (!existing.street && account.street) existing.street = account.street;
    existing.is_charter = existing.is_charter || isCharterName(name) || isCharterName(account.account_name);
    existing.is_nyc_subunit =
      existing.is_nyc_subunit || isNycSubunit(name) || isNycSubunit(account.account_name);
  }

  return [...byKey.values()].sort((a, b) => b.revenue - a.revenue);
}
