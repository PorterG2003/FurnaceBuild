import {
  isCopyPieceKind,
  type CopyPieceKind,
} from '../../../copy/kinds';

export type CopyStatsGroupBy = 'archetype' | 'piece';

export interface CopyStatsWording {
  piece_id: string;
  raw_text: string;
  display_text: string;
}

export interface AccountCopyStatRow {
  id: string;
  kind: CopyPieceKind;
  name: string;
  description: string | null;
  sent: number;
  replied: number;
  ooo_replied: number;
  positive_reply: number;
  bounce: number;
  campaigns: number;
  distinct_contents: number;
  distinct_nodes: number;
  top_campaign_sent: number;
  wordings: CopyStatsWording[];
  campaign_names: string[];
  node_labels: string[];
}

export interface AccountCopyStats {
  rows: AccountCopyStatRow[];
  attributedSends: number;
  unattributedSends: number;
  copyBacklog: number;
  failedContents: number;
}

type AccountCopyStatsRpcPayload = {
  rows?: unknown;
  attributed_sends?: unknown;
  unattributed_sends?: unknown;
  copy_backlog?: unknown;
  failed_contents?: unknown;
};

function numberValue(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function mapRow(row: Record<string, unknown>): AccountCopyStatRow | null {
  if (!isCopyPieceKind(row.kind)) return null;

  const id = typeof row.id === 'string' ? row.id : '';
  const name = typeof row.name === 'string' ? row.name : '';
  if (!id || !name) return null;

  return {
    id,
    kind: row.kind,
    name,
    description: typeof row.description === 'string' ? row.description : null,
    sent: numberValue(row.sent),
    replied: numberValue(row.replied),
    ooo_replied: numberValue(row.ooo_replied),
    positive_reply: numberValue(row.positive_reply),
    bounce: numberValue(row.bounce),
    campaigns: numberValue(row.campaigns),
    distinct_contents: numberValue(row.distinct_contents),
    distinct_nodes: numberValue(row.distinct_nodes),
    top_campaign_sent: numberValue(row.top_campaign_sent),
    wordings: Array.isArray(row.wordings)
      ? row.wordings
          .filter(
            (item): item is Record<string, unknown> =>
              !!item && typeof item === 'object' && !Array.isArray(item),
          )
          .map((item) => ({
            piece_id: String(item.piece_id ?? ''),
            raw_text: String(item.raw_text ?? ''),
            display_text: String(item.display_text ?? ''),
          }))
          .filter((item) => item.piece_id)
      : [],
    campaign_names: stringArray(row.campaign_names),
    node_labels: stringArray(row.node_labels),
  };
}

export function mapAccountCopyStatsPayload(
  value: unknown,
): AccountCopyStats {
  const payload =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as AccountCopyStatsRpcPayload)
      : {};
  const rows = Array.isArray(payload.rows)
    ? payload.rows
        .filter(
          (row): row is Record<string, unknown> =>
            !!row && typeof row === 'object' && !Array.isArray(row),
        )
        .map(mapRow)
        .filter((row): row is AccountCopyStatRow => row !== null)
    : [];

  return {
    rows,
    attributedSends: numberValue(payload.attributed_sends),
    unattributedSends: numberValue(payload.unattributed_sends),
    copyBacklog: numberValue(payload.copy_backlog),
    failedContents: numberValue(payload.failed_contents),
  };
}
