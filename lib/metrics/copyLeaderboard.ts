import {
  COPY_PIECE_KINDS,
  COPY_PIECE_KIND_LABELS,
  type CopyPieceKind,
} from '../copy/kinds';
import type { AccountCopyStatRow } from '../supabase/services/campaigns/account-copy-stats-rpc-map';
import { hasReliableRate } from './lowVolume';
import { compareCopyStatsReliability } from './copySkew';

export interface CopyLeaderboardGroup {
  kind: CopyPieceKind;
  label: string;
  rows: AccountCopyStatRow[];
  pieceCount: number;
  totalSent: number;
  /** Best interested-per-send rate across rows with reliable volume; used to scale bars. */
  bestInterestedPerSend: number;
}

export interface CopyStatCellValue {
  count: number;
  pct: number | null;
  reliable: boolean;
}

/**
 * Groups rows by kind in COPY_PIECE_KINDS order, drops empty kinds,
 * and sorts rows within each kind by reliability-aware ranking.
 */
export function groupCopyStatsByKind(
  rows: AccountCopyStatRow[],
): CopyLeaderboardGroup[] {
  const byKind = new Map<CopyPieceKind, AccountCopyStatRow[]>();
  for (const row of rows) {
    let group = byKind.get(row.kind);
    if (!group) {
      group = [];
      byKind.set(row.kind, group);
    }
    group.push(row);
  }

  const groups: CopyLeaderboardGroup[] = [];
  for (const kind of COPY_PIECE_KINDS) {
    const kindRows = byKind.get(kind);
    if (!kindRows || kindRows.length === 0) continue;

    kindRows.sort(compareCopyStatsReliability);

    let bestRate = 0;
    for (const row of kindRows) {
      if (row.sent > 0 && hasReliableRate(row.sent)) {
        const rate = row.positive_reply / row.sent;
        if (rate > bestRate) bestRate = rate;
      }
    }

    groups.push({
      kind,
      label: COPY_PIECE_KIND_LABELS[kind],
      rows: kindRows,
      pieceCount: kindRows.length,
      totalSent: kindRows.reduce((sum, r) => sum + r.sent, 0),
      bestInterestedPerSend: bestRate,
    });
  }

  return groups;
}

/**
 * Format a stat cell: count, percentage (null when denominator <= 0),
 * and whether the denominator is large enough for the rate to be reliable.
 */
export function copyStatCell(
  numerator: number,
  denominator: number,
): CopyStatCellValue {
  return {
    count: numerator,
    pct: denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null,
    reliable: hasReliableRate(denominator),
  };
}

/** Two-decimal percent for copy-stat rate columns; em dash when there is no denominator. */
export function formatCopyStatPct(pct: number | null): string {
  if (pct == null) return '—';
  return `${pct.toFixed(2)}%`;
}

/**
 * Fraction [0, 1] for the interested-per-send bar, scaled to the group best.
 * Returns 0 when there is no group best or the row has zero sends.
 */
export function leaderboardBarFraction(
  row: AccountCopyStatRow,
  group: CopyLeaderboardGroup,
): number {
  if (group.bestInterestedPerSend <= 0 || row.sent <= 0) return 0;
  const rate = row.positive_reply / row.sent;
  const fraction = rate / group.bestInterestedPerSend;
  return Math.min(Math.max(fraction, 0), 1);
}
