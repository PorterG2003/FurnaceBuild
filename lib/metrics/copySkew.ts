import { MIN_RATE_DENOMINATOR } from './lowVolume';

export type CopySkewWarningCode =
  | 'low_volume'
  | 'one_email'
  | 'concentrated_campaign'
  | 'mixed_sequence_positions';

export interface CopySkewWarning {
  code: CopySkewWarningCode;
  label: string;
  detail: string;
}

export interface CopyStatsForSkew {
  sent: number;
  positive_reply: number;
  distinct_contents: number;
  distinct_nodes: number;
  top_campaign_sent: number;
}

export function copySkewWarnings(row: CopyStatsForSkew): CopySkewWarning[] {
  const warnings: CopySkewWarning[] = [];
  if (row.sent < MIN_RATE_DENOMINATOR) {
    warnings.push({
      code: 'low_volume',
      label: 'Low volume',
      detail: `Fewer than ${MIN_RATE_DENOMINATOR} sends; compare counts, not percentages.`,
    });
  }
  if (row.distinct_contents === 1) {
    warnings.push({
      code: 'one_email',
      label: 'One email',
      detail: 'This piece only appears in one distinct email, so other copy may explain the result.',
    });
  }
  if (row.sent > 0 && row.top_campaign_sent / row.sent >= 0.8) {
    warnings.push({
      code: 'concentrated_campaign',
      label: 'Campaign-heavy',
      detail: 'At least 80% of sends came from one campaign.',
    });
  }
  if (row.distinct_nodes > 1) {
    warnings.push({
      code: 'mixed_sequence_positions',
      label: 'Mixed steps',
      detail: 'This piece appears at multiple sequence positions with different baseline reply rates.',
    });
  }
  return warnings;
}

export function compareCopyStatsReliability(
  a: CopyStatsForSkew,
  b: CopyStatsForSkew,
): number {
  const aReliable = a.sent >= MIN_RATE_DENOMINATOR;
  const bReliable = b.sent >= MIN_RATE_DENOMINATOR;
  if (aReliable !== bReliable) return aReliable ? -1 : 1;
  if (aReliable && bReliable) {
    const aRate = a.sent > 0 ? a.positive_reply / a.sent : 0;
    const bRate = b.sent > 0 ? b.positive_reply / b.sent : 0;
    if (aRate !== bRate) return bRate - aRate;
  }
  return b.sent - a.sent;
}
