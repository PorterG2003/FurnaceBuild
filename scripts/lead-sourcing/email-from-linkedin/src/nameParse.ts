/** Credentials / titles stripped from LinkedIn display names before first/last split. */
const PREFIX_TITLES = /^(dr\.?|mr\.?|mrs\.?|ms\.?|miss|prof\.?|professor)\s+/i;
const SUFFIX_CREDENTIALS =
  /,?\s*(ed\.?\s*d\.?|ed\.?\s*s\.?|ph\.?\s*d\.?|m\.?\s*ed\.?|m\.?\s*a\.?|m\.?\s*s\.?|mba|jd|esq\.?|caa|lcpc|lpc|ncsp|nbct|cpa|rn|md|do|dds|dnp|fnp|aprn|pe|pmp|shp|aasa|naesp|nassp)(\s*,\s*(ed\.?\s*d\.?|ed\.?\s*s\.?|ph\.?\s*d\.?|m\.?\s*ed\.?|m\.?\s*a\.?|m\.?\s*s\.?|mba|jd|esq\.?|caa|lcpc|lpc|ncsp|nbct|cpa|rn|md|do|dds|dnp|fnp|aprn|pe|pmp|shp|aasa|naesp|nassp))*$/i;
const PAREN_NICKNAME = /\s*\([^)]*\)\s*/g;
const TRAILING_PERIODS = /\.+$/;

export type ParsedName = {
  firstName: string;
  lastName: string;
  raw: string;
};

export type HeadlineHints = {
  title: string;
  organizationName: string;
};

/**
 * Strip honorifics/credentials and split into first + last name.
 * Multi-part last names (hyphenated or spaced) are preserved after the first token.
 */
export function parseReactorName(raw: string): ParsedName {
  let cleaned = raw.trim().replace(PAREN_NICKNAME, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(PREFIX_TITLES, '');
  // Drop trailing credential segments repeatedly
  for (let i = 0; i < 4; i++) {
    const next = cleaned.replace(SUFFIX_CREDENTIALS, '').trim();
    if (next === cleaned) break;
    cleaned = next;
  }
  cleaned = cleaned.replace(/,+\s*$/, '').trim();
  cleaned = cleaned.replace(TRAILING_PERIODS, '').trim();

  // Drop leftover middle initial like "Melissa D" → keep as first name token only when splitting
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: '', lastName: '', raw };
  }
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: '', raw };
  }

  const firstName = parts[0]!;
  // Skip single-letter middle initials
  let lastStart = 1;
  if (parts.length >= 3 && /^[A-Z]\.?$/i.test(parts[1]!)) {
    lastStart = 2;
  }
  const lastName = parts.slice(lastStart).join(' ');
  return { firstName, lastName, raw };
}

export const SCHOOL_ORG_RE =
  /\b(school|schools|districts?|elementary|middle|junior high|high school|academy|charter|isd|usd|public schools|unified|college|university)\b/i;

const TITLE_PREFIX_RE =
  /^(proud\s+)?(assistant\s+|associate\s+|deputy\s+)?(superintendent|principal|dean|director|administrator|head|coordinator|coach|teacher)/i;

/** Title phrases that embed "of" (must not treat following words as org via \bof\b). */
const TITLE_OF_PHRASE_RE =
  /^(dean of students|director of\s+\w+|head of\s+\w+|chief of\s+\w+|office of\s+\w+)/i;

const SHORT_TITLE_RE =
  /^(proud\s+)?(assistant\s+|associate\s+|deputy\s+)?(superintendent|principal|dean of students|dean|director|administrator|head|coordinator|coach|teacher|assistant principal)\b/i;

/**
 * Truncate org at secondary marketing / role clauses without chopping
 * legitimate names like "Muhlenberg School District".
 */
