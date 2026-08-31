import { extractLinks, htmlToText } from '../lib/html.js';
import {
  hostnameOf,
  hostMatchesCompany,
  isCePlatformHost,
  isThirdPartyRegistrationHost,
} from '../lib/url.js';
import type { RegistrationKind } from '../lib/types.js';

const REG_HINT = /register|enroll|sign[-_]?up|rsvp|save.?your.?seat|claim.?credit|join.?webinar/i;

export type RegistrationResult = {
  registration_url: string;
  registration_host_domain: string;
  registration_kind: RegistrationKind;
};

export function detectRegistration(html: string, pageUrl: string, companyUrl: string): RegistrationResult {
  const companyHost = hostnameOf(companyUrl) || hostnameOf(pageUrl);
  const links = extractLinks(html, pageUrl);
  const candidates = links.filter((link) => {
    if (isJunkRegistrationUrl(link.href, pageUrl)) return false;
    const host = hostnameOf(link.href);
    return REG_HINT.test(link.href) || REG_HINT.test(link.text) || isThirdPartyRegistrationHost(host);
  });

  const picked = pickBest(candidates, companyHost, pageUrl);
  if (!picked) {
    const formAction = html.match(/<form[^>]*action=["']([^"']+)["']/i)?.[1];
    if (formAction) {
      try {
        const url = new URL(formAction, pageUrl).toString();
        if (!isJunkRegistrationUrl(url, pageUrl)) {
          return classifyRegUrl(url, companyHost);
        }
      } catch {
        // ignore
      }
    }
    if (isThirdPartyRegistrationHost(hostnameOf(pageUrl)) || isCePlatformHost(hostnameOf(pageUrl))) {
      return classifyRegUrl(pageUrl, companyHost);
    }
    return {
      registration_url: '',
      registration_host_domain: '',
      registration_kind: 'unknown',
    };
  }
  return classifyRegUrl(picked, companyHost);
}

function isJunkRegistrationUrl(url: string, pageUrl: string): boolean {
  try {
    const path = new URL(url, pageUrl).pathname.toLowerCase();
    if (/\/search(?:-results)?\/?$/.test(path)) return true;
    if (path.includes('/wp-json/')) return true;
    if (/\/(?:login|signin|cart)\/?$/.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

function pickBest(
  links: Array<{ href: string; text: string }>,
  companyHost: string,
  pageUrl: string,
): string {
  if (links.length === 0) return '';
  const scored = links.map((link) => {
    const host = hostnameOf(link.href);
    let score = 0;
    if (hostMatchesCompany(host, companyHost)) score += 5;
    if (isThirdPartyRegistrationHost(host)) score += 3;
    if (REG_HINT.test(link.text)) score += 2;
    if (REG_HINT.test(link.href)) score += 2;
    if (hostnameOf(link.href) === hostnameOf(pageUrl)) score += 1;
    return { href: link.href, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.href ?? '';
}

function classifyRegUrl(url: string, companyHost: string): RegistrationResult {
  const host = hostnameOf(url);
  let kind: RegistrationKind = 'unknown';
  if (isThirdPartyRegistrationHost(host) || isCePlatformHost(host) || isCePlatformHost(companyHost)) {
    kind = 'third_party';
  } else if (companyHost && hostMatchesCompany(host, companyHost)) {
    kind = 'own_domain';
  } else if (host) {
    kind = 'third_party';
  }
  return {
    registration_url: url,
    registration_host_domain: host,
    registration_kind: kind,
  };
}

export function pageText(html: string): string {
  return htmlToText(html);
}
