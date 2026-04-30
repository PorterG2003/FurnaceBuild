/**
 * Best-effort parse of "return on …" dates from OOO auto-reply bodies.
 * Returns null when ambiguous or not found (caller should not prefill).
 */

const MONTH_TOKEN =
  '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function stripQuotedLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');
}

function parseIsoYmd(s: string, ref: Date): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getTime() < ref.getTime() - 86400000 * 365) return null;
  return dt;
}

function parseUsMdY(s: string, ref: Date): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const mo = Number(m[1]) - 1;
  const d = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo, d, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getTime() < ref.getTime() - 86400000 * 365) return null;
  return dt;
}

function monthFromToken(token: string): number | null {
  const monRaw = token.toLowerCase().replace(/\.$/, '').slice(0, 3);
  const month = MONTH_MAP[monRaw];
  return month === undefined ? null : month;
}

function buildUtcNoon(y: number, month: number, day: number): Date | null {
  const dt = new Date(Date.UTC(y, month, day, 12, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseNamedMonthDayYear(monthStr: string, dayStr: string, yearStr: string | undefined, ref: Date): Date | null {
  const month = monthFromToken(monthStr);
  if (month === null) return null;
  const day = Number(dayStr);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  let year: number;
  if (yearStr !== undefined && yearStr !== '') {
    year = Number(yearStr);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  } else {
    year = ref.getUTCFullYear();
  }
  const dt = buildUtcNoon(year, month, day);
  if (!dt) return null;
  if (!yearStr && dt.getTime() < ref.getTime() - 86400000 * 14) {
    return buildUtcNoon(year + 1, month, day);
  }
  return dt;
}

/**
 * @param bodyText - plain text (or stripped) email body
 * @param referenceDate - typically message received_at in UTC
 */
export function parseOutOfOfficeReturnDate(
  bodyText: string | null | undefined,
  referenceDate: Date = new Date()
): Date | null {
  if (!bodyText?.trim()) return null;
  const ref = referenceDate;
  const text = stripQuotedLines(bodyText).replace(/\r\n/g, '\n');

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) {
    const d = parseIsoYmd(iso[1], ref);
    if (d) return d;
  }

  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) {
    const d = parseUsMdY(`${us[1]}/${us[2]}/${us[3]}`, ref);
    if (d) return d;
  }

  const named = text.match(
    new RegExp(`\\b(${MONTH_TOKEN})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i')
  );
  if (named) {
    return parseNamedMonthDayYear(named[1], named[2], named[3], ref);
  }

  const namedNoYear = text.match(
    new RegExp(
      `\\b(?:return|back|available)\\b[^.\\n]{0,80}?\\b(${MONTH_TOKEN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`,
      'i'
    )
  );
  if (namedNoYear) {
    return parseNamedMonthDayYear(namedNoYear[1], namedNoYear[2], undefined, ref);
  }

  return null;
}
