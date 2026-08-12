import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCallCounts, type ApiCallCounts } from '../../webinar-hosts/src/lib/callCounter.js';
import { writeCsv } from '../../webinar-hosts/src/lib/csv.js';
import {
  LEAD_COLUMNS,
  REJECTED_COLUMNS,
  RESOLVED_COMPANY_COLUMNS,
  type LeadRow,
  type RejectedCompanyRow,
  type ResolvedCompanyRow,
} from './types.js';

export const RESOLVE_CHECKPOINT_FILE = 'resolve_checkpoint.json';
export const CONTACTS_CHECKPOINT_FILE = 'contacts_checkpoint.json';
export const CONTACT_LOG_FILE = 'contact_log.jsonl';

export type ResolveCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  companies_path: string;
  started_at: string;
  updated_at: string;
  next_index: number;
  total: number;
  api_calls: ApiCallCounts;
  results: ResolvedCompanyRow[];
};

export type ContactsCheckpoint = {
  version: 1;
  status: 'in_progress' | 'completed';
  resolved_path: string;
  started_at: string;
  updated_at: string;
  next_index: number;
  total: number;
  api_calls: ApiCallCounts;
  leads: LeadRow[];
  rejected: RejectedCompanyRow[];
  seen_emails: string[];
};

export function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function saveJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function loadResolveCheckpoint(runDir: string): ResolveCheckpoint | null {
  return loadJson(join(runDir, RESOLVE_CHECKPOINT_FILE));
}

export function saveResolveCheckpoint(runDir: string, checkpoint: ResolveCheckpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, RESOLVE_CHECKPOINT_FILE),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    'utf8',
  );
  writeCsv(
    join(runDir, 'companies_resolved.csv'),
    checkpoint.results.map((r) => ({ ...r })),
    [...RESOLVED_COMPANY_COLUMNS],
  );
}

export function createResolveCheckpoint(
  companiesPath: string,
  total: number,
): ResolveCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    companies_path: companiesPath,
    started_at: now,
    updated_at: now,
    next_index: 0,
    total,
    api_calls: emptyCallCounts(),
    results: [],
  };
}

export function loadContactsCheckpoint(runDir: string): ContactsCheckpoint | null {
  return loadJson(join(runDir, CONTACTS_CHECKPOINT_FILE));
}

export function saveContactsCheckpoint(runDir: string, checkpoint: ContactsCheckpoint): void {
  checkpoint.updated_at = new Date().toISOString();
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, CONTACTS_CHECKPOINT_FILE),
    `${JSON.stringify(checkpoint, null, 2)}\n`,
    'utf8',
  );
  writeCsv(
    join(runDir, 'leads.csv'),
    checkpoint.leads.map((r) => ({ ...r })),
    [...LEAD_COLUMNS],
  );
  writeCsv(
    join(runDir, 'rejected_companies.csv'),
    checkpoint.rejected.map((r) => ({ ...r })),
    [...REJECTED_COLUMNS],
  );
}

export function createContactsCheckpoint(
  resolvedPath: string,
  total: number,
): ContactsCheckpoint {
  const now = new Date().toISOString();
  return {
    version: 1,
    status: 'in_progress',
    resolved_path: resolvedPath,
    started_at: now,
    updated_at: now,
    next_index: 0,
    total,
    api_calls: emptyCallCounts(),
    leads: [],
    rejected: [],
    seen_emails: [],
  };
}

export function appendContactLog(runDir: string, entry: Record<string, unknown>): void {
  mkdirSync(runDir, { recursive: true });
  appendFileSync(join(runDir, CONTACT_LOG_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
}
