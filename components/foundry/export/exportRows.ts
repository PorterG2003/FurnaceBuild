import type {
  ExportCompanyChainPeopleRow,
  ExportCompanyOwnerLeadRow,
  ExportCompanySummaryRow,
} from '@/lib/foundry/registry-types';

export type ExportDataMode = 'owner_rows' | 'chain_people' | 'company_summary';

export interface ExportRow {
  row_key: string;
  data_mode: ExportDataMode;
  company_id: string;
  company_name: string;
  normalized_key: string | null;
  company_notes: string | null;
  company_updated_at: string | null;
  linked_source_count: number | null;
  company_entity_match_id: string;
  registry_state: string;
  match_score: number | string | null;
  match_updated_at: string | null;
  state_entity_id: string | null;
  registry_entity_id: string | null;
  state_entity_legal_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  primary_location_city: string | null;
  primary_location_state: string | null;
  website: string | null;
  has_current_linked_source: boolean;
  has_current_owner: boolean;
  has_open_review_task: boolean;
  has_parse_failure_task: boolean;
  is_export_ready: boolean;
  person_owner_row_id: string | null;
  person_name: string | null;
  person_first_name: string | null;
  person_last_name: string | null;
  person_title_role: string | null;
  effective_at: string | null;
  observed_at: string | null;
  chain_depth: number | null;
  linkage_path: string | null;
  contact_email_1: string | null;
  contact_email_2: string | null;
  contact_email_3: string | null;
  contact_phone_1: string | null;
  contact_phone_1_type: string | null;
  contact_phone_1_is_dnc: boolean | null;
  contact_phone_1_dnc_summary: string | null;
  contact_phone_2: string | null;
  contact_phone_2_type: string | null;
  contact_phone_2_is_dnc: boolean | null;
  contact_phone_2_dnc_summary: string | null;
  contact_phone_3: string | null;
  contact_phone_3_type: string | null;
  contact_phone_3_is_dnc: boolean | null;
  contact_phone_3_dnc_summary: string | null;
  contact_confidence_tier: string | null;
  contact_enrichment_top_score: number | null;
  contact_enrichment_score_margin: number | null;
  contact_enrichment_reason_summary: string | null;
  enrichment_cost_cents: number | null;
  company_enrichment_cost_cents: number | null;
  enrichment_cost_per_row_cents: number | null;
  company_acquisition_cost_cents: number | null;
  acquisition_cost_per_row_cents: number | null;
  total_cost_per_row_cents: number | null;
  company_export_row_count: number | null;
  company_website_verification_cost_cents: number | null;
  company_google_ads_verification_cost_cents: number | null;
  company_import_acquisition_cost_cents: number | null;
  company_registry_acquisition_cost_cents: number | null;
  google_ads_verification_result: string | null;
  google_ads_search_domain: string | null;
  google_ads_matched_advertiser_name: string | null;
  google_ads_advertiser_url: string | null;
  google_ads_latest_ad_last_shown_at: string | null;
  google_ads_verified_at: string | null;
  google_ads_verification_error: string | null;
}

function baseRow(row: Pick<ExportRow, 'row_key' | 'data_mode' | 'company_id' | 'company_name' | 'company_entity_match_id' | 'registry_state'>): ExportRow {
  return {
    ...row,
    normalized_key: null,
    company_notes: null,
    company_updated_at: null,
    linked_source_count: null,
    match_score: null,
    match_updated_at: null,
    state_entity_id: null,
    registry_entity_id: null,
    state_entity_legal_name: null,
    address_line_1: null,
    address_line_2: null,
    address_city: null,
    address_state: null,
    address_postal_code: null,
    address_country: null,
    primary_location_city: null,
    primary_location_state: null,
    website: null,
    has_current_linked_source: false,
    has_current_owner: false,
    has_open_review_task: false,
    has_parse_failure_task: false,
    is_export_ready: false,
    person_owner_row_id: null,
    person_name: null,
    person_first_name: null,
    person_last_name: null,
    person_title_role: null,
    effective_at: null,
    observed_at: null,
    chain_depth: null,
    linkage_path: null,
    contact_email_1: null,
    contact_email_2: null,
    contact_email_3: null,
    contact_phone_1: null,
    contact_phone_1_type: null,
    contact_phone_1_is_dnc: null,
    contact_phone_1_dnc_summary: null,
    contact_phone_2: null,
    contact_phone_2_type: null,
    contact_phone_2_is_dnc: null,
    contact_phone_2_dnc_summary: null,
    contact_phone_3: null,
    contact_phone_3_type: null,
    contact_phone_3_is_dnc: null,
    contact_phone_3_dnc_summary: null,
    contact_confidence_tier: null,
    contact_enrichment_top_score: null,
    contact_enrichment_score_margin: null,
    contact_enrichment_reason_summary: null,
    enrichment_cost_cents: null,
    company_enrichment_cost_cents: null,
    enrichment_cost_per_row_cents: null,
    company_acquisition_cost_cents: null,
    acquisition_cost_per_row_cents: null,
    total_cost_per_row_cents: null,
    company_export_row_count: null,
    company_website_verification_cost_cents: null,
    company_google_ads_verification_cost_cents: null,
    company_import_acquisition_cost_cents: null,
    company_registry_acquisition_cost_cents: null,
    google_ads_verification_result: null,
    google_ads_search_domain: null,
    google_ads_matched_advertiser_name: null,
    google_ads_advertiser_url: null,
    google_ads_latest_ad_last_shown_at: null,
    google_ads_verified_at: null,
    google_ads_verification_error: null,
  };
}

