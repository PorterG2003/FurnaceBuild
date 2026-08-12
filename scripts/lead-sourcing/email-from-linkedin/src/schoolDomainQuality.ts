import { looksLikeSchoolOrg } from './nameParse.js';

const JUNK_ALWAYS = new Set([
  'linkedin.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'wikipedia.org',
  'vegaajans.com.tr',
  'thebusinessyear.com',
  'principallawpartnership.co.uk',
]);

export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]!
    .split('?')[0]!
    .replace(/\.$/, '');
}

/**
 * Heuristic: is this hostname a plausible school/district email domain?
 * When orgName looks like a school, apply stricter rejection of agency/media junk.
 */
export function isLikelySchoolDomain(domain: string, orgName = ''): boolean {
  const host = normalizeDomain(domain);
  if (!host || !host.includes('.') || host.length < 4) return false;

  for (const junk of JUNK_ALWAYS) {
    if (host === junk || host.endsWith(`.${junk}`)) return false;
  }

  // Strong positives
  if (/\.edu$/i.test(host)) return true;
  if (/\.k12\.[a-z]{2}\.us$/i.test(host)) return true;
  if (/(^|\.)(school|schools|district|students|isd|usd)([.-]|$)/i.test(host)) return true;

  const orgIsSchool = orgName.trim() ? looksLikeSchoolOrg(orgName) : false;

  if (orgIsSchool) {
    // Reject odd ccTLDs without school signal
    if (
      /\.(com\.tr|co\.uk|qc\.ca|com\.au)$/i.test(host) &&
      !/(school|district|edu|k12|isd|usd)/i.test(host)
    ) {
      return false;
    }
    // Prefer education TLDs / schoolish hostnames; reject generic corporate .com
    if (/\.(org|us|gov)$/i.test(host)) return true;
    if (/(school|district|edu|k12|isd|usd|students)/i.test(host)) return true;
    return false;
  }

  // Non-school org (or unknown): allow common corporate TLDs
  return /\.(edu|org|us|gov|com|net)$/i.test(host);
}

export function hostnameFromUrl(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return normalizeDomain(u.hostname);
  } catch {
    return normalizeDomain(url);
  }
}
