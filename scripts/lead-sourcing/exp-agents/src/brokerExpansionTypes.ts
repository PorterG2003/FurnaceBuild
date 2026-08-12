import type { AudienceTier } from './brokerSignals.ts';

export type BrokerLeadRow = Record<string, string> & {
  master_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  audience_tier: AudienceTier | string;
  role_category: string;
  campaign_segment: string;
  score: string;
  categories: string;
  evidence: string;
  signal_sources: string;
  source_hosts: string;
  roster_agent_ids: string;
  roster_titles: string;
  roster_position_types: string;
  match_methods: string;
  profile_urls: string;
  license_numbers: string;
  license_types: string;
  license_states: string;
  license_status: string;
  designated_supervisor: string;
  sponsoring_broker: string;
};

export const BROKER_LEAD_COLUMNS: (keyof BrokerLeadRow & string)[] = [
  'master_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'city',
  'state',
  'country',
  'audience_tier',
  'role_category',
  'campaign_segment',
  'score',
  'categories',
  'evidence',
  'signal_sources',
  'source_hosts',
  'roster_agent_ids',
  'roster_titles',
  'roster_position_types',
  'match_methods',
  'profile_urls',
  'license_numbers',
  'license_types',
  'license_states',
  'license_status',
  'designated_supervisor',
  'sponsoring_broker',
];

export type BrokerExpansionSummary = {
  generatedAt: string;
  runDir: string;
  masterCsv: string;
  captureDir: string;
  uniqueRosterAgents: number;
  matchedMasterIds: number;
  unmatchedBrokerOrManager: number;
  tiers: Record<string, number>;
  campaignSegments: Record<string, number>;
  byState: Record<string, number>;
  sources: {
    rosterCaptures: number;
    bioCandidates: number;
    licenseMatches: number;
  };
  discovery?: {
    hostsAttempted: number;
    hostsHealthy: number;
    hostsPersonalOrTiny: number;
    plateauReached: boolean;
    notes: string[];
  };
  outputs: Record<string, string>;
};

export type LicenseRecord = {
  source: 'ca_dre' | 'tx_trec' | 'fl_dbpr';
  licenseNumber: string;
  licenseType: string;
  status: string;
  fullName: string;
  firstName: string;
  lastName: string;
  state: string;
  city: string;
  county: string;
  email: string;
  phone: string;
  expiration: string;
  designatedSupervisor: boolean;
  sponsoringBroker: string;
  agencyName: string;
  raw: Record<string, string>;
};

export type LicenseMatchMethod =
  | 'license_number'
  | 'email'
  | 'phone'
  | 'name_state_city'
  | 'name_state_unique'
  | '';

export type LicenseMatchResult = {
  masterId: string;
  license: LicenseRecord;
  matchMethod: LicenseMatchMethod;
  ambiguous: boolean;
};
