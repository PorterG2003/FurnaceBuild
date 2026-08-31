export function stripWww(host: string): string {
  return host.replace(/^www\./i, '').toLowerCase();
}

export function hostnameOf(url: string): string {
  try {
    return stripWww(new URL(url).hostname);
  } catch {
    return '';
  }
}

/** Skip junk directory websites (empty host, concatenated URLs, missing scheme). */
export function isFetchableUrl(url: string): boolean {
  const value = url.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\s/.test(value) || /\bAND\b/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function hostMatchesCompany(candidateHost: string, companyHost: string): boolean {
  const a = stripWww(candidateHost);
  const b = stripWww(companyHost);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'];
    for (const key of drop) parsed.searchParams.delete(key);
    let href = parsed.toString();
    if (href.endsWith('/') && parsed.pathname === '/') {
      // keep origin slash
    } else if (href.endsWith('/')) {
      href = href.slice(0, -1);
    }
    return href.replace(/:\/\/www\./i, '://');
  } catch {
    return url.trim();
  }
}

export const THIRD_PARTY_REG_HOSTS = [
  'eventbrite.com',
  'cvent.com',
  'gotowebinar.com',
  'goto.com',
  'zoom.us',
  'on24.com',
  'webex.com',
  'medscape.org',
  'medscape.com',
  'mycme.com',
  'primeinc.org',
  'clinicaloptions.com',
  'livestorm.co',
  'demio.com',
  'bigmarker.com',
];

/** CE platforms that host manufacturer/sponsor courses. Not the prospect. */
export const CE_PLATFORM_HOSTS = [
  'aecdaily.com',
  'greence.com',
  'ronblank.com',
  'hanleywooduniversity.com',
  'hanleywood.com',
  'bluevolt.com',
  'cestrong.com',
  'continuingeducation.bnpmedia.com',
];

export function isThirdPartyRegistrationHost(host: string): boolean {
  const h = stripWww(host);
  return (
    THIRD_PARTY_REG_HOSTS.some((known) => h === known || h.endsWith(`.${known}`)) ||
    isCePlatformHost(h)
  );
}

export function isCePlatformHost(host: string): boolean {
  const h = stripWww(host);
  return CE_PLATFORM_HOSTS.some((known) => h === known || h.endsWith(`.${known}`));
}

/** Directory/registry sites — not the manufacturer's own domain. */
export const DIRECTORY_INDEX_HOSTS = [
  'arcat.com',
  'nasbaregistry.org',
  'nasba.org',
  'aswb.org',
  'webauthor.com',
  'bnpmedia.com',
];

export function isDirectoryIndexHost(host: string): boolean {
  const h = stripWww(host);
  return DIRECTORY_INDEX_HOSTS.some((known) => h === known || h.endsWith(`.${known}`));
}

/** Hosts that must not be used as the company's website for enrichment. */
export function isUnusableProspectHost(host: string): boolean {
  return isThirdPartyRegistrationHost(host) || isDirectoryIndexHost(host);
}

export function hostFromAny(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.includes('://')) return hostnameOf(value);
  return hostnameOf(`https://${value}`);
}
