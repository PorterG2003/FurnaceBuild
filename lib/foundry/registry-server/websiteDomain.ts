import { canonicalizeWebsiteUrl } from './websiteVerification.js';

const TRACKING_PARAM_RE = /^(utm_|hubs_|gclid$|fbclid$|msclkid$|ref$|source$)/i;
const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})$/i;

export function isObviousInternalHost(host: string | null | undefined): boolean {
  const value = typeof host === 'string' ? host.trim().replace(/\.$/, '').toLowerCase() : '';
  if (!value) return true;
  return (
    PRIVATE_HOST_RE.test(value) ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    value.endsWith('.test')
  );
}

export function registrableDomainKeyFromUrl(raw: string | null | undefined): string | null {
  const url = canonicalizeWebsiteUrl(raw);
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (isObviousInternalHost(hostname)) return null;
    const parts = hostname.split('.').filter(Boolean);
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

export function normalizeWebsiteInputUrl(raw: string | null | undefined): string | null {
  const canonical = canonicalizeWebsiteUrl(raw);
  if (!canonical) return null;
  try {
    const url = new URL(canonical);
    if (isObviousInternalHost(url.hostname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM_RE.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}
