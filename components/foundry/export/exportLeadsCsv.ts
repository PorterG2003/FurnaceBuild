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

const EXPORT_COST_CSV_KEYS: (keyof ExportCompanyOwnerLeadRow)[] = [
  'enrichment_cost_cents',
  'company_acquisition_cost_cents',
  'acquisition_cost_per_row_cents',
  'total_cost_per_row_cents',
];

const EXPORT_COST_CHAIN_CSV_KEYS: (keyof ExportCompanyChainPeopleRow)[] = [
  'enrichment_cost_cents',
  'company_acquisition_cost_cents',
  'acquisition_cost_per_row_cents',
  'total_cost_per_row_cents',
];

const CSV_HEADER: (keyof ExportCompanyOwnerLeadRow)[] = [
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
];

const OWNER_CONTACT_CSV_KEYS: (keyof ExportCompanyOwnerLeadRow)[] = [
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
];

const OWNER_CONFIDENCE_CSV_KEYS: (keyof ExportCompanyOwnerLeadRow)[] = [
  'contact_confidence_tier',
  'contact_enrichment_top_score',
  'contact_enrichment_score_margin',
  'contact_enrichment_reason_summary',
];

const GOOGLE_ADS_OWNER_CSV_KEYS: (keyof ExportCompanyOwnerLeadRow)[] = [
  'google_ads_verification_result',
  'google_ads_search_domain',
  'google_ads_matched_advertiser_name',
  'google_ads_advertiser_url',
  'google_ads_latest_ad_last_shown_at',
  'google_ads_verified_at',
  'google_ads_verification_error',
];

export function exportCompanyOwnerLeadsToCsv(
  rows: ExportCompanyOwnerLeadRow[],
  opts?: ExportCsvContactOptions,
): string {
  const header = [...CSV_HEADER];
  if (opts?.includeCost) header.push(...EXPORT_COST_CSV_KEYS);
  if (opts?.includeContact) header.push(...OWNER_CONTACT_CSV_KEYS);
  if (opts?.includeContact && opts?.includeContactConfidence) header.push(...OWNER_CONFIDENCE_CSV_KEYS);
  if (opts?.includeGoogleAdsVerification) header.push(...GOOGLE_ADS_OWNER_CSV_KEYS);

  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvCell(r[k])).join(','));
  }
  return lines.join('\n');
}

const CHAIN_PEOPLE_CSV_HEADER: (keyof ExportCompanyChainPeopleRow)[] = [
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
];

const CHAIN_CONTACT_CSV_KEYS: (keyof ExportCompanyChainPeopleRow)[] = [
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
];

const CHAIN_CONFIDENCE_CSV_KEYS: (keyof ExportCompanyChainPeopleRow)[] = [
  'contact_confidence_tier',
  'contact_enrichment_top_score',
  'contact_enrichment_score_margin',
  'contact_enrichment_reason_summary',
];

const GOOGLE_ADS_CHAIN_CSV_KEYS: (keyof ExportCompanyChainPeopleRow)[] = [
  'google_ads_verification_result',
  'google_ads_search_domain',
  'google_ads_matched_advertiser_name',
  'google_ads_advertiser_url',
  'google_ads_latest_ad_last_shown_at',
  'google_ads_verified_at',
  'google_ads_verification_error',
];

export function exportCompanyChainPeopleToCsv(
  rows: ExportCompanyChainPeopleRow[],
  opts?: ExportCsvContactOptions,
): string {
  const header = [...CHAIN_PEOPLE_CSV_HEADER];
  if (opts?.includeCost) header.push(...EXPORT_COST_CHAIN_CSV_KEYS);
  if (opts?.includeContact) header.push(...CHAIN_CONTACT_CSV_KEYS);
  if (opts?.includeContact && opts?.includeContactConfidence) header.push(...CHAIN_CONFIDENCE_CSV_KEYS);
  if (opts?.includeGoogleAdsVerification) header.push(...GOOGLE_ADS_CHAIN_CSV_KEYS);

  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((k) => csvCell(r[k])).join(','));
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
