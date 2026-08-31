import type { CompanyRole } from '../lib/types.js';
import { htmlToText } from '../lib/html.js';

export type RoleInput = {
  company_name: string;
  headlines?: string;
  titles?: string;
  homepage_text?: string;
  homepage_title?: string;
};

export type RoleResult = {
  company_role: CompanyRole;
  is_compliance_platform: boolean;
  role_reason: string;
  role_evidence: string;
};

const KNOWN_PLATFORMS =
  /\b(vanta|drata|secureframe|sprinto|scytale|oneleet|delve|anecdotes|thoropass|strike graph|dash complyops|konfirmity|complyjet|complyance|complyancehq|theopenlane|openlane|certpulse|certpulseai|thetrustfabrik|trust fabrik)\b/i;

const PLATFORM_PRODUCT =
  /\b(compliance automation|trust management platform|grc platform|grc software|trust platform|connected grc|continuous control monitoring|automated soc\s*2|soc\s*2 automation|soc 2 in \d+\s*(days?|weeks?)|get soc\s*2 (in|fast)|soc\s*2 in a (day|week))\b/i;

const AUDITOR =
  /\b(cpa firm|audit firm|soc\s*2 auditor|independent auditor|attestation services|we audit|engagement letter|aicpa member|peer review firm|certified public accountants?)\b/i;

const AUDITEE = /\b(soc\s*2 auditee|our auditor|as an auditee)\b/i;

const CONSULTANT =
  /\b(compliance consultant|grc advisory|grc consulting|fractional ciso|virtual ciso|\bvciso\b|security advisor|cybersecurity advisor|trust advisor|compliance sherpa|implementation (partner|services)|advisory (firm|practice)|risk (advisory|consulting)|audit readiness|soc\s*2 prep|certification in \d+\s*weeks)\b/i;

const CONSULTANT_HELP =
  /\b(help(ing)? (you|companies|startups|teams|founders) .{0,40}(soc\s*2|compliance|grc|iso 27001)|i help .{0,40}(soc\s*2|compliance|customer trust))\b/i;

const JOB_TITLE_NOISE =
  /\b(head of compliance|chief compliance|vp of compliance|director of compliance|compliance owner|compliance manager)\b/i;

function firstMatch(re: RegExp, text: string): string {
  const match = text.match(re);
  return match?.[0] ?? '';
}

function clip(text: string, n = 180): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

export function classifyCompanyRole(input: RoleInput): RoleResult {
  const name = input.company_name ?? '';
  const headlines = (input.headlines ?? '').replace(JOB_TITLE_NOISE, ' ');
  const homepage = `${input.homepage_title ?? ''} ${input.homepage_text ?? ''}`.slice(0, 20000);
  const blob = `${name} ${headlines} ${homepage}`;
  // Identity only: homepage copy often names Vanta/Thoropass as a tool or partner.
  const identity = `${name} ${headlines}`;

  const known = firstMatch(KNOWN_PLATFORMS, identity);
  const product = firstMatch(PLATFORM_PRODUCT, blob);
  const auditorHit = !AUDITEE.test(blob) && firstMatch(AUDITOR, blob);
  const consultantHit = firstMatch(CONSULTANT, blob) || firstMatch(CONSULTANT_HELP, blob);

  if (known) {
    return {
      company_role: 'compliance_platform',
      is_compliance_platform: true,
      role_reason: 'known compliance platform name',
      role_evidence: clip(known),
    };
  }

  if (product) {
    return {
      company_role: 'compliance_platform',
      is_compliance_platform: true,
      role_reason: 'sells SOC2/GRC automation product',
      role_evidence: clip(product),
    };
  }

  if (auditorHit) {
    return {
      company_role: 'auditor',
      is_compliance_platform: false,
      role_reason: 'audit/attestation firm signals',
      role_evidence: clip(auditorHit),
    };
  }

  if (/\bcpa\b/i.test(name) && !/\b(software|platform|automation)\b/i.test(blob)) {
    return {
      company_role: 'auditor',
      is_compliance_platform: false,
      role_reason: 'CPA firm name',
      role_evidence: clip(name),
    };
  }

  if (consultantHit) {
    return {
      company_role: 'consultant',
      is_compliance_platform: false,
      role_reason: 'advisory/consulting signals (not a product platform)',
      role_evidence: clip(consultantHit),
    };
  }

  if (/grc/i.test(name) && !/\b(software|platform|automation)\b/i.test(homepage)) {
    return {
      company_role: 'consultant',
      is_compliance_platform: false,
      role_reason: 'GRC in company name without product copy',
      role_evidence: clip(name),
    };
  }

  if (name.trim() || homepage.trim() || headlines.trim()) {
    return {
      company_role: 'prospect',
      is_compliance_platform: false,
      role_reason: 'no compliance-vendor signals',
      role_evidence: clip(name || headlines),
    };
  }

  return {
    company_role: 'unknown',
    is_compliance_platform: false,
    role_reason: 'no company name or copy',
    role_evidence: '',
  };
}

export function classifyFromHtml(
  companyName: string,
  html: string,
  title?: string,
  extra?: { headlines?: string; titles?: string },
): RoleResult {
  return classifyCompanyRole({
    company_name: companyName,
    headlines: extra?.headlines,
    titles: extra?.titles,
    homepage_text: html ? htmlToText(html) : '',
    homepage_title: title,
  });
}
