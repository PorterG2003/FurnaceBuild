import { hostEqualsOrUnder, hostnameOf, normalizeDomain, stripWww } from './lib/url.js';

export const DIRECTORY_HOSTS = [
  'greatschools.org',
  'nces.ed.gov',
  'niche.com',
  'wikipedia.org',
  'publicschoolreview.com',
  'schooldigger.com',
  'usnews.com',
  'yellowpages.com',
  'mapquest.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'linkedin.com',
  'bing.com',
  'google.com',
  'apple.com',
  'yelp.com',
  'maxpreps.com',
  'hudl.com',
  'athletic.net',
  'cde.ca.gov',
  'caschooldashboard.org',
];

export const VENDOR_CMS_HOSTS = [
  'edlio.com',
  'edlioemail.com',
  'finalsite.net',
  'finalsite.com',
  'schoolmessenger.com',
  'parentlink.net',
  'sites.google.com',
  'googleusercontent.com',
  'weebly.com',
  'wix.com',
  'wixsite.com',
  'squarespace.com',
  'apptegy.net',
  'gabbart.com',
  'schoolinsites.com',
  'catapultk12.com',
  'peachjar.com',
  'smore.com',
  'blackbaud.com',
  'justfoia.com',
  'boarddocs.com',
  'parent.plus',
  'parentsquare.com',
];

export const FREE_MAIL_HOSTS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'live.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
];

function matchesAny(host: string, roots: readonly string[]): boolean {
  const h = stripWww(normalizeDomain(host) || hostnameOf(host));
  if (!h) return false;
  return roots.some((root) => hostEqualsOrUnder(h, root));
}

export function isDirectoryHost(hostOrUrl: string): boolean {
  return matchesAny(hostOrUrl, DIRECTORY_HOSTS);
}

export function isVendorHost(hostOrUrl: string): boolean {
  const h = stripWww(normalizeDomain(hostOrUrl) || hostnameOf(hostOrUrl));
  if (!h) return false;
  if (h === 'sites.google.com' || h.endsWith('.sites.google.com')) return true;
  return matchesAny(h, VENDOR_CMS_HOSTS);
}

export function isFreeMailHost(hostOrUrl: string): boolean {
  return matchesAny(hostOrUrl, FREE_MAIL_HOSTS);
}

export function isJunkSearchHost(hostOrUrl: string): boolean {
  return isDirectoryHost(hostOrUrl);
}

/** Website hostname is fine to scrape but must not become an email/block domain. */
export function isUnusableEmailDomain(hostOrUrl: string): boolean {
  return isVendorHost(hostOrUrl) || isFreeMailHost(hostOrUrl) || isDirectoryHost(hostOrUrl);
}
