import { hostnameOf, hostMatchesCompany } from '../lib/url.js';
import { htmlToText, snippetAround } from '../lib/html.js';
import type { HasSoc2, Soc2Method } from '../lib/types.js';

export const TRUST_LINK_HINT = /\b(trust\s*center|security(?: and privacy)?|privacy)\b/i;

export const TRUST_PATH = /\/(trust|security|privacy)(\/|$|\?)/i;

const SOC2_ATTESTATION =
  /\b((we are|we're)\s+soc\s*2|(is|are)\s+soc\s*2(\s+type)?|our soc\s*2 (report|certification|certificate|type)|download our soc\s*2|soc\s*2 type\s*(i{1,3}|[12])\s+(certified|audited|attested)|soc2 type\s*(i{1,3}|[12])\s+(certified|audited|attested))\b/i;

const SOC2_MENTION = /\bsoc\s*2\b|\bsoc2\b|system and organization controls/i;

const PRODUCT_OR_SERVICE_SOC2 =
  /\b(get soc\s*2|achieve soc\s*2|soc\s*2 in \d+|soc\s*2 automation|help(ing)? (you|clients|customers|companies) .{0,40}soc\s*2|automate(d)? soc\s*2|audit readiness|prep services|compliance consulting|audit concierge|complete our soc\s*2 process)\b/i;

const NOISE_URL =
  /\/(blog|news|p|learn|resources?)(\/|$)|consulting|readiness|prep-service|audit-readiness|\/product\//i;

const THIRD_PARTY_TRUST = /\b(safebase\.us|conveyor\.com|sprung\.com|trustcloud\.ai|safe\.security)\b/i;

export type Soc2Hit = {
  has_soc2: HasSoc2;
  soc2_evidence_url: string;
  soc2_evidence_snippet: string;
  soc2_method: Soc2Method;
};

export function isNoiseSoc2Url(url: string): boolean {
  return NOISE_URL.test(url);
}

export function isTrustLink(href: string, text: string): boolean {
  if (isNoiseSoc2Url(href) || /consulting|readiness|prep/i.test(text)) return false;
  return TRUST_PATH.test(href) || TRUST_LINK_HINT.test(text) || /^trust\./i.test(hostnameOf(href));
}

export function isInSiteOrTrustHost(href: string, companyDomain: string): boolean {
  const host = hostnameOf(href);
  if (!host) return false;
  if (hostMatchesCompany(host, companyDomain)) return true;
  if (host.startsWith('trust.') && host.endsWith(companyDomain.replace(/^www\./, ''))) return true;
  return THIRD_PARTY_TRUST.test(host);
}

function clipSnippet(text: string, re: RegExp): string {
  return snippetAround(text, re, 90).slice(0, 240);
}

function isAttestation(text: string): boolean {
  if (PRODUCT_OR_SERVICE_SOC2.test(text) && !SOC2_ATTESTATION.test(text)) return false;
  return SOC2_ATTESTATION.test(text);
}

export function detectSoc2OnPage(options: {
  html: string;
  url: string;
  method: Extract<Soc2Method, 'homepage' | 'trust_page'>;
}): Soc2Hit | null {
  if (isNoiseSoc2Url(options.url)) return null;
  const text = htmlToText(options.html);
  if (!text) return null;
  if (!isAttestation(text)) return null;
  return {
    has_soc2: 'yes',
    soc2_evidence_url: options.url,
    soc2_evidence_snippet: clipSnippet(text, SOC2_ATTESTATION),
    soc2_method: options.method,
  };
}

export function detectSoc2FromSerper(options: {
  domain: string;
  results: Array<{ title?: string; link?: string; snippet?: string }>;
}): Soc2Hit | null {
  for (const row of options.results) {
    if (row.link && isNoiseSoc2Url(row.link)) continue;
    const blob = `${row.title ?? ''} ${row.snippet ?? ''}`;
    if (!SOC2_MENTION.test(blob) && !/trust center/i.test(blob)) continue;
    if (!isAttestation(blob) && !/download our soc\s*2|trust center/i.test(blob)) continue;
    if (PRODUCT_OR_SERVICE_SOC2.test(blob) && !SOC2_ATTESTATION.test(blob)) continue;
    if (SOC2_ATTESTATION.test(blob) || /download our soc\s*2/i.test(blob)) {
      return {
        has_soc2: 'yes',
        soc2_evidence_url: row.link ?? '',
        soc2_evidence_snippet: clipSnippet(blob, SOC2_ATTESTATION.test(blob) ? SOC2_ATTESTATION : /trust center|soc\s*2/i),
        soc2_method: 'serper',
      };
    }
  }
  return null;
}

export function emptySoc2(has: HasSoc2, method: Soc2Method = 'none'): Soc2Hit {
  return {
    has_soc2: has,
    soc2_evidence_url: '',
    soc2_evidence_snippet: '',
    soc2_method: method,
  };
}