export function normalizeOwnerLeadRows(rows: ExportCompanyOwnerLeadRow[]): ExportRow[] {
  return rows.map((row) => ({
    ...baseRow({
      row_key: `${row.company_entity_match_id}-${row.entity_owner_id ?? 'no-owner'}`,
      data_mode: 'owner_rows',
      company_id: row.company_id,
      company_name: row.legal_name,
      company_entity_match_id: row.company_entity_match_id,
      registry_state: row.registry_state,
    }),
    normalized_key: row.normalized_key,
    company_notes: row.company_notes,
    company_updated_at: row.company_updated_at,
    linked_source_count: row.linked_source_count,
    match_score: row.match_score,
    match_updated_at: row.match_updated_at,
    state_entity_id: row.state_entity_id,
    registry_entity_id: row.registry_entity_id,
    state_entity_legal_name: row.state_entity_legal_name,
    address_line_1: row.address_line_1,
    address_line_2: row.address_line_2,
    address_city: row.address_city,
    address_state: row.address_state,
    address_postal_code: row.address_postal_code,
    address_country: row.address_country,
    primary_location_city: row.primary_location_city,
    primary_location_state: row.primary_location_state,
    website: row.website,
    has_current_linked_source: row.has_current_linked_source,
    has_current_owner: row.has_current_owner,
    has_open_review_task: row.has_open_review_task,
    has_parse_failure_task: row.has_parse_failure_task,
    is_export_ready: row.is_export_ready,
    person_owner_row_id: row.entity_owner_id,
    person_name: row.owner_name,
    person_title_role: row.title_role,
    effective_at: row.effective_at,
    observed_at: row.observed_at,
    contact_email_1: row.contact_email_1 ?? null,
    contact_email_2: row.contact_email_2 ?? null,
    contact_email_3: row.contact_email_3 ?? null,
    contact_phone_1: row.contact_phone_1 ?? null,
    contact_phone_1_type: row.contact_phone_1_type ?? null,
    contact_phone_1_is_dnc: row.contact_phone_1_is_dnc ?? null,
    contact_phone_1_dnc_summary: row.contact_phone_1_dnc_summary ?? null,
    contact_phone_2: row.contact_phone_2 ?? null,
    contact_phone_2_type: row.contact_phone_2_type ?? null,
    contact_phone_2_is_dnc: row.contact_phone_2_is_dnc ?? null,
    contact_phone_2_dnc_summary: row.contact_phone_2_dnc_summary ?? null,
    contact_phone_3: row.contact_phone_3 ?? null,
    contact_phone_3_type: row.contact_phone_3_type ?? null,
    contact_phone_3_is_dnc: row.contact_phone_3_is_dnc ?? null,
    contact_phone_3_dnc_summary: row.contact_phone_3_dnc_summary ?? null,
    contact_confidence_tier: row.contact_confidence_tier ?? null,
    contact_enrichment_top_score: row.contact_enrichment_top_score ?? null,
    contact_enrichment_score_margin: row.contact_enrichment_score_margin ?? null,
    contact_enrichment_reason_summary: row.contact_enrichment_reason_summary ?? null,
    enrichment_cost_cents: row.enrichment_cost_cents ?? null,
    company_enrichment_cost_cents: row.company_enrichment_cost_cents ?? null,
    enrichment_cost_per_row_cents: row.enrichment_cost_per_row_cents ?? null,
    company_acquisition_cost_cents: row.company_acquisition_cost_cents ?? null,
    acquisition_cost_per_row_cents: row.acquisition_cost_per_row_cents ?? null,
    total_cost_per_row_cents: row.total_cost_per_row_cents ?? null,
    company_export_row_count: row.company_export_row_count ?? null,
    company_website_verification_cost_cents: row.company_website_verification_cost_cents ?? null,
    company_google_ads_verification_cost_cents: row.company_google_ads_verification_cost_cents ?? null,
    company_import_acquisition_cost_cents: row.company_import_acquisition_cost_cents ?? null,
    company_registry_acquisition_cost_cents: row.company_registry_acquisition_cost_cents ?? null,
    google_ads_verification_result: row.google_ads_verification_result ?? null,
    google_ads_search_domain: row.google_ads_search_domain ?? null,
    google_ads_matched_advertiser_name: row.google_ads_matched_advertiser_name ?? null,
    google_ads_advertiser_url: row.google_ads_advertiser_url ?? null,
    google_ads_latest_ad_last_shown_at: row.google_ads_latest_ad_last_shown_at ?? null,
    google_ads_verified_at: row.google_ads_verified_at ?? null,
    google_ads_verification_error: row.google_ads_verification_error ?? null,
  }));
}

