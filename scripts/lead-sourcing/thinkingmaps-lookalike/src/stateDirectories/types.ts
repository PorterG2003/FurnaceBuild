export const STATE_DIRECTORY_STATES = [
  'CA',
  'FL',
  'TX',
  'IL',
  'CO',
  'GA',
  'NV',
  'HI',
  'KY',
  'UT',
  'VA',
  'ID',
  'TN',
  'OR',
  'AL',
] as const;
export type StateDirectoryState = (typeof STATE_DIRECTORY_STATES)[number];

export type StateDirectoryRow = {
  source_state: StateDirectoryState;
  state_school_id: string;
  nces_school_id: string;
  district_name: string;
  school_name: string;
  city: string;
  zip: string;
  first_name: string;
  last_name: string;
  title: string;
  email: string;
};

export type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

export type MatchedStateRow = StateDirectoryRow & {
  match_status: MatchStatus;
  ncessch: string;
  leaid: string;
  matched_school_name: string;
  match_score: string;
  match_method: string;
};

export type StateDirectoryPeopleRow = {
  leaid: string;
  ncessch: string;
  school_name: string;
  first_name: string;
  last_name: string;
  title: string;
  school_hint: string;
  source_url: string;
  platform: string;
};

export type StateCoverageRow = {
  source_state: string;
  parsed: number;
  with_name: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  with_email: number;
  contacts: number;
  people: number;
};

export type ParseResult = {
  rows: StateDirectoryRow[];
  districtStaff: StateDirectoryRow[];
};
