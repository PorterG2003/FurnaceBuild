/** Collapse whitespace, uppercase, strip most punctuation for fuzzy compare */
export function normalizePersonName(s: string): string {
  return s
    .toUpperCase()
    .replace(/&AMP;/gi, '&')
    .replace(/\s*&\s*/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize business / CSV company string */
export function normalizeBusinessName(s: string): string {
  return normalizePersonName(s)
    .replace(/\b(LLC|L\.L\.C\.|INC|CORP|LTD)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
