/**
 * Display cells for campaign detail "Variant performance" rows.
 * Priority (post-categorizer) emails show sent/bounce; replied/interested are N/A.
 */

export type VariantPerfCounts = {
  sent: number;
  replied: number;
  positiveReply: number;
  bounced: number;
};

export type VariantPerfCellValue = number | '—';

export type VariantPerfDisplayCells = {
  sent: number;
  bounced: number;
  replied: VariantPerfCellValue;
  interested: VariantPerfCellValue;
};

export function formatVariantPerfCells(params: {
  priority: boolean;
  counts: VariantPerfCounts;
}): VariantPerfDisplayCells {
  const { priority, counts } = params;
  if (priority) {
    return {
      sent: counts.sent,
      bounced: counts.bounced,
      replied: '—',
      interested: '—',
    };
  }
  return {
    sent: counts.sent,
    bounced: counts.bounced,
    replied: counts.replied,
    interested: counts.positiveReply,
  };
}
