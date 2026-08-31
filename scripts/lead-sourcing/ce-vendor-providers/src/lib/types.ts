export type EntityClass =
  | 'commercial_vendor'
  | 'education_company'
  | 'institution'
  | 'society'
  | 'unknown';

export type AudienceRelationship = 'customer' | 'partner' | 'unknown';

export type RegistrationKind = 'own_domain' | 'third_party' | 'unknown';

export type CeFormat = 'live_online' | 'in_person' | 'on_demand';

export type CeFormatPrimary = CeFormat | 'unknown';

export type DirectoryEntry = {
  provider_name: string;
  source_directory: string;
  accreditor: string;
  audience_profession: string;
  source_url: string;
  listed_website: string;
};

export type ClassifiedEntry = DirectoryEntry & {
  entity_class: EntityClass;
  company_sells_what: string;
  class_reason: string;
  homepage_url: string;
  audience_relationship: AudienceRelationship;
  has_formal_grant_program: boolean;
};

export type FitRecord = ClassifiedEntry & {
  registration_host_domain: string;
  registration_kind: RegistrationKind;
  registration_url: string;
  is_free: boolean | null;
  self_provided: boolean;
  audience_relationship: AudienceRelationship;
  has_formal_grant_program: boolean;
  ce_page_url: string;
  activity_title: string;
  ce_formats: string;
  primary_ce_format: CeFormatPrimary;
  has_live_online: boolean;
  needs_review: boolean;
  source_kind: 'directory' | 'host_search' | 'grant_search';
};

export type SearchHit = {
  url: string;
  title: string;
  snippet: string;
  search_query: string;
  serp_page: number;
  collected_at: string;
};

export type ExtractedActivity = {
  company_name: string;
  source_kind: 'directory' | 'host_search' | 'grant_search';
  source_url: string;
  page_title: string;
  extract_snippet: string;
  registration_url: string;
  registration_host_domain: string;
  is_free: boolean | null;
  has_formal_grant_program: boolean;
  ce_formats: string;
  primary_ce_format: CeFormatPrimary;
  has_live_online: boolean;
  audience_profession: string;
  audience_relationship: AudienceRelationship;
  entity_class: EntityClass;
  self_provided: boolean;
  needs_review: boolean;
  fetched_at: string;
};

export type ProspectRow = {
  company_name: string;
  fit_tier: number;
  host_tier?: number;
  activity_count: number;
  entity_class: EntityClass;
  self_provided: boolean;
  is_free: boolean | null;
  registration_kind: RegistrationKind;
  registration_host_domain: string;
  audience_profession: string;
  audience_relationship: AudienceRelationship;
  company_sells_what: string;
  has_formal_grant_program: boolean;
  ce_formats: string;
  primary_ce_format: CeFormatPrimary;
  has_live_online: boolean;
  source_directories: string;
  example_urls: string;
  needs_review: boolean;
  easy_audience_access_review: string;
};

export const DIRECTORY_COLUMNS = [
  'provider_name',
  'source_directory',
  'accreditor',
  'audience_profession',
  'source_url',
  'listed_website',
] as const;

export const CLASSIFIED_COLUMNS = [
  ...DIRECTORY_COLUMNS,
  'entity_class',
  'company_sells_what',
  'class_reason',
  'homepage_url',
  'audience_relationship',
  'has_formal_grant_program',
] as const;

export const FIT_COLUMNS = [
  ...CLASSIFIED_COLUMNS,
  'registration_host_domain',
  'registration_kind',
  'registration_url',
  'is_free',
  'self_provided',
  'audience_relationship',
  'has_formal_grant_program',
  'ce_page_url',
  'activity_title',
  'ce_formats',
  'primary_ce_format',
  'has_live_online',
  'needs_review',
  'source_kind',
] as const;

export const PROSPECT_COLUMNS = [
  'company_name',
  'fit_tier',
  'activity_count',
  'entity_class',
  'self_provided',
  'is_free',
  'registration_kind',
  'registration_host_domain',
  'audience_profession',
  'audience_relationship',
  'company_sells_what',
  'has_formal_grant_program',
  'ce_formats',
  'primary_ce_format',
  'has_live_online',
  'source_directories',
  'example_urls',
  'needs_review',
  'easy_audience_access_review',
] as const;

export const HOST_PROSPECT_COLUMNS = [...PROSPECT_COLUMNS, 'host_tier'] as const;

export const EVIDENCE_COLUMNS = [
  'company_name',
  'fit_tier',
  'source_kind',
  'source_url',
  'page_title',
  'extract_snippet',
  'registration_url',
  'audience_profession',
  'fetched_at',
] as const;

export const UNMATCHED_COLUMNS = [
  'url',
  'title',
  'snippet',
  'search_query',
  'reason',
] as const;
