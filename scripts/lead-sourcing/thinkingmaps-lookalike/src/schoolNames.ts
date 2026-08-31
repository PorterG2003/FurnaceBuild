import {
  canonicalDistrictName,
  jaccard,
  normalizeCity,
  normalizeState,
  tokenize,
  US_STATE_NAMES,
  zip5,
} from './names.js';
import { hostnameOf } from './lib/url.js';

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function padLeaid(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(7, '0') : '';
}

export function padNcessch(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(12, '0') : '';
}

export function stateFullName(state: string): string {
  const abbr = normalizeState(state);
  const full = US_STATE_NAMES[abbr];
  if (!full) return state.trim();
  return full.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function looksLikeSchoolName(name: string): boolean {
  return /\b(elementary|middle school|\bmiddle\b|junior high|high school|\bhigh\b|intermediate|academy|charter school|primary|magnet|preparatory|\bprep\b|k-?8|k-?12|campus)\b/i.test(
    name,
  );
}

export function canonicalSchoolName(name: string, state?: string): string {
  let s = name.toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/#\s*\d+/g, ' ');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = collapseSpaces(s);

  const replacements: Array<[RegExp, string]> = [
    [/\belementary school\b/g, 'elementary'],
    [/\bmiddle school\b/g, 'middle'],
    [/\bjunior high school\b/g, 'junior high'],
    [/\bjunior high\b/g, 'junior high'],
    [/\bhigh school\b/g, 'high'],
    [/\bintermediate school\b/g, 'intermediate'],
    [/\bprimary school\b/g, 'primary'],
    [/\bcharter school\b/g, 'charter'],
    [/\belem\b/g, 'elementary'],
    [/\bes\b/g, 'elementary'],
    [/\bjhs\b/g, 'junior high'],
    [/\bms\b/g, 'middle'],
    [/\bhs\b/g, 'high'],
    [/\bjr\b/g, 'junior'],
    [/\bpri\b/g, 'primary'],
    [/\bint\b/g, 'intermediate'],
  ];
  for (const [re, to] of replacements) s = s.replace(re, to);

  s = s.replace(/\bschool\b/g, ' ');
  s = s.replace(/\bthe\b/g, ' ');
  s = s.replace(/\bof\b/g, ' ');

  if (state) {
    const abbr = normalizeState(state).toLowerCase();
    const full = US_STATE_NAMES[abbr.toUpperCase()];
    if (abbr.length === 2) s = s.replace(new RegExp(`\\b${abbr}\\b$`), '');
    if (full) s = s.replace(new RegExp(`\\b${full}\\b$`), '');
  }

  return collapseSpaces(s);
}

export function bareSchoolName(name: string, state?: string): string {
  return canonicalSchoolName(name, state)
    .replace(
      /\b(elementary|middle|junior|high|secondary|intermediate|academy|charter|primary|magnet|preparatory|prep|campus)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function usableSchoolHint(hint: string): boolean {
  const value = hint.replace(/^(locations|departments):\s*/i, '').trim();
  if (value.length < 3) return false;
  if (/^[A-Za-z]{2}$/.test(value)) return false;
  if (/phone number/i.test(value)) return false;
  if (/^\+?\d[\d\s().-]{6,}$/.test(value)) return false;
  if (/^central office$/i.test(value)) return false;
  return true;
}

export function schoolHintFromHost(pageUrl: string, districtWebsite = ''): string {
  const host = hostnameOf(pageUrl);
  if (!host) return '';
  if (/\.k12\.[a-z]{2}\.us$/i.test(host) && host.split('.').length <= 4) return '';
  const district = hostnameOf(districtWebsite);
  if (district && host === district) return '';
  if (district && host.endsWith(`.${district}`)) {
    return host.slice(0, -(district.length + 1)).replace(/[-.]/g, ' ');
  }
  const parts = host.split('.');
  if (parts.length >= 3 && !/^(www2?|schools?|district|k12)$/i.test(parts[0] ?? '')) {
    return (parts[0] ?? '').replace(/-/g, ' ');
  }
  return '';
}

export function schoolTokenSet(name: string, state?: string): Set<string> {
  return new Set(canonicalSchoolName(name, state).split(' ').filter(Boolean));
}

export function schoolNameSimilarity(a: string, b: string, state?: string): number {
  return jaccard(schoolTokenSet(a, state), schoolTokenSet(b, state));
}

export function titleCaseCity(city: string): string {
  return normalizeCity(city)
    .split(' ')
    .map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export { canonicalDistrictName, jaccard, normalizeCity, normalizeState, tokenize, zip5 };
