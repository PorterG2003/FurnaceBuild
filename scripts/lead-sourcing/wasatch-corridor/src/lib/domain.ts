import { parse } from 'tldts';

export const PARKED_OR_SHARED_HOSTS = new Set([
  'wixsite.com',
  'squarespace.com',
  'godaddysites.com',
  'business.site',
]);

export function stripUrlNoise(input: string): string {
  return input.trim().toLowerCase();
}

export function registrableDomain(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const withProto = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  let hostname = '';
  try {
    const url = new URL(withProto);
    hostname = url.hostname;
  } catch {
    hostname = raw.replace(/^https?:\/\//i, '').split('/')[0] ?? '';
  }
  hostname = hostname.replace(/^www\./i, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || !hostname.includes('.')) return null;
  const parsed = parse(hostname);
  const domain = parsed.domain?.toLowerCase() ?? null;
  return domain || hostname;
}

export function isParkedOrSharedHost(domain: string | null | undefined): boolean {
  const d = (domain ?? '').toLowerCase();
  if (!d) return false;
  if (PARKED_OR_SHARED_HOSTS.has(d)) return true;
  for (const host of PARKED_OR_SHARED_HOSTS) {
    if (d === host || d.endsWith(`.${host}`)) return true;
  }
  return false;
}

export function normalizeName(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|corporation|company|plc)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeStreet(street: string | null | undefined): string {
  return (street ?? '')
    .toLowerCase()
    .replace(/\b(suite|ste|unit|apt|#)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameStreetKey(name: string, street: string): string {
  return `${normalizeName(name)}|${normalizeStreet(street)}`;
}

export function companyIdFromDomainOrNameStreet(options: {
  domain: string | null;
  name: string;
  street: string;
}): string {
  if (options.domain && !isParkedOrSharedHost(options.domain)) return `dom:${options.domain}`;
  return `ns:${nameStreetKey(options.name, options.street)}`;
}
