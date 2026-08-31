export const US_STATE_NAMES: Record<string, string> = {
  AL: 'alabama',
  AK: 'alaska',
  AZ: 'arizona',
  AR: 'arkansas',
  CA: 'california',
  CO: 'colorado',
  CT: 'connecticut',
  DC: 'district of columbia',
  DE: 'delaware',
  FL: 'florida',
  GA: 'georgia',
  HI: 'hawaii',
  ID: 'idaho',
  IL: 'illinois',
  IN: 'indiana',
  IA: 'iowa',
  KS: 'kansas',
  KY: 'kentucky',
  LA: 'louisiana',
  ME: 'maine',
  MD: 'maryland',
  MA: 'massachusetts',
  MI: 'michigan',
  MN: 'minnesota',
  MS: 'mississippi',
  MO: 'missouri',
  MT: 'montana',
  NE: 'nebraska',
  NV: 'nevada',
  NH: 'new hampshire',
  NJ: 'new jersey',
  NM: 'new mexico',
  NY: 'new york',
  NC: 'north carolina',
  ND: 'north dakota',
  OH: 'ohio',
  OK: 'oklahoma',
  OR: 'oregon',
  PA: 'pennsylvania',
  RI: 'rhode island',
  SC: 'south carolina',
  SD: 'south dakota',
  TN: 'tennessee',
  TX: 'texas',
  UT: 'utah',
  VT: 'vermont',
  VA: 'virginia',
  WA: 'washington',
  WV: 'west virginia',
  WI: 'wisconsin',
  WY: 'wyoming',
};

const VAGUE_PARENTS = new Set([
  '',
  'no parent account',
  'state sponsored charter schools (nv)',
  'state sponsored charter schools nv',
]);

const TEST_ACCOUNT_NAMES = new Set(['JP TEST ACCOUNT', 'Test District Account']);

export function normalizeState(state: string): string {
  const raw = state.trim().toUpperCase();
  if (raw.length === 2 && US_STATE_NAMES[raw]) return raw;
  const lower = state.trim().toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [abbr, name] of Object.entries(US_STATE_NAMES)) {
    if (name === lower) return abbr;
  }
  return raw.slice(0, 2);
}

export function parseMoney(value: string): number {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function csvField(row: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    if (row[name] != null && String(row[name]).trim()) return String(row[name]).trim();
  }
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.replace(/^\ufeff/, '').trim().toLowerCase(), v]),
  );
  for (const name of names) {
    const v = lower[name.replace(/^\ufeff/, '').trim().toLowerCase()];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

export function isTestAccount(name: string): boolean {
  const n = name.trim();
  if (TEST_ACCOUNT_NAMES.has(n)) return true;
  return /\btest account\b/i.test(n);
}

export function isVagueParent(parent: string, accountName: string): boolean {
  const p = parent.trim().toLowerCase();
  if (VAGUE_PARENTS.has(p)) return true;
  const parentKey = tokenize(parent).join(' ');
  const accountKey = tokenize(accountName).join(' ');
  return Boolean(parentKey && accountKey && parentKey === accountKey);
}

export function looksLikeDistrictName(name: string): boolean {
  return /\b(unified|usd|isd|cisd|esd|uesd|jusd|boces|district|public schools|department of education|county schools)\b/i.test(
    name,
  );
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function tokenize(name: string): string[] {
  return collapseSpaces(name.toLowerCase().replace(/[^a-z0-9]+/g, ' '))
    .split(' ')
    .filter(Boolean);
}

/**
 * Expand CRM / NCES abbreviations then drop legal-suffix noise so
 * "Montebello USD" and "MONTEBELLO UNIFIED" share a canonical key.
 */
export function canonicalDistrictName(name: string, state?: string): string {
  let s = name.toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/#\s*\d+/g, ' ');
  s = s.replace(/\(\s*\d+\s*\)/g, ' ');
  s = s.replace(/\(\s*[a-z]{2}\s*\)/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = collapseSpaces(s);

  const replacements: Array<[RegExp, string]> = [
    [/\bjoint union elementary school district\b/g, 'union elementary'],
    [/\bjoint unified school district\b/g, 'unified'],
    [/\bunion elementary school district\b/g, 'union elementary'],
    [/\belementary school district\b/g, 'elementary'],
    [/\bunified school district\b/g, 'unified'],
    [/\bindependent school district\b/g, 'independent'],
    [/\bconsolidated independent school district\b/g, 'independent'],
    [/\bpublic school district\b/g, 'schools'],
    [/\bschool district\b/g, 'schools'],
    [/\bpublic schools\b/g, 'schools'],
    [/\bcounty schools\b/g, 'county'],
    [/\bcounty school\b/g, 'county'],
    [/\bdepartment of education\b/g, 'doe'],
    [/\bjuesd\b/g, 'union elementary'],
    [/\buesd\b/g, 'union elementary'],
    [/\besd\b/g, 'elementary'],
    [/\bjusd\b/g, 'unified'],
    [/\busd\b/g, 'unified'],
    [/\bcisd\b/g, 'independent'],
    [/\bisd\b/g, 'independent'],
    [/\bpsd\b/g, 'schools'],
    [/\bsd\b/g, 'schools'],
    [/\bunified district\b/g, 'unified'],
    [/\belementary district\b/g, 'elementary'],
    [/\bcharter district\b/g, 'charter'],
    [/\bcharter school\b/g, 'charter'],
    [/\bcharter schools\b/g, 'charter'],
  ];
  for (const [re, to] of replacements) s = s.replace(re, to);

  if (state) {
    const abbr = normalizeState(state).toLowerCase();
    const full = US_STATE_NAMES[abbr.toUpperCase()];
    if (abbr.length === 2) s = s.replace(new RegExp(`\\b${abbr}\\b$`), '');
    if (full) s = s.replace(new RegExp(`\\b${full}\\b$`), '');
  }

  s = s.replace(/\bno\s*\d+\s*[a-z]*\b/g, ' ');
  s = s.replace(/\bre\s*\d+\s*[a-z]*\b/g, ' ');
  s = s.replace(/\bdistrict\b/g, ' ');
  s = s.replace(/\bschools?\b/g, ' ');
  s = s.replace(/\bthe\b/g, ' ');
  s = s.replace(/\bof\b/g, ' ');
  s = collapseSpaces(s);
  s = s.replace(/\bunified unified\b/g, 'unified');
  s = s.replace(/\belementary elementary\b/g, 'elementary');
  return collapseSpaces(s);
}

export function overrideKey(name: string, state: string): string {
  return `${canonicalDistrictName(name, state)}|${normalizeState(state)}`;
}

export function tokenSet(name: string, state?: string): Set<string> {
  return new Set(canonicalDistrictName(name, state).split(' ').filter(Boolean));
}

/** Drop grade-span / county legal words so Palmdale SD ≈ Palmdale Elementary and Broward County PS ≈ BROWARD. */
export function bareDistrictName(name: string, state?: string): string {
  return canonicalDistrictName(name, state)
    .replace(/\b(elementary|unified|independent|union|joint|high|secondary|charter|county|public)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function zip5(zip: string): string {
  const digits = zip.replace(/\D/g, '');
  return digits.slice(0, 5);
}

export function normalizeCity(city: string): string {
  return collapseSpaces(city.toLowerCase().replace(/[^a-z0-9]+/g, ' '));
}
