const OPT_OUT_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\bremove from (?:your |the )?list\b/i,
  /\bstop\s+(?:emailing|emails|email|mail|mailing|contacting|contact|reaching|reach|sending|send)\b/i,
  /\bdo not contact\b/i,
  /\bdon't contact\b/i,
  /\bstop contacting\b/i,
  /\btake me off\b/i,
  /\bno longer contact\b/i,
];

export function isNotInterestedOptOutRequest(params: {
  subject?: string | null;
  bodyText?: string | null;
}): boolean {
  const combined = `${params.subject ?? ''} ${params.bodyText ?? ''}`.trim();
  if (!combined) return false;
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(combined));
}
