import type { DoorId } from '../../config/doors.js';

export type B2bType = 'b2b' | 'b2b2c' | 'hybrid' | 'b2c' | 'unknown';
export type PrimaryBuyer = 'business' | 'consumer' | 'unknown';
export type CustomerGeo = 'local' | 'regional' | 'us' | 'global' | 'unknown';
export type UniverseStatus = 'raw' | 'admitted' | 'review' | 'excluded';
export type HqTier = 'A' | 'B';
export type WebinarPurpose =
  | 'sales_pipeline'
  | 'brand_awareness'
  | 'customer_training'
  | 'internal_training'
  | 'unknown';
export type WebinarCadence = 'one_off' | 'occasional' | 'recurring' | 'unknown';

export type FieldProvenance = {
  source: string;
  cached_at: string;
  raw_hash?: string;
};

export type CompanyRecord = {
  company_id: string;
  name: string;
  domain: string | null;
  apollo_org_id: string | null;
  sources: string[];
  street: string;
  city: string;
  query_city: string;
  search_employee_band: string;
  county: string;
  state: string;
  postal: string;
  lat: number | null;
  lng: number | null;
  fips: string | null;
  census_place: string | null;
  naics: string;
  industry: string;
  universe_status: UniverseStatus;
  universe_reason: string;
  hq_verification: HqTier | null;
  hq_address: string;
  live_site: boolean;
  parked_or_shared_host: boolean;
  employees: number | null;
  revenue_est: number | null;
  founded_year: number | null;
  headcount_growth_pct: number | null;
  last_funding_date: string;
  last_funding_amount: number | null;
  job_postings_json: string;
  hiring_gtm: boolean;
  hiring_outbound_marketer: boolean;
  current_technologies: string[];
  sequencer_detected: boolean;
  sequencer_orphaned: boolean;
  sdr_headcount: number | null;
  ae_headcount: number | null;
  sales_headcount: number | null;
  outbound_marketer_detected: boolean;
  outbound_marketer_title_only: boolean;
  named_dm_discoverable: boolean;
  b2b_type: B2bType;
  primary_buyer: PrimaryBuyer;
  customer_geo: CustomerGeo;
  what_they_sell: string;
  category: string;
  target_audience: string;
  is_outbound_shop: boolean;
  has_sales_motion: boolean;
  runs_webinars: number;
  webinar_platform: string;
  webinar_pages: string[];
  has_registration_page: boolean;
  webinar_purpose: WebinarPurpose;
  webinar_cadence: WebinarCadence;
  webinar_recency: string;
  webinar_audience: string;
  audience_is_ce_profession: boolean;
  ce_profession: string;
  audience_nameable: boolean;
  webinar_role_detected: boolean;
  wants_more_attendance: boolean;
  low_confidence_size: boolean;
  provenance: Record<string, FieldProvenance>;
};

export function emptyCompany(partial: Partial<CompanyRecord> & Pick<CompanyRecord, 'company_id' | 'name'>): CompanyRecord {
  return {
    domain: null,
    apollo_org_id: null,
    sources: [],
    street: '',
    city: '',
    query_city: '',
    search_employee_band: '',
    county: '',
    state: '',
    postal: '',
    lat: null,
    lng: null,
    fips: null,
    census_place: null,
    naics: '',
    industry: '',
    universe_status: 'raw',
    universe_reason: '',
    hq_verification: null,
    hq_address: '',
    live_site: false,
    parked_or_shared_host: false,
    employees: null,
    revenue_est: null,
    founded_year: null,
    headcount_growth_pct: null,
    last_funding_date: '',
    last_funding_amount: null,
    job_postings_json: '',
    hiring_gtm: false,
    hiring_outbound_marketer: false,
    current_technologies: [],
    sequencer_detected: false,
    sequencer_orphaned: false,
    sdr_headcount: null,
    ae_headcount: null,
    sales_headcount: null,
    outbound_marketer_detected: false,
    outbound_marketer_title_only: false,
    named_dm_discoverable: false,
    b2b_type: 'unknown',
    primary_buyer: 'unknown',
    customer_geo: 'unknown',
    what_they_sell: '',
    category: '',
    target_audience: '',
    is_outbound_shop: false,
    has_sales_motion: false,
    runs_webinars: 0,
    webinar_platform: '',
    webinar_pages: [],
    has_registration_page: false,
    webinar_purpose: 'unknown',
    webinar_cadence: 'unknown',
    webinar_recency: '',
    webinar_audience: '',
    audience_is_ce_profession: false,
    ce_profession: '',
    audience_nameable: false,
    webinar_role_detected: false,
    wants_more_attendance: false,
    low_confidence_size: false,
    provenance: {},
    ...partial,
  };
}

export type DoorResult = {
  company_id: string;
  door: DoorId;
  qualified: boolean;
  score: number | null;
  exclusion_reason: string;
  routing_score: number | null;
};

export type ReviewRow = {
  company_id: string;
  company: string;
  domain: string;
  reason: string;
  stage: string;
};

export type RawHit = {
  source: 'apollo' | 'fsq' | 'epa';
  name: string;
  domain: string | null;
  apollo_org_id: string | null;
  street: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  lat: number | null;
  lng: number | null;
  naics: string;
  industry: string;
  employees: number | null;
  revenue_est: number | null;
  founded_year: number | null;
  headcount_growth_pct: number | null;
  last_funding_date: string;
  last_funding_amount: number | null;
  current_technologies: string[];
  job_postings_json: string;
  raw_hash: string;
  hq_city: string;
  hq_state: string;
  hq_country: string;
  hq_street: string;
  query_city: string;
  search_employee_band: string;
};

export type PipelineContext = {
  runDir: string;
  cacheRoot: string;
  fixtures: boolean;
  dryRun: boolean;
  live: boolean;
  maxRows: number | null;
  maxApolloCalls: number | null;
  cities: string[];
  bands: string[];
  skipFsq: boolean;
  skipEpa: boolean;
  skipPeople: boolean;
  skipGeo: boolean;
  county: string;
  fsqExtract?: string;
  maxOrgEnrich: number | null;
};