export function cleanOrganizationName(raw: string): string {
  let org = raw.trim();
  // Drop leading quotes / fancy punctuation
  org = org.replace(/^["“”'`]+/, '').trim();
  // Cut at sentence / marketing continuations
  org = org.split(/\.\s+(?:Clifton|President|TEDx|Award|Bestselling|Alumni)/i)[0] ?? org;
  org = org.split(/\s*[|•]\s*/)[0] ?? org;
  // Cut trailing "President: …" style roles glued on
  org = org.replace(/\s+President\s*:.*$/i, '').trim();
  // Drop trailing role noise after a school phrase when separated by colon
  // (keep ", State" suffixes like "Heard County Schools, Georgia")
  org = org.replace(
    /\b((?:Public\s+)?Schools?(?:\s+Districts?)?|School\s+Districts?|High\s+School|Junior\s+High|Elementary\s+School|Middle\s+School|Academy|ISD|USD)\b\s*:.+$/i,
    '$1',
  );
  org = org.replace(/[,;]+$/, '').trim();
  return org.slice(0, 120);
}

export function looksLikeSchoolOrg(name: string): boolean {
  const cleaned = cleanOrganizationName(name);
  if (cleaned.length < 5) return false;
  // Reject pure marketing fragments
  if (/^(dare to|live to|inspire|award|tedx|bestselling)/i.test(cleaned)) return false;
  if (/^students\b/i.test(cleaned) && !SCHOOL_ORG_RE.test(cleaned)) return false;
  return SCHOOL_ORG_RE.test(cleaned);
}

function looksLikeTitle(left: string): boolean {
  const t = left.trim();
  if (!t) return false;
  if (TITLE_PREFIX_RE.test(t) || SHORT_TITLE_RE.test(t) || TITLE_OF_PHRASE_RE.test(t)) return true;
  return t.length <= 50 && !SCHOOL_ORG_RE.test(t);
}

function trySplit(
  title: string,
  organizationName: string,
): HeadlineHints | null {
  const org = cleanOrganizationName(organizationName);
  const tit = title.replace(/[|•/,:\-–—]+$/, '').trim();
  if (org.length < 3) return null;
  if (!looksLikeSchoolOrg(org) && !looksLikeTitle(tit)) return null;
  if (!looksLikeSchoolOrg(org)) return null;
  return { title: tit.slice(0, 120), organizationName: org };
}

/**
 * Extract a rough title + organization from a LinkedIn headline.
 * Examples:
 *   "Superintendent at Heard County Schools, Georgia"
 *   "Principal / Muhlenberg School District"
 *   "Assistant Superintendent, Pittsburgh Public Schools"
 *   "Proud Principal, Highlands Elementary School"
 *   "Principal - Goshen High School"
 *   "Dean of Students Rolling Meadows High School"
 */
export function parseHeadlineHints(headline: string): HeadlineHints {
  const trimmed = headline.trim();
  if (!trimmed) return { title: '', organizationName: '' };

  // Dash / en-dash / em-dash: "Title - School Name"
  const dash = trimmed.match(
    /^(.{2,80}?)\s+[-–—]\s+(.{3,120}?)(?:\s*[|•].*)?$/,
  );
  if (dash?.[1] && dash[2]) {
    const hit = trySplit(dash[1], dash[2]);
    if (hit) return hit;
  }

  // Pipe: "… | Director Mount litera Zee School …" — prefer rightmost school-like segment
  if (trimmed.includes('|')) {
    const parts = trimmed.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]!;
      // "Director Mount litera Zee School Kalaburagi"
      const schoolInPart = part.match(
        /^(?:(?:assistant\s+|associate\s+)?(?:director|principal|superintendent|dean|administrator|head|coordinator)\s+)?(.+)$/i,
      );
      const orgCandidate = schoolInPart?.[1] ?? part;
      if (looksLikeSchoolOrg(orgCandidate)) {
        const title =
          parts
            .slice(0, i)
            .join(' | ')
            .replace(/\s*(?:education leader|speaker|author|consultant)\s*$/i, '')
            .trim() || part.replace(orgCandidate, '').trim() || 'Administrator';
        // Prefer stripping leading role word from org if present
        const roleStrip = part.match(
          /^(?:assistant\s+|associate\s+)?(?:director|principal|superintendent|dean|administrator|head|coordinator)\s+(.+)$/i,
        );
        const org = cleanOrganizationName(roleStrip?.[1] ?? orgCandidate);
        if (looksLikeSchoolOrg(org)) {
          return { title: title.slice(0, 120) || 'Administrator', organizationName: org };
        }
      }
    }
  }

  // Colon: "Title: School" (rare) — only when right side is school-like
  const colon = trimmed.match(/^(.{2,60}?):\s+(.{3,120})$/);
  if (colon?.[1] && colon[2] && looksLikeSchoolOrg(colon[2])) {
    const hit = trySplit(colon[1], colon[2]);
    if (hit) return hit;
  }

  // Explicit "at" / "/" / "@" — require school-like org (or title-like left)
  const atPatterns: RegExp[] = [/\bat\s+(.+)$/i, /\s+\/\s+(.+)$/, /\s+@\s+(.+)$/];
  for (const pattern of atPatterns) {
    const match = trimmed.match(pattern);
    if (match?.[1] && match.index != null) {
      const title = trimmed.slice(0, match.index).replace(/[|•/,]+$/, '').trim();
      const hit = trySplit(title, match[1]);
      if (hit) return hit;
    }
  }

  // "Dean of Students <School Name>" — title phrase + trailing school
  const deanOf = trimmed.match(
    /^(dean of students|director of [a-z]+|head of [a-z]+)\s+(.+)$/i,
  );
  if (deanOf?.[1] && deanOf[2] && looksLikeSchoolOrg(deanOf[2])) {
    return {
      title: deanOf[1].trim(),
      organizationName: cleanOrganizationName(deanOf[2]),
    };
  }

  // Bare "of" only when left looks like a short title AND right is school-like
  // (avoids "Dare to Achieve" / marketing copy)
  const ofMatch = trimmed.match(/^(.{2,50}?)\sof\s+(.+)$/i);
  if (ofMatch?.[1] && ofMatch?.[2]) {
    const left = ofMatch[1].trim();
    if (looksLikeTitle(left) && !TITLE_OF_PHRASE_RE.test(trimmed)) {
      const hit = trySplit(left, ofMatch[2]);
      if (hit) return hit;
    }
  }

  // Comma-style: "Title, School/District Name"
  const comma = trimmed.match(/^([^,|•]{2,80}),\s*([^,|•]{3,120})(?:[,|•].*)?$/);
  if (comma?.[1] && comma[2]) {
    const left = comma[1].trim();
    const right = comma[2].trim();
    if (looksLikeSchoolOrg(right) && (looksLikeTitle(left) || left.length <= 60)) {
      return { title: left, organizationName: cleanOrganizationName(right) };
    }
    if (looksLikeSchoolOrg(left) && !looksLikeSchoolOrg(right)) {
      return { title: right, organizationName: cleanOrganizationName(left) };
    }
  }

  // Title then school name with no separator: "Principal Goshen High School"
  const titleThenSchool = trimmed.match(
    /^((?:proud\s+)?(?:assistant\s+|associate\s+|deputy\s+)?(?:superintendent|principal|dean|director|administrator|assistant principal))\s+(.{5,100})$/i,
  );
  if (titleThenSchool?.[1] && titleThenSchool[2] && looksLikeSchoolOrg(titleThenSchool[2])) {
    return {
      title: titleThenSchool[1].trim(),
      organizationName: cleanOrganizationName(titleThenSchool[2]),
    };
  }

  // Last resort: extract a school-like span from the headline
  const embedded = trimmed.match(
    /\b([A-Z][\w&.''\-\s]{2,80}?\b(?:School Districts?|Public Schools|High School|Junior High|Elementary School|Middle School|Academy|ISD|USD|Unified School District)\b)/,
  );
  if (embedded?.[1] && looksLikeSchoolOrg(embedded[1])) {
    const org = cleanOrganizationName(embedded[1]);
    const title = trimmed.replace(embedded[1], '').replace(/[-–—|,•]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { title: title.slice(0, 120) || 'Administrator', organizationName: org };
  }

  // No clear org separator — treat whole headline as title
  return { title: trimmed.slice(0, 120), organizationName: '' };
}

export function isLinkedInMemberIdUrl(url: string): boolean {
  return /\/in\/ACo[A-Za-z0-9_-]+/i.test(url) || /\/in\/ACw[A-Za-z0-9_-]+/i.test(url);
}
