import type { ManagerConfidence } from './managerSignals.ts';

export type RosterHostKind = 'regional' | 'personal' | 'unknown';

export type RosterHostStatus = 'pending' | 'healthy' | 'challenge' | 'empty' | 'error';

export type RosterHost = {
  host: string;
  prefix: string;
  jurisdictions: string[];
  kind: RosterHostKind;
  status: RosterHostStatus;
  rosterCount: number | null;
  agentsPhpOk: boolean;
  lastProbedAt: string | null;
  lastCapturedAt: string | null;
  error: string | null;
  source: 'seed' | 'discovered';
};

export type RosterHostManifest = {
  generatedAt: string;
  updatedAt: string;
  hosts: RosterHost[];
};

export type RosterAgent = {
  agentid: number;
  fname: string;
  lname: string;
  email: string;
  title: string;
  cellphone?: string | null;
  officephone?: string | null;
  direct_phone?: string | null;
  work_phone?: string | null;
  position_types: string[];
  designations?: string[];
  description: string;
  photo?: string | null;
  website_url?: string | null;
};

export type CapturedRoster = {
  host: string;
  capturedAt: string;
  count: number;
  agents: RosterAgent[];
};

export type HostCaptureCheckpoint = {
  done: boolean;
  completedHosts: string[];
  failedHosts: Array<{ host: string; error: string }>;
  updatedAt: string;
};

export type MatchMethod = 'email' | 'name_state' | 'phone' | '';

export type ManagerCandidateRow = Record<string, string> & {
  master_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  roster_agent_id: string;
  roster_title: string;
  roster_position_types: string;
  manager_confidence: ManagerConfidence | string;
  manager_score: string;
  manager_categories: string;
  manager_evidence: string;
  master_bio_confidence: string;
  match_method: MatchMethod | string;
  source_host: string;
  profile_url: string;
};

export type ManagerCoverageByJurisdiction = {
  masterRows: number;
  matchedMasterIds: number;
  coveragePct: number;
  high: number;
  medium: number;
  hosts: string[];
};

export type ManagerRunSummary = {
  generatedAt: string;
  phase: 'pilot' | 'national';
  jurisdictions: string[];
  hostsAttempted: number;
  hostsHealthy: number;
  rosterProfiles: number;
  uniqueRosterIds: number;
  matchedMasterIds: number;
  highConfidence: number;
  mediumConfidence: number;
  unmatchedRosterProfiles: number;
  coverageByJurisdiction: Record<string, ManagerCoverageByJurisdiction>;
  qualityGate: {
    requiredPrecisionPct: number;
    requiredCoveragePct: number;
    precisionPct: number | null;
    coveragePassed: boolean;
    precisionPassed: boolean | null;
    passed: boolean;
    failingJurisdictions: string[];
    notes: string[];
  };
  outputs: Record<string, string>;
};

export const PILOT_JURISDICTIONS = ['CA', 'TX', 'FL', 'IL', 'WA'] as const;

export const MANAGER_CANDIDATE_COLUMNS: (keyof ManagerCandidateRow & string)[] = [
  'master_id',
  'first_name',
  'last_name',
  'email',
  'phone',
  'city',
  'state',
  'country',
  'roster_agent_id',
  'roster_title',
  'roster_position_types',
  'manager_confidence',
  'manager_score',
  'manager_categories',
  'manager_evidence',
  'master_bio_confidence',
  'match_method',
  'source_host',
  'profile_url',
];

export const HIGH_CONFIDENCE_PRECISION_GATE = 90;
export const JURISDICTION_COVERAGE_GATE = 70;
