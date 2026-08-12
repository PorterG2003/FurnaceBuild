export type CompanyRow = {
  company_name: string;
  company_domain: string;
  source_lists: string;
};

export type ResolvedCompanyRow = CompanyRow & {
  apollo_org_id: string;
  employee_count: string;
  industry: string;
  company_linkedin_url: string;
  enrichment_status: 'ok' | 'not_found' | 'error';
  enrichment_error: string;
};

export type LeadRow = {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  website: string;
  linkedin_url: string;
  company_linkedin_url: string;
  contact_title: string;
  contact_tier: string;
  contact_pick_reason: string;
  employee_count: string;
  industry: string;
  apollo_org_id: string;
  source_lists: string;
};

export type RejectedCompanyRow = ResolvedCompanyRow & {
  rejection_reason: string;
};

export const COMPANY_COLUMNS: (keyof CompanyRow)[] = [
  'company_name',
  'company_domain',
  'source_lists',
];

export const RESOLVED_COMPANY_COLUMNS: (keyof ResolvedCompanyRow)[] = [
  'company_name',
  'company_domain',
  'source_lists',
  'apollo_org_id',
  'employee_count',
  'industry',
  'company_linkedin_url',
  'enrichment_status',
  'enrichment_error',
];

export const LEAD_COLUMNS: (keyof LeadRow)[] = [
  'email',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'contact_title',
  'contact_tier',
  'contact_pick_reason',
  'employee_count',
  'industry',
  'apollo_org_id',
  'source_lists',
];

export const REJECTED_COLUMNS: (keyof RejectedCompanyRow)[] = [
  ...RESOLVED_COMPANY_COLUMNS,
  'rejection_reason',
];