export function normalizeChainPeopleRows(rows: ExportCompanyChainPeopleRow[]): ExportRow[] {
  return rows.map((row) => ({
    ...baseRow({
      row_key: `${row.company_entity_match_id}-${row.person_owner_row_id}-${row.linkage_path}`,
      data_mode: 'chain_people',
      company_id: row.company_id,
      company_name: row.company_legal_name,
      company_entity_match_id: row.company_entity_match_id,
      registry_state: row.registry_state,
    }),
    state_entity_id: row.state_entity_id,
    registry_entity_id: row.registry_entity_id,
    state_entity_legal_name: row.state_entity_legal_name,
    address_line_1: row.address_line_1,
    address_line_2: row.address_line_2,
    address_city: row.address_city,
    address_state: row.address_state,
    address_postal_code: row.address_postal_code,
    address_country: row.address_country,
    website: row.website,
    has_current_linked_source: row.has_current_linked_source,
    has_current_owner: row.has_current_owner,
    has_open_review_task: row.has_open_review_task,
    has_parse_failure_task: row.has_parse_failure_task,
    is_export_ready: row.is_export_ready,
    person_owner_row_id: row.person_owner_row_id,
    person_name: row.person_name,
    person_first_name: row.person_first_name,
    person_last_name: row.person_last_name,
    person_title_role: row.person_title_role,
    chain_depth: row.chain_depth,
    linkage_path: row.linkage_path,
    contact_email_1: row.contact_email_1 ?? null,
    contact_email_2: row.contact_email_2 ?? null,
    contact_email_3: row.contact_email_3 ?? null,
    contact_phone_1: row.contact_phone_1 ?? null,
    contact_phone_1_type: row.contact_phone_1_type ?? null,
    contact_phone_1_is_dnc: row.contact_phone_1_is_dnc ?? null,
    contact_phone_1_dnc_summary: row.contact_phone_1_dnc_summary ?? null,
    contact_phone_2: row.contact_phone_2 ?? null,
    contact_phone_2_type: row.contact_phone_2_type ?? null,
    contact_phone_2_is_dnc: row.contact_phone_2_is_dnc ?? null,
    contact_phone_2_dnc_summary: row.contact_phone_2_dnc_summary ?? null,
    contact_phone_3: row.contact_phone_3 ?? null,
    contact_phone_3_type: row.contact_phone_3_type ?? null,
    contact_phone_3_is_dnc: row.contact_phone_3_is_dnc ?? null,
    contact_phone_3_dnc_summary: row.contact_phone_3_dnc_summary ?? null,
    contact_confidence_tier: row.contact_confidence_tier ?? null,
    contact_enrichment_top_score: row.contact_enrichment_top_score ?? null,
    contact_enrichment_score_margin: row.contact_enrichment_score_margin ?? null,
    contact_enrichment_reason_summary: row.contact_enrichment_reason_summary ?? null,
    enrichment_cost_cents: row.enrichment_cost_cents ?? null,
    company_enrichment_cost_cents: row.company_enrichment_cost_cents ?? null,
    enrichment_cost_per_row_cents: row.enrichment_cost_per_row_cents ?? null,
    company_acquisition_cost_cents: row.company_acquisition_cost_cents ?? null,
    acquisition_cost_per_row_cents: row.acquisition_cost_per_row_cents ?? null,
    total_cost_per_row_cents: row.total_cost_per_row_cents ?? null,
    company_export_row_count: row.company_export_row_count ?? null,
    company_website_verification_cost_cents: row.company_website_verification_cost_cents ?? null,
    company_google_ads_verification_cost_cents: row.company_google_ads_verification_cost_cents ?? null,
    company_import_acquisition_cost_cents: row.company_import_acquisition_cost_cents ?? null,
    company_registry_acquisition_cost_cents: row.company_registry_acquisition_cost_cents ?? null,
    google_ads_verification_result: row.google_ads_verification_result ?? null,
    google_ads_search_domain: row.google_ads_search_domain ?? null,
    google_ads_matched_advertiser_name: row.google_ads_matched_advertiser_name ?? null,
    google_ads_advertiser_url: row.google_ads_advertiser_url ?? null,
    google_ads_latest_ad_last_shown_at: row.google_ads_latest_ad_last_shown_at ?? null,
    google_ads_verified_at: row.google_ads_verified_at ?? null,
    google_ads_verification_error: row.google_ads_verification_error ?? null,
  }));
}

