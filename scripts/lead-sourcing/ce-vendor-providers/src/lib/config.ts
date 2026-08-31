import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { configDir } from './env.js';

export type DirectoryConfig = {
  id: string;
  audience_profession: string;
  accreditor: string;
  start_url: string;
  json_url?: string;
  json_method?: 'GET' | 'POST';
  json_body?: string;
  /** When true, fetch start_url even if json_url is set (ACPE HTML listing + WP JSON). */
  fetch_start_with_json?: boolean;
  /** Extra list pages to fetch after start_url (GreenCE webinar + lunch-and-learn sponsors). */
  extra_urls?: string[];
  enabled: boolean;
  /** False when the live page is a JS shell and fixtures are the only usable parse. */
  live_parse?: boolean;
  /** False to fetch only start_url + extra_urls (no “next” crawling). */
  follow_pagination?: boolean;
  /** Use headed Playwright instead of HTTP (NBCC Blazor ACEP directory). */
  browser?: boolean;
};

export type DirectoriesFile = {
  fetch: {
    rate_ms: number;
    timeout_ms: number;
    max_pages_per_directory: number;
    user_agent: string;
  };
  directories: DirectoryConfig[];
};

export type QueriesConfig = {
  serper_rate_ms: number;
  yield_stop: {
    zero_new_pages: number;
    low_yield_threshold: number;
    low_yield_streak: number;
  };
  credit_terms: string[];
  host_phrases: string[];
  grant_phrases: string[];
  host_modifiers: {
    specialties: string[];
    years: string[];
  };
};

export type AliasesConfig = {
  merges: Record<string, string>;
  known_pharma: string[];
};

function loadYaml<T>(filename: string): T {
  return parseYaml(readFileSync(join(configDir, filename), 'utf8')) as T;
}

export type PlatformHost = {
  name: string;
  website: string;
  audience_profession: string;
};

export function loadDirectoriesConfig(): DirectoriesFile {
  return loadYaml<DirectoriesFile>('directories.yaml');
}

export function loadPlatformHosts(): PlatformHost[] {
  const raw = loadYaml<{ hosts?: PlatformHost[] }>('platform-hosts.yaml');
  return raw.hosts ?? [];
}

export function loadQueriesConfig(): QueriesConfig {
  return loadYaml<QueriesConfig>('queries.yaml');
}

export function loadAliasesConfig(): AliasesConfig {
  const raw = loadYaml<Partial<AliasesConfig>>('aliases.yaml');
  return {
    merges: raw.merges ?? {},
    known_pharma: raw.known_pharma ?? [],
  };
}
