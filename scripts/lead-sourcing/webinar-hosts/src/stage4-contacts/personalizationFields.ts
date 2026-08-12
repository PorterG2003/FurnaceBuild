/**
 * Deterministic personalization fields for Aug 13 invite templates.
 * No LLM — lookup / allowlist only.
 */

export const ROLE_LINE_BY_TIER: Record<string, string> = {
  webinar_fill: "since you're on the hook for filling seats, ",
  poster: "as you're putting these on, ",
  pipeline: 'if pipeline from these events matters, ',
  executive: '',
};

/** Industries that read cleanly as "…ClickFunnels in marketing tend…" */
const INDUSTRY_LINE_MAP: Array<{ match: RegExp; line: string }> = [
  { match: /marketing|advertising|advertising/i, line: ' in marketing' },
  { match: /e-?learning|education|training|coaching/i, line: ' in training & education' },
  { match: /information technology|software|computer|saas/i, line: ' in software' },
  { match: /health|wellness|fitness|medical/i, line: ' in health & wellness' },
  { match: /financial|fintech|banking|insurance/i, line: ' in financial services' },
  { match: /real estate/i, line: ' in real estate' },
  { match: /management consulting|consulting/i, line: ' in consulting' },
  { match: /professional training/i, line: ' in training' },
];

export function roleLineFromTier(tier: string | null | undefined): string {
  const key = (tier || '').trim().toLowerCase();
  if (key in ROLE_LINE_BY_TIER) return ROLE_LINE_BY_TIER[key]!;
  return '';
}

export function industryLineFromIndustry(industry: string | null | undefined): string {
  const raw = (industry || '').trim();
  if (!raw) return '';
  for (const entry of INDUSTRY_LINE_MAP) {
    if (entry.match.test(raw)) return entry.line;
  }
  return '';
}
