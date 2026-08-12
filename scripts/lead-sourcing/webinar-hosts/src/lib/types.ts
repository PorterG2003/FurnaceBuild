export type Stage1Row = {
  result_url: string;
  result_title: string;
  result_snippet: string;
  search_query: string;
  serp_position: string;
  serp_page: string;
  collected_at: string;
  slug_hint: string;
  also_matched_queries: string;
};

export type Stage2Row = Stage1Row & {
  post_text: string;
  author_name: string;
  author_profile_url: string;
  author_employer_name: string;
  author_employer_linkedin_url: string;
  entity_type: string;
  registration_urls: string;
  posted_at: string;
  extraction_status: string;
  extraction_error: string;
};

export type Stage3Row = {
  company_name: string;
  company_domain: string;
  company_linkedin_url: string;
  employee_count: string;
  industry: string;
  apollo_org_id: string;
  webinar_topic: string;
  webinar_date_mention: string;
  target_audience: string;
  registration_urls: string;
  sample_post_url: string;
  post_count: string;
  entity_source: string;
  enrichment_status: string;
};

export type Stage4LeadRow = {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  website: string;
  linkedin_url: string;
  company_linkedin_url: string;
  webinar_topic: string;
  registration_url: string;
  sample_post_url: string;
  contact_title: string;
  contact_tier: string;
  contact_pick_reason: string;
  employee_count: string;
  industry: string;
  city: string;
  state: string;
  country: string;
};

export type RejectedEntityRow = Stage3Row & {
  rejection_reason: string;
};

export const STAGE1_COLUMNS: (keyof Stage1Row)[] = [
  'result_url',
  'result_title',
  'result_snippet',
  'search_query',
  'serp_position',
  'serp_page',
  'collected_at',
  'slug_hint',
  'also_matched_queries',
];

export const STAGE2_EXTRA_COLUMNS: (keyof Omit<Stage2Row, keyof Stage1Row>)[] = [
  'post_text',
  'author_name',
  'author_profile_url',
  'author_employer_name',
  'author_employer_linkedin_url',
  'entity_type',
  'registration_urls',
  'posted_at',
  'extraction_status',
  'extraction_error',
];

export const STAGE3_COLUMNS: (keyof Stage3Row)[] = [
  'company_name',
  'company_domain',
  'company_linkedin_url',
  'employee_count',
  'industry',
  'apollo_org_id',
  'webinar_topic',
  'webinar_date_mention',
  'target_audience',
  'registration_urls',
  'sample_post_url',
  'post_count',
  'entity_source',
  'enrichment_status',
];

export const STAGE4_LEAD_COLUMNS: (keyof Stage4LeadRow)[] = [
  'email',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'webinar_topic',
  'registration_url',
  'sample_post_url',
  'contact_title',
  'contact_tier',
  'contact_pick_reason',
  'employee_count',
  'industry',
  'city',
  'state',
  'country',
];

export function rowToRecord(row: Record<string, string | number | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value == null ? '' : String(value);
  }
  return out;
}
