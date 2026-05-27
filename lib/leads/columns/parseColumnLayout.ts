import { getCatalogField, getColumnGroupForSourceType, LEADS_COLUMN_GROUPS } from './columnCatalog';
import { DEFAULT_SAVED_LIST_COLUMNS } from './defaults';
import type { LeadsColumnDef, LeadsColumnSourceType } from './types';

export const MAX_COLUMN_LAYOUT_COLUMNS = 64;
export const MAX_COLUMN_LAYOUT_BYTES = 32 * 1024;

const VALID_SOURCE_TYPES = new Set<LeadsColumnSourceType>(LEADS_COLUMN_GROUPS.map((group) => group.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeColumn(raw: unknown): LeadsColumnDef | null {
  if (!isRecord(raw)) return null;
  const sourceType = raw.sourceType;
  if (typeof sourceType !== 'string' || !VALID_SOURCE_TYPES.has(sourceType as LeadsColumnSourceType)) {
    return null;
  }
  const typedSource = sourceType as LeadsColumnSourceType;
  const group = getColumnGroupForSourceType(typedSource);
  if (!group) return null;

  const fieldKey = typeof raw.fieldKey === 'string' ? raw.fieldKey : '';
  const field = getCatalogField(typedSource, fieldKey);
  if (!field) return null;

  const campaignId =
    typeof raw.campaignId === 'string' && raw.campaignId.length > 0 ? raw.campaignId : null;
  if (typedSource === 'membership' && !campaignId) return null;

  const id =
    typeof raw.id === 'string' && raw.id.length > 0
      ? raw.id
      : `${typedSource}-${campaignId ?? 'global'}-${fieldKey}`;

  return {
    id,
    sourceType: typedSource,
    sourceLabel: typeof raw.sourceLabel === 'string' ? raw.sourceLabel : group.label,
    fieldKey,
    label: typeof raw.label === 'string' ? raw.label : field.label,
    visible: raw.visible !== false,
    campaignId: typedSource === 'membership' ? campaignId : null,
    campaignName: typeof raw.campaignName === 'string' ? raw.campaignName : null,
    width: typeof raw.width === 'number' && raw.width > 0 ? raw.width : fieldKey.includes('count') ? 120 : 180,
  };
}

export function parseColumnLayout(raw: unknown): LeadsColumnDef[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_SAVED_LIST_COLUMNS];
  }

  const parsed: LeadsColumnDef[] = [];
  const seenIds = new Set<string>();

  for (const item of raw) {
    const column = normalizeColumn(item);
    if (!column || seenIds.has(column.id)) continue;
    seenIds.add(column.id);
    parsed.push(column);
    if (parsed.length >= MAX_COLUMN_LAYOUT_COLUMNS) break;
  }

  return parsed.length > 0 ? parsed : [...DEFAULT_SAVED_LIST_COLUMNS];
}

export function serializeColumnLayout(columns: LeadsColumnDef[]): string {
  return JSON.stringify(columns);
}

export function assertColumnLayoutWritable(columns: LeadsColumnDef[]): LeadsColumnDef[] {
  const normalized = parseColumnLayout(columns);
  const serialized = serializeColumnLayout(normalized);
  if (serialized.length > MAX_COLUMN_LAYOUT_BYTES) {
    throw new Error('Column layout is too large to save.');
  }
  return normalized;
}

export function columnLayoutKey(column: Pick<LeadsColumnDef, 'sourceType' | 'fieldKey' | 'campaignId'>): string {
  return `${column.sourceType}:${column.campaignId ?? 'global'}:${column.fieldKey}`;
}

export function isColumnAlreadyAdded(
  existing: LeadsColumnDef[],
  candidate: Pick<LeadsColumnDef, 'sourceType' | 'fieldKey' | 'campaignId'>,
): boolean {
  const key = columnLayoutKey(candidate);
  return existing.some((column) => columnLayoutKey(column) === key);
}

export function buildStableColumnId(
  sourceType: LeadsColumnSourceType,
  fieldKey: string,
  campaignId?: string | null,
): string {
  return `${sourceType}-${campaignId ?? 'global'}-${fieldKey}`;
}

export function layoutNeedsReplyActivity(columns: LeadsColumnDef[]): boolean {
  return columns.some(
    (column) =>
      column.visible &&
      column.sourceType === 'membership' &&
      (column.fieldKey === 'reply_category' || column.fieldKey === 'last_activity'),
  );
}
