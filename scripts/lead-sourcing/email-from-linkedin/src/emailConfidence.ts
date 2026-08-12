import { normalizeDomain } from './schoolDomainQuality.js';
import type { EnrichMatchMethod } from './types.js';

export type EmailConfidence = 'high' | 'mid' | 'low';

export type EmailConfidenceInput = {
  email: string;
  company_domain?: string;
  company_name?: string;
  match_method?: EnrichMatchMethod | string;
  title?: string;
  reactor_headline?: string;
};

export type EmailConfidenceResult = {
  confidence: EmailConfidence;
  reasons: string[];
  emailDomain: string;
};

const FREE_MAIL = new Set([
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'live.com',
  'protonmail.com',
  'mail.com',
  'ymail.com',
  'googlemail.com',
]);

/** Directories, job boards, media, agencies — not employer inboxes. */
const JUNK_EMAIL_DOMAINS = new Set([
  'ballotpedia.org',
  'nces.ed.gov',
  'wikipedia.org',
  'linkedin.com',
  'facebook.com',
  'schoolspring.com',
  'indeed.com',
  'vegaajans.com.tr',
  'thebusinessyear.com',
  'districtaid.com',
  'joinlearners.com',
]);

/**
 * Well-known research / private universities that are often wrong matches
 * for K-12 principals (adjunct / alumni / Apollo confusion).
 */
const RESEARCH_UNIVERSITY_DOMAINS = new Set([
  'wisc.edu',
  'utexas.edu',
  'indwes.edu',
  'morgan.edu',
  'umassglobal.edu',
  'nyu.edu',
  'harvard.edu',
  'stanford.edu',
  'columbia.edu',
  'berkeley.edu',
  'ucla.edu',
  'mit.edu',
]);

const ROLE_LOCAL = /^(info|admin|office|contact|support|hello|team|staff|principal|superintendent)$/i;

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return normalizeDomain(email.slice(at + 1));
}

function registrableParts(host: string): string {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  // *.k12.xx.us → keep last 4; otherwise last 2
  if (parts.length >= 4 && parts[parts.length - 3] === 'k12') {
    return parts.slice(-4).join('.');
  }
  return parts.slice(-2).join('.');
}

/** True when hostname looks like a K-12 / school-district employer domain. */
export function isK12EmployerDomain(domain: string): boolean {
  const host = normalizeDomain(domain);
  if (!host || !host.includes('.')) return false;
  if (FREE_MAIL.has(host) || JUNK_EMAIL_DOMAINS.has(host)) return false;
  if (RESEARCH_UNIVERSITY_DOMAINS.has(host)) return false;

  if (/\.k12\.[a-z]{2}\.us$/i.test(host)) return true;
  if (host === 'schools.nyc.gov' || /\.schools\.nyc\.gov$/i.test(host)) return true;
  // school / district / academy / boe / public school system tokens
  if (/school|district|students|publicschool|academy|boe|pss/i.test(host)) return true;
  // k12 / isd / usd / hsd / supervisory union / ps (public schools)
  if (/k12|isd|usd|hsd|nesu|sesu|(^|[.-])ps([.-]|$)/i.test(host) || /ps\.com$/i.test(host)) {
    return true;
  }
  // District number orgs (d300.org) and *sd* school districts (srsd119.ca, vvsd.org)
  if (/^d\d+\./i.test(host) || /sd\d*\./i.test(host) || /sd\.(org|net|com|us|ca)$/i.test(host)) {
    return true;
  }
  if (/hsd\.(org|net|com)$/i.test(host)) return true;
  if (/\b(ccsd|psd|hsd|esd|csd|lasd|ocsb|srsd|vvsd)\d*\b/i.test(host.replace(/[.-]/g, ' '))) {
    return true;
  }
  // Canadian school boards / schools (*.on.ca provincial, *.ca)
  if (/\.(on|bc|ab|sk|mb|qc|ns|nb|nl|pe)\.ca$/i.test(host)) return true;
  if (/\.ca$/i.test(host) && /(school|board|catholic|district|academy|hsd|ssd|sd\d*)/i.test(host)) {
    return true;
  }
  // Any *.ca with sd token (srsd119.ca)
  if (/\.ca$/i.test(host) && /sd/i.test(host)) return true;
  // District .edu (pwcs.edu) — exclude known research universities above
  if (/\.edu$/i.test(host)) return true;
  // Municipal / state education
  if (/\.(us|gov)$/i.test(host) && /(edu|school|district)/i.test(host)) return true;
  // Common district short orgs: *hs.org / *sd.org high schools / districts
  if (/\.(org|net|com)$/i.test(host) && /(hs|ms|es|sd|csd|psd|hsd)(\d*)?(\.|$)/i.test(host)) {
    return true;
  }
  return false;
}

