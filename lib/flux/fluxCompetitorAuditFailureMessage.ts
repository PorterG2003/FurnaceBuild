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

const OUTCOME_LABEL: Record<FluxAuditDomainOutcome, string> = {
  ok: 'Transparency match + creatives',
  skipped_no_website: 'Skipped (no website)',
  skipped_excluded_self: 'Skipped (excluded)',
  transparency_no_match: 'No Transparency match',
  transparency_zero_creatives: 'No creatives listed',
  timeout: 'Timed out',
  playwright_error: 'Transparency load error',
};

/** One line per domain for support / editor visibility (all scanned candidates). */
export function formatFluxCompetitorAuditDomainDetails(
  rows: FluxAuditDomainResultRow[],
  maxChars = 12_000,
): string {
  const lines = rows.map((r) => {
    const label = OUTCOME_LABEL[r.outcome] ?? r.outcome;
    const bits: string[] = [r.domain, label];
    if (r.outcome === 'ok') {
      bits.push(`${r.creative_count ?? 0} creatives`);
    }
    if (r.message?.trim()) bits.push(r.message.trim());
    const sr = (r as { selected_rank?: number }).selected_rank;
    if (typeof sr === 'number') bits.push(`shown as competitor #${sr}`);
    return bits.join(' · ');
  });
  let body = lines.join('\n');
  if (body.length > maxChars) {
    body = `${body.slice(0, Math.max(0, maxChars - 48))}\n… (truncated; ${rows.length} domains scanned)`;
  }
  return body;
}

function countByOutcome(rows: FluxAuditDomainResultRow[], o: FluxAuditDomainOutcome): number {
  return rows.filter((r) => r.outcome === o).length;
}

/** Message when the audit completes but no domain qualifies for a competitor card (worker: zero winners). */
export function buildFluxCompetitorAuditFailureMessage(rows: FluxAuditDomainResultRow[]): string {
  const timeouts = countByOutcome(rows, 'timeout');
  const playwrightErrors = countByOutcome(rows, 'playwright_error');
  const noMatch = countByOutcome(rows, 'transparency_no_match');
  const zeroCreatives = countByOutcome(rows, 'transparency_zero_creatives');
  const summary: string[] = [
    'No competitor qualified for a published card (each needs a Transparency Center match with at least one visible creative).',
  ];
  if (timeouts > 0) summary.push(`${timeouts} timed out.`);
  if (playwrightErrors > 0) summary.push(`${playwrightErrors} failed while loading Transparency Center.`);
  if (noMatch + zeroCreatives > 0) {
    summary.push(`${noMatch + zeroCreatives} had no Transparency match or no creatives listed.`);
  }
  summary.push('', 'Per domain:', '', formatFluxCompetitorAuditDomainDetails(rows));
  return summary.join('\n');
}
