import { normalizeDomain } from './types.js';

export type AdCopySignals = {
  domains: string[];
  org_aliases: string[];
  best_company_query: string;
  advertiser_looks_person_like: boolean;
  only_generic_urls: boolean;
};

const URL_RE = /(?:https?:\/\/|www\.)[^\s)\]>"']+/gi;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/** Spelled hosts without scheme (incl. ALLCAPS brand.com/path). */
const BARE_HOST_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|co|ai|us|edu|info|biz|app|dev|me|tv|uk|ca|au)\b(?:\/[^\s)\]>"']*)?/gi;

const PRESENTED_BY_RE =
  /\b(?:presented by|hosted by|brought to you by|powered by|in partnership with)\s+([A-Z][A-Za-z0-9&'.,\-\s]{2,60})/g;
const ASSOCIATION_RE =
  /\b((?:the\s+)?Association for [A-Z][A-Za-z0-9&'.,\-\s]{3,50})/g;
const ALLCAPS_BRAND_RE = /(?:^|[\n])\s*([A-Z]{3,}(?:\s+[A-Z0-9&'-]+){0,3})\s*(?:\.|$|\n)/g;

function stripUrlJunk(raw: string): string {
  return raw.replace(/[.,;:!?)]+$/g, '');
}

function looksPersonLike(advertiser: string): boolean {
  const name = advertiser.trim();
  if (!name) return false;
  // Handle "Name - Title" / "Name |" style
  const core = name.split(/[|–—]/)[0]?.trim() || name;
  const parts = core.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return false;
  // Reject obvious orgs
  if (
    /\b(inc|llc|ltd|corp|company|group|university|college|foundation|association|institute|agency|services|solutions|media|health|capital)\b/i.test(
      core,
    )
  ) {
    return false;
  }
  // Two-token Title Case names look person-like
  return parts.every((p) => /^[A-ZÀ-ÖØ-Þ]/.test(p) && p.length <= 14);
}

function cleanAlias(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

function aliasOk(alias: string, advertiser: string): boolean {
  const a = cleanAlias(alias);
  if (a.length < 4 || a.length > 80) return false;
  if (/^(the|our|this|your|free|live|join|with|from|and)$/i.test(a)) return false;
  if (a.toLowerCase() === advertiser.trim().toLowerCase()) return false;
  // Avoid grabbing whole sentences
  if ((a.match(/\s+/g) || []).length > 8) return false;
  return true;
}

/**
 * Extract domains + org aliases from ad creative for domain rediscovery.
 */
export function extractAdCopySignals(input: {
  company_name: string;
  ad_copy?: string;
  ad_headline?: string;
}): AdCopySignals {
  const advertiser = (input.company_name || '').trim();
  const text = `${input.ad_headline || ''}\n${input.ad_copy || ''}`;
  const domains: string[] = [];
  const seenDom = new Set<string>();
  let sawUrlOrEmail = false;
  let sawOnlyGeneric = true;

  const pushDomain = (raw: string) => {
    const d = normalizeDomain(raw);
    const host = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      ?.split('?')[0]
      ?.replace(/\.$/, '');
    if (host) sawUrlOrEmail = true;
    if (d) {
      sawOnlyGeneric = false;
      if (!seenDom.has(d)) {
        seenDom.add(d);
        domains.push(d);
      }
    }
  };

  for (const m of text.matchAll(URL_RE)) {
    pushDomain(stripUrlJunk(m[0]!));
  }
  for (const m of text.matchAll(EMAIL_RE)) {
    const email = m[0]!;
    const host = email.split('@')[1];
    if (host) pushDomain(host);
  }
  for (const m of text.matchAll(BARE_HOST_RE)) {
    pushDomain(stripUrlJunk(m[0]!));
  }

  const aliases: string[] = [];
  const seenAlias = new Set<string>();
  const pushAlias = (raw: string) => {
    const a = cleanAlias(raw);
    if (!aliasOk(a, advertiser)) return;
    const key = a.toLowerCase();
    if (seenAlias.has(key)) return;
    seenAlias.add(key);
    aliases.push(a);
  };

  for (const re of [PRESENTED_BY_RE, ASSOCIATION_RE, ALLCAPS_BRAND_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m[1]) pushAlias(m[1]);
    }
  }

  // Domain hostname stems as soft aliases (genio.co → Genio)
  for (const d of domains) {
    const stem = d.split('.')[0] || '';
    if (stem.length >= 4) {
      pushAlias(stem.charAt(0).toUpperCase() + stem.slice(1));
    }
  }

  const personLike = looksPersonLike(advertiser);
  let best = advertiser;
  if (personLike && aliases.length > 0) {
    // Prefer longer association-style aliases
    best = [...aliases].sort((a, b) => b.length - a.length)[0]!;
  } else if (!advertiser && aliases.length > 0) {
    best = aliases[0]!;
  }

  return {
    domains,
    org_aliases: aliases,
    best_company_query: best || advertiser,
    advertiser_looks_person_like: personLike,
    only_generic_urls: sawUrlOrEmail && sawOnlyGeneric && domains.length === 0,
  };
}
