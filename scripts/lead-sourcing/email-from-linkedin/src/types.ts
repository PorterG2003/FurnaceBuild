export type EnrichmentStatus = 'email_found' | 'matched_no_email' | 'not_found' | 'error';

export type EnrichMatchMethod =
  | 'linkedin_url'
  | 'name'
  | 'waterfall'
  | 'domain_rematch'
  | 'pattern_mv'
  | 'none';

export type RetryPass = 'pass1_waterfall' | 'pass2_domain' | 'pass3_pattern_mv' | 'unchanged';

export type ScrapeRow = {
  source: string;
  post_url: string;
  reactor_name: string;
  reactor_profile_url: string;
  reactor_headline: string;
  k12_role: string;
  reaction_type: string;
};

export type EnrichedUniqueRow = {
  linkedin_url: string;
  reactor_name: string;
  reactor_headline: string;
  k12_role: string;
  source: string;
  email: string;
  first_name: string;
  last_name: string;
  title: string;
  company_name: string;
  company_domain: string;
  apollo_person_id: string;
  enrichment_status: EnrichmentStatus;
  match_method: EnrichMatchMethod;
  error: string;
  retry_pass?: string;
};

export const ENRICHED_UNIQUE_COLUMNS: (keyof EnrichedUniqueRow)[] = [
  'linkedin_url',
  'reactor_name',
  'reactor_headline',
  'k12_role',
  'source',
  'email',
  'first_name',
  'last_name',
  'title',
  'company_name',
  'company_domain',
  'apollo_person_id',
  'enrichment_status',
  'match_method',
  'error',
  'retry_pass',
];

export const WITH_EMAIL_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'linkedin_url',
  'title',
  'company_name',
  'company_domain',
  'k12_role',
  'reactor_headline',
  'source',
  'apollo_person_id',
  'match_method',
] as const;

export const FULL_JOIN_EXTRA_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'title',
  'company_name',
  'company_domain',
  'apollo_person_id',
  'enrichment_status',
  'match_method',
] as const;
