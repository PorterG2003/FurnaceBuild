/**
 * Build Hunter campaign personalization fields from Clay-style tenure strings.
 *
 * Existing leads use:
 *   li_time_in_role = "4 yrs 7 mos"
 *   li_intro_line   = "In your 4 years as Managing Partner"
 *
 * Fallback when years < 1 or duration missing: "As {Title}"
 */

export type LiIntroFields = {
  li_time_in_role: string;
  li_intro_line: string;
  source: 'tenure' | 'fallback';
};

const YEARS_RE = /(\d+)\s*yrs?/i;

/** Parse leading whole years from a duration like "4 yrs 7 mos". */
export function parseDurationYears(duration: string | null | undefined): number | null {
  const raw = (duration || '').trim();
  if (!raw) return null;
  const m = raw.match(YEARS_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function formatLiIntroLine(title: string, duration: string | null | undefined): LiIntroFields {
  const cleanTitle = (title || '').trim() || 'your role';
  const cleanDuration = (duration || '').trim();
  const years = parseDurationYears(cleanDuration);

  if (years == null || years < 1) {
    return {
      li_time_in_role: cleanDuration,
      li_intro_line: `As ${cleanTitle}`,
      source: 'fallback',
    };
  }

  const yearWord = years === 1 ? 'year' : 'years';
  return {
    li_time_in_role: cleanDuration,
    li_intro_line: `In your ${years} ${yearWord} as ${cleanTitle}`,
    source: 'tenure',
  };
}
