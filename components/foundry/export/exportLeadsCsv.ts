import { Platform } from 'react-native';
import type { ExportCompanyChainPeopleRow, ExportCompanyOwnerLeadRow } from '@/lib/foundry/registry-types';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type ExportCsvContactOptions = {
  includeContact?: boolean;
  includeContactConfidence?: boolean;
  includeCost?: boolean;
  /** When true, append latest Google Ads verification columns (company-scoped). */
  includeGoogleAdsVerification?: boolean;
};

type ExportCostCsvRow = Pick<
  ExportCompanyOwnerLeadRow,
  | 'enrichment_cost_cents'
  | 'company_enrichment_cost_cents'
  | 'enrichment_cost_per_row_cents'
  | 'company_acquisition_cost_cents'
  | 'acquisition_cost_per_row_cents'
  | 'total_cost_per_row_cents'
  | 'company_export_row_count'
  | 'company_website_verification_cost_cents'
  | 'company_google_ads_verification_cost_cents'
  | 'company_import_acquisition_cost_cents'
  | 'company_registry_acquisition_cost_cents'
>;

const EXPORT_COST_CSV_KEYS = [
  'enrichment_cost_cents',
  'company_enrichment_cost_cents',
  'enrichment_cost_per_row_cents',
  'company_acquisition_cost_cents',
  'acquisition_cost_per_row_cents',
  'total_cost_per_row_cents',
] as const satisfies readonly string[];

const EXPORT_COST_BREAKDOWN_CSV_KEYS = [
  'company_export_row_count',
  'company_website_verification_cost_cents',
  'company_google_ads_verification_cost_cents',
  'company_import_acquisition_cost_cents',
  'company_registry_acquisition_cost_cents',
  'enrichment_cost_breakdown',
  'acquisition_cost_breakdown',
  'total_cost_breakdown',
] as const satisfies readonly string[];

const CSV_HEADER = [
  'company_id',
  'legal_name',
  'normalized_key',
  'company_updated_at',
  'has_current_linked_source',
  'linked_source_count',
  'registry_state',
  'registry_entity_id',
  'state_entity_state',
  'state_entity_legal_name',
  'entity_owner_id',
  'owner_name',
  'title_role',
  'effective_at',
  'observed_at',
  'parser_version',
  'provenance_snapshot_id',
  'address_line_1',
  'address_line_2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'primary_location_city',
  'primary_location_state',
  'website',
  'has_current_owner',
  'has_open_review_task',
  'has_parse_failure_task',
  'is_export_ready',
] as const satisfies readonly string[];

const OWNER_CONTACT_CSV_KEYS = [
  'contact_email_1',
  'contact_email_2',
  'contact_email_3',
  'contact_phone_1',
  'contact_phone_1_type',
  'contact_phone_1_is_dnc',
  'contact_phone_1_dnc_summary',
  'contact_phone_2',
  'contact_phone_2_type',
  'contact_phone_2_is_dnc',
  'contact_phone_2_dnc_summary',
  'contact_phone_3',
  'contact_phone_3_type',
  'contact_phone_3_is_dnc',
  'contact_phone_3_dnc_summary',
] as const satisfies readonly string[];

const OWNER_CONFIDENCE_CSV_KEYS = [
  'contact_confidence_tier',
  'contact_enrichment_top_score',
  'contact_enrichment_score_margin',
  'contact_enrichment_reason_summary',
] as const satisfies readonly string[];

const GOOGLE_ADS_OWNER_CSV_KEYS = [
  'google_ads_verification_result',
  'google_ads_search_domain',
  'google_ads_matched_advertiser_name',
  'google_ads_advertiser_url',
  'google_ads_latest_ad_last_shown_at',
  'google_ads_verified_at',
  'google_ads_verification_error',
] as const satisfies readonly string[];

function costCentsNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatCostCents(value: number | null | undefined): string {
  const n = costCentsNumber(value);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function integerCountOrNull(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

function inferRowCount(
  explicitCount: number | null | undefined,
  companyTotalCents: number | null | undefined,
  perRowCents: number | null | undefined,
): number | null {
  const explicit = integerCountOrNull(explicitCount);
  if (explicit != null) return explicit;

  const total = costCentsNumber(companyTotalCents);
  const perRow = costCentsNumber(perRowCents);
  if (total <= 0 || perRow <= 0) return null;

  const ratio = total / perRow;
  const rounded = Math.round(ratio);
  if (rounded <= 0) return null;
  return Math.abs(ratio - rounded) <= 0.05 ? rounded : null;
}

function formatRowsDivisor(count: number | null): string {
  if (count == null) return '/ unknown rows';
  return `/ ${count} ${count === 1 ? 'row' : 'rows'}`;
}

function formatComponentBreakdown(
  parts: Array<{ label: string; value: number | null | undefined }>,
  total: number | null | undefined,
): string {
  const shown = parts
    .map(({ label, value }) => ({ label, amount: costCentsNumber(value) }))
    .filter((part) => part.amount > 0);
  const shownTotal = shown.reduce((sum, part) => sum + part.amount, 0);
  const totalAmount = costCentsNumber(total);
  const remainder = totalAmount - shownTotal;

  if (shown.length === 0) {
    return totalAmount > 0 ? `unattributed=${formatCostCents(totalAmount)}` : 'none';
  }

  const tokens = shown.map((part) => `${part.label}=${formatCostCents(part.amount)}`);
  if (remainder > 0.00005) tokens.push(`other=${formatCostCents(remainder)}`);
  return tokens.join(' + ');
}

function enrichmentCostBreakdown(row: ExportCostCsvRow): string {
  const rowCount = inferRowCount(
    row.company_export_row_count,
    row.company_enrichment_cost_cents,
    row.enrichment_cost_per_row_cents,
  );
  return [
    `owner_direct=${formatCostCents(row.enrichment_cost_cents)}`,
    `company_total=${formatCostCents(row.company_enrichment_cost_cents)}`,
    `(${formatComponentBreakdown(
      [
        { label: 'website', value: row.company_website_verification_cost_cents },
        { label: 'google_ads', value: row.company_google_ads_verification_cost_cents },
      ],
      row.company_enrichment_cost_cents,
    )})`,
    formatRowsDivisor(rowCount),
    `= ${formatCostCents(row.enrichment_cost_per_row_cents)} per_row`,
  ].join(' ');
}

function acquisitionCostBreakdown(row: ExportCostCsvRow): string {
  const rowCount = inferRowCount(
    row.company_export_row_count,
    row.company_acquisition_cost_cents,
    row.acquisition_cost_per_row_cents,
  );
  return [
    `company_total=${formatCostCents(row.company_acquisition_cost_cents)}`,
    `(${formatComponentBreakdown(
      [
        { label: 'import', value: row.company_import_acquisition_cost_cents },
        { label: 'registry', value: row.company_registry_acquisition_cost_cents },
      ],
      row.company_acquisition_cost_cents,
    )})`,
    formatRowsDivisor(rowCount),
    `= ${formatCostCents(row.acquisition_cost_per_row_cents)} per_row`,
  ].join(' ');
}

function totalCostBreakdown(row: ExportCostCsvRow): string {
  return [
    `${formatCostCents(row.enrichment_cost_cents)}`,
    `+ ${formatCostCents(row.enrichment_cost_per_row_cents)}`,
    `+ ${formatCostCents(row.acquisition_cost_per_row_cents)}`,
    `= ${formatCostCents(row.total_cost_per_row_cents)}`,
  ].join(' ');
}

function csvValueForKey(row: ExportCompanyOwnerLeadRow | ExportCompanyChainPeopleRow, key: string): unknown {
  switch (key) {
    case 'enrichment_cost_breakdown':
      return enrichmentCostBreakdown(row);
    case 'acquisition_cost_breakdown':
      return acquisitionCostBreakdown(row);
    case 'total_cost_breakdown':
      return totalCostBreakdown(row);
    default:
      return (row as unknown as Record<string, unknown>)[key];
  }
}

export function exportCompanyOwnerLeadsToCsv(
  rows: ExportCompanyOwnerLeadRow[],
  opts?: ExportCsvContactOptions,
): string {
  const header: string[] = [...CSV_HEADER];
  if (opts?.includeCost) header.push(...EXPORT_COST_CSV_KEYS, ...EXPORT_COST_BREAKDOWN_CSV_KEYS);
  if (opts?.includeContact) header.push(...OWNER_CONTACT_CSV_KEYS);
  if (opts?.includeContact && opts?.includeContactConfidence) header.push(...OWNER_CONFIDENCE_CSV_KEYS);
  if (opts?.includeGoogleAdsVerification) header.push(...GOOGLE_ADS_OWNER_CSV_KEYS);

  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvCell(csvValueForKey(r, k))).join(','));
  }
  return lines.join('\n');
}

