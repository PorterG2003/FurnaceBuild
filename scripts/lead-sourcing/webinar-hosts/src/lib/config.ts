import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { configDir } from './env.js';

export type YieldStopConfig = {
  zero_new_pages: number;
  low_yield_threshold: number;
  low_yield_streak: number;
};

export type QueriesConfig = {
  time_filter: string;
  serper_rate_ms: number;
  yield_stop: YieldStopConfig;
  phrases: string[];
};

export type PipelineFilterConfig = {
  enabled: boolean;
};

export type ContactTiersConfig = {
  tier1_webinar: string[];
  tier2_pipeline: string[];
  tier2_seniority: string[];
  tier3_executive: string[];
  exclude: string[];
};

export type ContactSearchConfig = {
  max_contacts_per_company: number;
  per_page: number;
  contact_tiers: ContactTiersConfig;
};

export type IcpConfig = {
  pipeline_filter: PipelineFilterConfig;
  contact_search: ContactSearchConfig;
  industry_blocklist: string[];
  entity_blocklist: string[];
  industry_allowlist: string[];
};

export type SmokeConfig = {
  max_queries: number;
  max_pages: number;
  max_linkedin_urls: number;
  max_apollo_org_lookups: number;
  max_apollo_people_searches: number;
  max_openrouter_calls: number;
};

export function loadYamlConfig<T>(filename: string): T {
  const raw = readFileSync(join(configDir, filename), 'utf8');
  return parseYaml(raw) as T;
}

const DEFAULT_YIELD_STOP: YieldStopConfig = {
  zero_new_pages: 1,
  low_yield_threshold: 1,
  low_yield_streak: 2,
};

export function loadQueriesConfig(overrides?: Partial<QueriesConfig>): QueriesConfig {
  const base = loadYamlConfig<Partial<QueriesConfig>>('queries.yaml');
  return {
    time_filter: base.time_filter ?? 'qdr:m',
    serper_rate_ms: base.serper_rate_ms ?? 500,
    yield_stop: { ...DEFAULT_YIELD_STOP, ...base.yield_stop },
    phrases: base.phrases ?? [],
    ...overrides,
    yield_stop: { ...DEFAULT_YIELD_STOP, ...base.yield_stop, ...overrides?.yield_stop },
  };
}

export function loadIcpConfig(): IcpConfig {
  return loadYamlConfig<IcpConfig>('icp.yaml');
}

export function loadSmokeConfig(): SmokeConfig {
  return loadYamlConfig<SmokeConfig>('smoke.yaml');
}

export function buildSerpQuery(phrase: string): string {
  return `${phrase} site:linkedin.com/posts`;
}