function companyMentionsUniversity(companyName: string, emailHost: string): boolean {
  const company = companyName.toLowerCase();
  if (!company) return false;
  const slug = emailHost.replace(/\.edu$/i, '').replace(/\./g, ' ');
  const tokens = slug.split(/\s+/).filter((t) => t.length > 3);
  return tokens.some((t) => company.includes(t));
}

/**
 * Score email confidence for K-12 campaign use.
 * - high: Apollo/waterfall match on a clear K-12 employer domain
 * - mid: pattern guess on K-12 domain, or Apollo on plausible schoolish domain
 * - low: free mail, directories, research-uni misfires, non-school vendors
 */
export function scoreEmailConfidence(input: EmailConfidenceInput): EmailConfidenceResult {
  const reasons: string[] = [];
  const email = (input.email || '').trim().toLowerCase();
  const host = emailDomain(email);
  const method = (input.match_method || '').trim();
  const companyDomain = input.company_domain ? normalizeDomain(input.company_domain) : '';

  if (!email.includes('@') || !host) {
    return { confidence: 'low', reasons: ['invalid_email'], emailDomain: host };
  }

  const local = email.slice(0, email.indexOf('@'));
  if (ROLE_LOCAL.test(local)) {
    reasons.push('role_local_part');
  }

  if (FREE_MAIL.has(host)) {
    return { confidence: 'low', reasons: [...reasons, 'free_mail'], emailDomain: host };
  }
  if (JUNK_EMAIL_DOMAINS.has(host)) {
    return { confidence: 'low', reasons: [...reasons, 'junk_domain'], emailDomain: host };
  }

  if (RESEARCH_UNIVERSITY_DOMAINS.has(host)) {
    if (!companyMentionsUniversity(input.company_name || '', host)) {
      return {
        confidence: 'low',
        reasons: [...reasons, 'research_university_mismatch'],
        emailDomain: host,
      };
    }
    reasons.push('university_matches_company');
  }

  const k12 = isK12EmployerDomain(host);
  if (!k12) {
    // Soft allow: .org/.net/.edu with schoolish company name and Apollo match
    const schoolishOrg = /\b(school|schools|district|isd|usd|academy|elementary|principal)\b/i.test(
      `${input.company_name || ''} ${input.reactor_headline || ''} ${input.title || ''}`,
    );
    const apolloBacked = ['name', 'waterfall', 'domain_rematch', 'linkedin_url'].includes(method);
    if (apolloBacked && schoolishOrg && /\.(org|net|edu|us|gov)$/i.test(host)) {
      reasons.push('apollo_schoolish_soft_domain');
      return { confidence: 'mid', reasons, emailDomain: host };
    }
    return { confidence: 'low', reasons: [...reasons, 'non_k12_email_domain'], emailDomain: host };
  }

  if (companyDomain && registrableParts(host) !== registrableParts(companyDomain)) {
    // Alias mismatch is common for districts; keep mid/high if both schoolish
    if (isK12EmployerDomain(companyDomain) || !companyDomain) {
      reasons.push('employer_domain_alias');
    } else {
      reasons.push('company_domain_differs');
    }
  }

  if (method === 'pattern_mv') {
    reasons.push('pattern_mv');
    return { confidence: 'mid', reasons, emailDomain: host };
  }

  if (['name', 'waterfall', 'domain_rematch', 'linkedin_url'].includes(method)) {
    reasons.push(`apollo_${method || 'match'}`);
    // Alias note keeps high if email domain itself is solid K-12
    return { confidence: 'high', reasons, emailDomain: host };
  }

  reasons.push('unknown_method');
  return { confidence: 'mid', reasons, emailDomain: host };
}

export function isMidOrHighConfidence(input: EmailConfidenceInput): boolean {
  const { confidence } = scoreEmailConfidence(input);
  return confidence === 'mid' || confidence === 'high';
}
