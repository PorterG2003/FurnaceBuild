export type FluxAuditDomainOutcome =
  | 'ok'
  | 'skipped_no_website'
  | 'skipped_excluded_self'
  | 'transparency_no_match'
  | 'transparency_zero_creatives'
  | 'timeout'
  | 'playwright_error';

export interface FluxAuditDomainResultRow {
  domain: string;
  outcome: FluxAuditDomainOutcome;
  creative_count?: number | null;
  message?: string;
}

function countByOutcome(rows: FluxAuditDomainResultRow[], o: FluxAuditDomainOutcome): number {
  return rows.filter((r) => r.outcome === o).length;
}

/** User-facing summary when fewer than 3 competitors qualify (plan §3b1). */
export function buildFluxCompetitorAuditFailureMessage(rows: FluxAuditDomainResultRow[]): string {
  const okWithAds = rows.filter((r) => r.outcome === 'ok' && (r.creative_count ?? 0) > 0).length;
  const timeouts = countByOutcome(rows, 'timeout');
  const playwrightErrors = countByOutcome(rows, 'playwright_error');
  const noMatch = countByOutcome(rows, 'transparency_no_match');
  const zeroCreatives = countByOutcome(rows, 'transparency_zero_creatives');
  const parts: string[] = [];
  parts.push(
    `${okWithAds} competitor${okWithAds === 1 ? '' : 's'} had visible ads in Google’s Transparency Center.`,
  );
  if (timeouts > 0) parts.push(`${timeouts} timed out.`);
  if (playwrightErrors > 0) parts.push(`${playwrightErrors} failed while loading Transparency Center.`);
  if (noMatch + zeroCreatives > 0) {
    parts.push(`${noMatch + zeroCreatives} had no match or no creatives listed.`);
  }
  parts.push('Need 3 competitors with active ads to publish.');
  return parts.join(' ');
}