export function normalizeCompanySummaryRows(rows: ExportCompanySummaryRow[]): ExportRow[] {
  return rows.map((row) => ({
    ...baseRow({
      row_key: `${row.company_entity_match_id}-company`,
      data_mode: 'company_summary',
      company_id: row.company_id,
      company_name: row.legal_name,
      company_entity_match_id: row.company_entity_match_id,
      registry_state: row.registry_state,
    }),
    normalized_key: row.normalized_key,
    company_notes: row.company_notes,
    company_updated_at: row.company_updated_at,
    linked_source_count: row.linked_source_count,
    match_score: row.match_score,
    match_updated_at: row.match_updated_at,
    state_entity_id: row.state_entity_id,
    registry_entity_id: row.registry_entity_id,
    state_entity_legal_name: row.state_entity_legal_name,
    address_line_1: row.address_line_1,
    address_line_2: row.address_line_2,
    address_city: row.address_city,
    address_state: row.address_state,
    address_postal_code: row.address_postal_code,
    address_country: row.address_country,
    primary_location_city: row.primary_location_city,
    primary_location_state: row.primary_location_state,
    website: row.website,
    has_current_linked_source: row.has_current_linked_source,
    has_current_owner: row.has_current_owner,
    has_open_review_task: row.has_open_review_task,
    has_parse_failure_task: row.has_parse_failure_task,
    is_export_ready: row.is_export_ready,
    enrichment_cost_cents: row.enrichment_cost_cents ?? null,
    company_enrichment_cost_cents: row.company_enrichment_cost_cents ?? null,
    enrichment_cost_per_row_cents: row.enrichment_cost_per_row_cents ?? null,
    company_acquisition_cost_cents: row.company_acquisition_cost_cents ?? null,
    acquisition_cost_per_row_cents: row.acquisition_cost_per_row_cents ?? null,
    total_cost_per_row_cents: row.total_cost_per_row_cents ?? null,
    company_export_row_count: row.company_export_row_count ?? null,
    company_website_verification_cost_cents: row.company_website_verification_cost_cents ?? null,
    company_google_ads_verification_cost_cents: row.company_google_ads_verification_cost_cents ?? null,
    company_import_acquisition_cost_cents: row.company_import_acquisition_cost_cents ?? null,
    company_registry_acquisition_cost_cents: row.company_registry_acquisition_cost_cents ?? null,
    google_ads_verification_result: row.google_ads_verification_result ?? null,
    google_ads_search_domain: row.google_ads_search_domain ?? null,
    google_ads_matched_advertiser_name: row.google_ads_matched_advertiser_name ?? null,
    google_ads_advertiser_url: row.google_ads_advertiser_url ?? null,
    google_ads_latest_ad_last_shown_at: row.google_ads_latest_ad_last_shown_at ?? null,
    google_ads_verified_at: row.google_ads_verified_at ?? null,
    google_ads_verification_error: row.google_ads_verification_error ?? null,
  }));
}