const CHAIN_PEOPLE_CSV_HEADER = [
  'company_id',
  'company_legal_name',
  'company_entity_match_id',
  'registry_state',
  'state_entity_id',
  'registry_entity_id',
  'state_entity_legal_name',
  'address_line_1',
  'address_line_2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'website',
  'person_owner_row_id',
  'person_name',
  'person_first_name',
  'person_last_name',
  'person_title_role',
  'chain_depth',
  'linkage_path',
  'has_current_linked_source',
  'has_current_owner',
  'has_open_review_task',
  'has_parse_failure_task',
  'is_export_ready',
] as const satisfies readonly string[];

const CHAIN_CONTACT_CSV_KEYS = [
  'contact_email_1',
  'contact_email_2',
  'contact_email_3',
  'contact_phone_1',
  'contact_phone_1_type',
  'contact_phone_1_is_dnc',
  'contact_phone_1_dnc_summary',
  'contact_phone_2',
  'contact_phone_2_type',
  'contact_phone_2_is_dnc',
  'contact_phone_2_dnc_summary',
  'contact_phone_3',
  'contact_phone_3_type',
  'contact_phone_3_is_dnc',
  'contact_phone_3_dnc_summary',
] as const satisfies readonly string[];

const CHAIN_CONFIDENCE_CSV_KEYS = [
  'contact_confidence_tier',
  'contact_enrichment_top_score',
  'contact_enrichment_score_margin',
  'contact_enrichment_reason_summary',
] as const satisfies readonly string[];

const GOOGLE_ADS_CHAIN_CSV_KEYS = [
  'google_ads_verification_result',
  'google_ads_search_domain',
  'google_ads_matched_advertiser_name',
  'google_ads_advertiser_url',
  'google_ads_latest_ad_last_shown_at',
  'google_ads_verified_at',
  'google_ads_verification_error',
] as const satisfies readonly string[];

export function exportCompanyChainPeopleToCsv(
  rows: ExportCompanyChainPeopleRow[],
  opts?: ExportCsvContactOptions,
): string {
  const header: string[] = [...CHAIN_PEOPLE_CSV_HEADER];
  if (opts?.includeCost) header.push(...EXPORT_COST_CSV_KEYS, ...EXPORT_COST_BREAKDOWN_CSV_KEYS);
  if (opts?.includeContact) header.push(...CHAIN_CONTACT_CSV_KEYS);
  if (opts?.includeContact && opts?.includeContactConfidence) header.push(...CHAIN_CONFIDENCE_CSV_KEYS);
  if (opts?.includeGoogleAdsVerification) header.push(...GOOGLE_ADS_CHAIN_CSV_KEYS);

  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvCell(csvValueForKey(r, k))).join(','));
  }
  return lines.join('\n');
}

export function downloadCsvOnWeb(filename: string, csv: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
