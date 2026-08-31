export type WonAccountRow = {
  account_name: string;
  account_id: string;
  parent_account: string;
  revenue: number;
  city: string;
  state: string;
  zip: string;
  street: string;
};

export type WonDistrict = {
  district_key: string;
  district_name: string;
  canonical_name: string;
  state: string;
  city: string;
  zip: string;
  street: string;
  revenue: number;
  account_count: number;
  sample_account_ids: string;
  is_charter: boolean;
  is_nyc_subunit: boolean;
};

export type CcdDistrict = {
  leaid: string;
  lea_name: string;
  state: string;
  city: string;
  zip: string;
  enrollment: number | null;
  english_language_learners: number | null;
  spec_ed_students: number | null;
  urban_centric_locale: number | null;
  agency_type: number | null;
  agency_charter_indicator: number | null;
  lowest_grade_offered: number | null;
  highest_grade_offered: number | null;
  number_of_schools: number | null;
  teachers_total_fte: number | null;
  latitude: number | null;
  longitude: number | null;
  county_code: string;
  poverty_share: number | null;
};

export type MatchMethod = 'override' | 'exact' | 'core' | 'city' | 'jaccard' | 'unmatched';
export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';

export type DistrictMatch = {
  district_key: string;
  district_name: string;
  state: string;
  city: string;
  zip: string;
  revenue: number;
  account_count: number;
  is_charter: boolean;
  is_nyc_subunit: boolean;
  leaid: string;
  nces_name: string;
  nces_city: string;
  nces_state: string;
  confidence: MatchConfidence;
  method: MatchMethod;
  score: number;
  needs_review: boolean;
  review_reason: string;
};

export type FeatureBins = {
  enrollment: string;
  grade_span: string;
  ell_share: string;
  spec_ed_share: string;
  locale: string;
  agency: string;
  str: string;
  poverty_share: string;
  geo_same_county: string;
  geo_nearby: string;
};

export type ScoredDistrict = CcdDistrict & {
  bins: FeatureBins;
  score: number;
  reasons: string;
  excluded: boolean;
  exclude_reason: string;
};

export type NumericBand = {
  id: string;
  label: string;
  min?: number;
  max?: number;
};

export type FeaturesConfig = {
  revenue_weight: number;
  logo_weight: number;
  min_wins_for_full_lift: number;
  nearby_miles: number;
  holdout_fraction: number;
  holdout_seed: number;
  enrollment_bands: NumericBand[];
  ell_share_bands: NumericBand[];
  spec_ed_share_bands: NumericBand[];
  poverty_share_bands: NumericBand[];
  str_bands: NumericBand[];
  geo_same_county_bands: NumericBand[];
  geo_nearby_bands: NumericBand[];
};

export type BinLift = {
  feature: string;
  bin: string;
  label: string;
  won_weight: number;
  universe: number;
  win_rate: number;
  lift: number;
  raw_lift: number;
};

export type FeatureProfile = {
  base_rate: number;
  won_count: number;
  won_weight_sum: number;
  universe_count: number;
  lifts: Record<string, Record<string, BinLift>>;
};

export type CcdSchool = {
  ncessch: string;
  leaid: string;
  school_name: string;
  state: string;
  city: string;
  zip: string;
};

export type SchoolMatchMethod = 'exact' | 'bare' | 'city' | 'jaccard' | 'unmatched';

export type SchoolMatch = {
  account_id: string;
  account_name: string;
  parent_account: string;
  city: string;
  state: string;
  zip: string;
  revenue: number;
  leaid: string;
  lea_name: string;
  ncessch: string;
  nces_school_name: string;
  nces_city: string;
  confidence: MatchConfidence;
  method: SchoolMatchMethod;
  score: number;
  needs_review: boolean;
  review_reason: string;
};

export type ListedSchool = CcdSchool & {
  lea_name: string;
  excluded: boolean;
  exclude_reason: string;
  won_account_id: string;
  won_account_name: string;
  match_confidence: string;
  match_score: string;
};

export type SchoolRole =
  | 'curriculum'
  | 'assistant_principal'
  | 'principal'
  | 'teacher'
  | 'district'
  | 'excluded'
  | 'unknown';

export type ContactProvider = 'directory' | 'state_agency' | 'quickenrich' | 'moltsets' | 'apollo';

export type RawSchoolContact = {
  ncessch: string;
  leaid: string;
  school_name: string;
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  linkedin_url: string;
  company: string;
  phone: string;
  provider: ContactProvider;
  email_risk: string;
  person_id: string;
};

export type PickedSchoolContact = RawSchoolContact & {
  role: SchoolRole;
  slot: number;
  pick_reason: string;
};
