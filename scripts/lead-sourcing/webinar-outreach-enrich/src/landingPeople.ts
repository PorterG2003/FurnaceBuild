/**
 * Extract host/speaker person names from landing-page text.
 */

export type LandingPerson = {
  person_name: string;
  evidence: string;
  source: string;
};

const NAME =
  "((?:[A-Z][a-zA-ZÀ-ÿ]+(?:[-'][A-Z]?[a-zA-ZÀ-ÿ]+)?)(?:\\s+[A-Z][a-zA-ZÀ-ÿ]+(?:[-'][A-Z]?[a-zA-ZÀ-ÿ]+)?){1,2})";

const STOP = `(?=\\s*[,.!]|\\s+(?:for|and|to|at|on|in|with|who|from|helps|is|has)\\b|$)`;

const HOST_PATTERNS: Array<{ re: RegExp; source: string }> = [
  {
    re: new RegExp(
      `\\b(?:hosted by|presented by|featuring|joined by|instructor|facilitated by|led by|taught by|moderated by)\\s+(?:Dr\\.?\\s+)?${NAME}${STOP}`,
      'gi',
    ),
    source: 'host_phrase',
  },
  {
    re: new RegExp(`\\b(?:meet|join)\\s+(?:Dr\\.?\\s+)?${NAME}${STOP}`, 'gi'),
    source: 'meet_join',
  },
  {
    re: new RegExp(
      `\\b(?:speaker|host|presenter|instructor|facilitator|founder|ceo)\\s*[:\\-]\\s*(?:Dr\\.?\\s+)?${NAME}${STOP}`,
      'gi',
    ),
    source: 'role_label',
  },
  {
    re: new RegExp(`\\bwith\\s+(?:Dr\\.?\\s+)?${NAME}(?=\\s*[,.]|\\s+for\\b)`, 'gi'),
    source: 'with_name',
  },
  {
    re: new RegExp(
      `about (?:the )?(?:host|speaker|presenter|instructor)[^\\n.]{0,40}?\\b(?:Dr\\.?\\s+)?${NAME}${STOP}`,
      'gi',
    ),
    source: 'about_host',
  },
];

const JUNK_NAME_RE =
  /^(?:our webinar|free webinar|live webinar|the webinar|learn more|sign up|register now|click here|market research|united states|north america|new york|los angeles|san francisco|join us|save your|reserve your|limited seats|about us|contact us|privacy policy|terms of|cookie policy|industry experts|our newsletter|more purpose|math activities|now learn|host sign|your host|your professor|ross med)$/i;

const JUNK_TOKEN_RE =
  /^(?:your|our|the|host|hosts|speaker|speakers|newsletter|subscribe|learn|more|now|sign|professor|experts|industry|activities|purpose|med|hi|meet|join|free|live|webinar)$/i;

const COMPANY_LIKE_RE =
  /\b(?:inc|llc|ltd|corp|company|group|university|college|foundation|association|institute|agency|services|solutions|media|partners|capital|ventures|consulting)\b/i;

function cleanName(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

export function looksLikePersonName(name: string): boolean {
  const n = cleanName(name);
  if (!n || n.length < 4 || n.length > 60) return false;
  if (JUNK_NAME_RE.test(n)) return false;
  if (COMPANY_LIKE_RE.test(n)) return false;
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return false;
  if (parts.some((p) => p.length < 2)) return false;
  if (parts.some((p) => JUNK_TOKEN_RE.test(p))) return false;
  // Reject ALL CAPS company slogans / mixed shouty tokens
  if (n === n.toUpperCase() && n.length > 12) return false;
  if (parts.some((p) => p.length > 2 && p === p.toUpperCase() && /[A-Z]{3,}/.test(p))) return false;
  return parts.every((p) => /^[A-ZÀ-ÖØ-Þ]/.test(p));
}

/**
 * Extract person candidates from plain landing-page text (and optional JSON-LD blob).
 */
export function extractLandingPeople(
  text: string,
  options: { companyName?: string } = {},
): LandingPerson[] {
  const out: LandingPerson[] = [];
  const seen = new Set<string>();
  const company = (options.companyName || '').trim().toLowerCase();

  const push = (raw: string, evidence: string, source: string) => {
    const person_name = cleanName(raw);
    if (!looksLikePersonName(person_name)) return;
    if (company && person_name.toLowerCase() === company) return;
    const key = person_name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      person_name,
      evidence: evidence.replace(/\s+/g, ' ').trim().slice(0, 160),
      source,
    });
  };

  for (const { re, source } of HOST_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      if (m[1]) push(m[1], m[0] || m[1], source);
    }
  }

  // schema.org Person names in JSON-LD-ish text
  for (const m of text.matchAll(/"@type"\s*:\s*"Person"[^}]{0,400}?"name"\s*:\s*"([^"]{3,60})"/gi)) {
    if (m[1]) push(m[1], m[0], 'json_ld_person');
  }
  for (const m of text.matchAll(/"name"\s*:\s*"([^"]{3,60})"[^}]{0,200}?"@type"\s*:\s*"Person"/gi)) {
    if (m[1]) push(m[1], m[0], 'json_ld_person');
  }

  return out;
}
