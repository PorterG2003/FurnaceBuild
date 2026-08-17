/**
 * Display cells for campaign detail "Variant performance" rows.
 * Priority (post-categorizer) emails show sent/bounce; replied/interested are N/A.
 */

import { campaignStatPct } from './campaignStatPct';

export type VariantPerfCounts = {
  sent: number;
  replied: number;
  positiveReply: number;
  bounced: number;
};

export type VariantPerfCountCell = { value: number; pct: number };

export type VariantPerfCellValue = VariantPerfCountCell | '—';

export type VariantPerfDisplayCells = {
  sent: number;
  bounced: VariantPerfCountCell;
  replied: VariantPerfCellValue;
  interested: VariantPerfCellValue;
};

export function formatVariantPerfCells(params: {
  priority: boolean;
  counts: VariantPerfCounts;
}): VariantPerfDisplayCells {
  const { priority, counts } = params;
  const bounced: VariantPerfCountCell = {
    value: counts.bounced,
    pct: campaignStatPct(counts.bounced, counts.sent),
  };
  if (priority) {
    return {
      sent: counts.sent,
      bounced,
      replied: '—',
      interested: '—',
    };
  }
  return {
    sent: counts.sent,
    bounced,
    replied: {
      value: counts.replied,
      pct: campaignStatPct(counts.replied, counts.sent),
    },
    interested: {
      value: counts.positiveReply,
      pct: campaignStatPct(counts.positiveReply, counts.replied),
    },
  };
}
