export type LeadsColumnSourceType = 'person' | 'membership' | 'rollup';

export interface LeadsColumnCatalogField {
  fieldKey: string;
  label: string;
  sourceType: LeadsColumnSourceType;
  description?: string;
}

export interface LeadsColumnGroupDefinition {
  id: LeadsColumnSourceType;
  label: string;
  requiresCampaign?: boolean;
  fields: LeadsColumnCatalogField[];
}

export interface LeadsColumnDef {
  id: string;
  sourceType: LeadsColumnSourceType;
  /** Derived from catalog group label; kept for backward compatibility in persisted layouts. */
  sourceLabel: string;
  fieldKey: string;
  label: string;
  visible: boolean;
  campaignId?: string | null;
  campaignName?: string | null;
  width?: number;
}

export type LeadsCellValue = string | number | boolean | null;

export interface LeadsColumnStat {
  filledCount: number;
  emptyCount: number;
  distinctValueCount: number;
}
