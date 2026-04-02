import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifySkipSherpaPersonResult as classifySkipSherpaPersonResultCore,
  resolveContactEnrichmentRulesetPreset,
  type ContactEnrichmentClassifyContext,
  type ContactEnrichmentDecisionMetadata,
  type ContactEnrichmentRulesetPreset,
} from './contactEnrichmentClassifier.js';
import { classifyOwnerName } from './ownerDrilldown.js';

export type {
  ContactEnrichmentClassifyContext,
  ContactEnrichmentDecisionMetadata,
  ContactEnrichmentRulesetPreset,
} from './contactEnrichmentClassifier.js';

export const CONTACT_ENRICHMENT_PROVIDER = 'skipsherpa';
export const CONTACT_ENRICHMENT_LOOKUP_TYPE = 'person';
export const CONTACT_ENRICHMENT_VERSION = 'contact_enrichment_v1';
export const DEFAULT_CONTACT_ENRICHMENT_FRESHNESS_DAYS = 90;
export const MAX_CONTACT_ENRICHMENT_BATCH_SIZE = 25;
const SOURCE_RECORD_PAGE_SIZE = 1000;
const COMPANY_CHUNK_SIZE = 200;
const FINGERPRINT_CHUNK_SIZE = 200;
const SUPPRESSION_CHUNK_SIZE = 200;

export type ContactEnrichmentOptions = {
  freshnessWindowDays?: number;
  forceRerunRecent?: boolean;
  strongTargetsOnly?: boolean;
  /** Ruleset preset for auto-accept vs review (default balanced). */
  rulesetPreset?: ContactEnrichmentRulesetPreset;
  /** When true, ambiguous reviewable outcomes enqueue a `review_tasks` row. */
  queueAmbiguousForReview?: boolean;
};

export type ContactEnrichmentResolvedOptions = {
  freshnessWindowDays: number;
  forceRerunRecent: boolean;
  strongTargetsOnly: boolean;
  rulesetPreset: ContactEnrichmentRulesetPreset;
  queueAmbiguousForReview: boolean;
};

export type ContactEnrichmentPreflightCounts = {
  linked_companies: number;
  candidate_owner_rows: number;
  eligible: number;
  skipped_recent_lookup: number;
  skipped_missing_person_name: number;
  skipped_missing_address: number;
  skipped_no_current_owner: number;
  skipped_already_running: number;
  skipped_suppressed: number;
  skipped_not_ready: number;
};

export type ContactEnrichmentPreflightTarget = {
  ingestion_run_id: string;
  source_name: string;
  company_id: string;
  entity_owner_id: string;
  owner_name: string;
  owner_title_role: string | null;
  first_name: string;
  last_name: string;
  company_legal_name: string | null;
  address_line_1: string;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  lookup_fingerprint: string;
  latest_source_observed_at: string | null;
};

export type ContactEnrichmentPreflightResult = {
  ingestion_run_id: string;
  source_name: string;
  options: ContactEnrichmentResolvedOptions;
  counts: ContactEnrichmentPreflightCounts;
  eligibleTargets: ContactEnrichmentPreflightTarget[];
};

type LinkedCompanyContext = {
  latestSourceObservedAt: string | null;
};

type ExportOwnerLeadRow = {
  company_id: string;
  entity_owner_id: string | null;
  owner_name: string | null;
  title_role: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  has_current_owner: boolean;
  is_export_ready: boolean;
};

export type ContactEnrichmentTargetRow = {
  id: string;
  foundry_job_id: string;
  ingestion_run_id: string;
  source_name: string;
  company_id: string;
  entity_owner_id: string | null;
  owner_name: string;
  owner_title_role: string | null;
  first_name: string;
  last_name: string;
  company_legal_name: string | null;
  address_line_1: string;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  lookup_fingerprint: string;
  latest_source_observed_at: string | null;
};

type ContactEnrichmentTargetPage = {
  targets: ContactEnrichmentTargetRow[];
  nextCursor: string | null;
  done: boolean;
};

type SuppressionKey = string;

type LatestAttempt = {
  performedAt: string | null;
  isBillable: boolean;
};

export type SkipSherpaLookupPayload = {
  first_name: string;
  middle_name: null;
  last_name: string;
  age: null;
  email: null;
  phone_number: null;
  mailing_addresses: Array<{
    street: string;
    street2: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
  }>;
};

type SkipSherpaPersonName = {
  title?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
};

type SkipSherpaPostalAddress = {
  object_id?: string | null;
  source_metadata?: { object_id?: string | null; provider_id?: string | null } | null;
  delivery_line1?: string | null;
  delivery_line2?: string | null;
  last_line?: string | null;
  country_code?: string | null;
  is_verified_deliverable?: boolean | null;
  us_address?: {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zipcode?: string | null;
  } | null;
  metadata?: {
    county_name?: string | null;
    fips?: string | null;
    is_vacant?: boolean | null;
  } | null;
  attom?: Record<string, unknown> | null;
};

type SkipSherpaPhoneNumber = {
  e164_format?: string | null;
  local_format?: string | null;
  country_code?: string | null;
  country_calling_code?: number | null;
  type?: string | null;
  carrier?: string | null;
  last_seen?: string | null;
  dnc_statuses?: Array<Record<string, unknown>> | null;
};

type SkipSherpaEmail = {
  email_address?: string | null;
};

type SkipSherpaEmployer = {
  name?: string | null;
  address?: Record<string, unknown> | null;
};

type SkipSherpaRelative = {
  name?: string | null;
  relation_type?: string | null;
  age?: number | null;
  deceased?: boolean | null;
  date_of_birth_month_year?: string | null;
  person_name?: Record<string, unknown> | null;
};

type SkipSherpaPerson = {
  object_id?: string | null;
  source_metadata?: { object_id?: string | null; provider_id?: string | null } | null;
  person_name?: SkipSherpaPersonName | null;
  age?: number | null;
  deceased?: boolean | null;
  date_of_birth_month_year?: string | null;
  bankruptcy?: boolean | null;
  debts?: Record<string, unknown> | null;
  relatives?: SkipSherpaRelative[] | null;
  name?: string | null;
  addresses?: SkipSherpaPostalAddress[] | null;
  emails?: SkipSherpaEmail[] | null;
  phone_numbers?: SkipSherpaPhoneNumber[] | null;
  employers?: SkipSherpaEmployer[] | null;
};

type SkipSherpaPersonResult = {
  lookup?: SkipSherpaLookupPayload;
  effective_lookup?: Record<string, unknown> | null;
  expected_results?: number | null;
  persons?: SkipSherpaPerson[] | null;
  status_code?: number | null;
  issues?: Record<string, unknown>[] | null;
};

export type ContactEnrichmentClassification =
  | 'accepted_strong_match'
  | 'ambiguous'
  | 'no_match'
  | 'error';

export type ContactEnrichmentMatchDecision = {
  classification: ContactEnrichmentClassification;
  matchedPerson: SkipSherpaPerson | null;
  expectedResults: number;
  providerStatusCode: number | null;
  issues: Record<string, unknown>[];
  score: number;
  metadata?: ContactEnrichmentDecisionMetadata;
};

function emptyCounts(): ContactEnrichmentPreflightCounts {
  return {
    linked_companies: 0,
    candidate_owner_rows: 0,
    eligible: 0,
    skipped_recent_lookup: 0,
    skipped_missing_person_name: 0,
    skipped_missing_address: 0,
    skipped_no_current_owner: 0,
    skipped_already_running: 0,
    skipped_suppressed: 0,
    skipped_not_ready: 0,
  };
}

export function resolveContactEnrichmentOptions(
  input: ContactEnrichmentOptions | null | undefined,
): ContactEnrichmentResolvedOptions {
  const daysRaw = Number(input?.freshnessWindowDays ?? DEFAULT_CONTACT_ENRICHMENT_FRESHNESS_DAYS);
  const freshnessWindowDays = Number.isFinite(daysRaw) ? Math.max(1, Math.min(365, Math.floor(daysRaw))) : 90;
  return {
    freshnessWindowDays,
    forceRerunRecent: Boolean(input?.forceRerunRecent),
    strongTargetsOnly: input?.strongTargetsOnly !== false,
    rulesetPreset: resolveContactEnrichmentRulesetPreset(
      typeof input?.rulesetPreset === 'string' ? input.rulesetPreset : undefined,
    ),
    queueAmbiguousForReview: Boolean(input?.queueAmbiguousForReview),
  };
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function nullIfBlank(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = collapseWhitespace(value);
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSimpleToken(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function normalizeStreet(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\b(apt|suite|ste|unit)\b/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeFingerprintAddress(target: {
  address_line_1: string;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
}): string {
  return [
    normalizeStreet(target.address_line_1),
    normalizeStreet(target.address_line_2),
    normalizeSimpleToken(target.address_city),
    normalizeSimpleToken(target.address_state),
    normalizeSimpleToken(target.address_postal_code),
  ].join('|');
}

export function buildContactEnrichmentFingerprint(target: {
  source_name: string;
  company_id: string;
  entity_owner_id: string;
  first_name: string;
  last_name: string;
  address_line_1: string;
  address_line_2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal_code: string | null;
}): string {
  const raw = [
    CONTACT_ENRICHMENT_PROVIDER,
    CONTACT_ENRICHMENT_LOOKUP_TYPE,
    collapseWhitespace(target.source_name).toLowerCase(),
    target.company_id,
    target.entity_owner_id,
    normalizeSimpleToken(target.first_name),
    normalizeSimpleToken(target.last_name),
    normalizeFingerprintAddress(target),
  ].join('\n');
  return createHash('sha256').update(raw).digest('hex');
}

const PERSON_SUFFIX_RE = /\b(JR|SR|II|III|IV|V|MD|DDS|DMD|ESQ|CPA)\.?$/i;

export function parseContactEnrichmentPersonName(
  ownerName: string,
): { firstName: string; lastName: string } | null {
  const clean = collapseWhitespace(ownerName).replace(/\s*,\s*/g, ',').replace(PERSON_SUFFIX_RE, '').trim();
  if (!clean) return null;
  if (classifyOwnerName(clean).kind !== 'person') return null;
  if (clean.includes(',')) {
    const [lastPart, restPart] = clean.split(',', 2).map((part) => collapseWhitespace(part));
    const restTokens = restPart.split(' ').filter(Boolean);
    if (!lastPart || restTokens.length === 0) return null;
    return { firstName: restTokens[0]!, lastName: lastPart };
  }
  const tokens = clean.split(' ').filter(Boolean);
  if (tokens.length < 2) return null;
  return { firstName: tokens[0]!, lastName: tokens[tokens.length - 1]! };
}

function hasUsableLookupAddress(row: ExportOwnerLeadRow): row is ExportOwnerLeadRow & { address_line_1: string } {
  return Boolean(nullIfBlank(row.address_line_1));
}

function suppressionKey(companyId: string, entityOwnerId: string | null): SuppressionKey {
  return `${companyId}:${entityOwnerId ?? ''}`;
}

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

async function loadIngestionRun(leadsClient: SupabaseClient, runId: string): Promise<{ id: string; source_name: string }> {
  const { data, error } = await leadsClient
    .from('ingestion_runs')
    .select('id, source_name')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Ingestion run not found');
  return { id: String(data.id), source_name: String(data.source_name ?? '') };
}

async function listLinkedCompaniesForIngestionRun(
  leadsClient: SupabaseClient,
  runId: string,
): Promise<Map<string, LinkedCompanyContext>> {
  const companyContext = new Map<string, LinkedCompanyContext>();
  let offset = 0;

  for (;;) {
    const { data: records, error: recordErr } = await leadsClient
      .from('source_business_records')
      .select('id, observed_at')
      .eq('ingestion_run_id', runId)
      .order('id', { ascending: true })
      .range(offset, offset + SOURCE_RECORD_PAGE_SIZE - 1);
    if (recordErr) throw new Error(recordErr.message);
    const rows = (records ?? []) as Array<{ id: string; observed_at: string | null }>;
    if (rows.length === 0) break;

    const observedAtByRecordId = new Map(rows.map((row) => [String(row.id), row.observed_at ?? null]));
    const recordIds = rows.map((row) => String(row.id));
    const { data: links, error: linkErr } = await leadsClient
      .from('source_business_company_links')
      .select('company_id, source_business_record_id')
      .eq('is_current', true)
      .eq('link_status', 'linked')
      .in('source_business_record_id', recordIds);
    if (linkErr) throw new Error(linkErr.message);

    for (const link of (links ?? []) as Array<{ company_id: string | null; source_business_record_id: string | null }>) {
      const companyId = typeof link.company_id === 'string' ? link.company_id : '';
      const sourceRecordId = typeof link.source_business_record_id === 'string' ? link.source_business_record_id : '';
      if (!companyId || !sourceRecordId) continue;
      const observedAt = observedAtByRecordId.get(sourceRecordId) ?? null;
      const prev = companyContext.get(companyId) ?? { latestSourceObservedAt: null };
      prev.latestSourceObservedAt = maxIsoTimestamp(prev.latestSourceObservedAt, observedAt);
      companyContext.set(companyId, prev);
    }

    if (rows.length < SOURCE_RECORD_PAGE_SIZE) break;
    offset += SOURCE_RECORD_PAGE_SIZE;
  }

  return companyContext;
}

async function fetchExportRowsForCompanies(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<ExportOwnerLeadRow[]> {
  const rows: ExportOwnerLeadRow[] = [];
  for (let index = 0; index < companyIds.length; index += COMPANY_CHUNK_SIZE) {
    const chunk = companyIds.slice(index, index + COMPANY_CHUNK_SIZE);
    const { data, error } = await leadsClient
      .from('export_company_owner_leads')
      .select(
        'company_id, entity_owner_id, owner_name, title_role, address_line_1, address_line_2, address_city, address_state, address_postal_code, address_country, has_current_owner, is_export_ready',
      )
      .in('company_id', chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      rows.push({
        company_id: String(row.company_id ?? ''),
        entity_owner_id: nullIfBlank(row.entity_owner_id),
        owner_name: nullIfBlank(row.owner_name),
        title_role: nullIfBlank(row.title_role),
        address_line_1: nullIfBlank(row.address_line_1),
        address_line_2: nullIfBlank(row.address_line_2),
        address_city: nullIfBlank(row.address_city),
        address_state: nullIfBlank(row.address_state),
        address_postal_code: nullIfBlank(row.address_postal_code),
        address_country: nullIfBlank(row.address_country),
        has_current_owner: row.has_current_owner === true,
        is_export_ready: row.is_export_ready === true,
      });
    }
  }
  return rows;
}

async function fetchCompanyLegalNames(leadsClient: SupabaseClient, companyIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let index = 0; index < companyIds.length; index += COMPANY_CHUNK_SIZE) {
    const chunk = companyIds.slice(index, index + COMPANY_CHUNK_SIZE);
    const { data, error } = await leadsClient.from('companies').select('id, legal_name').in('id', chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ id: string; legal_name: string | null }>) {
      const id = String(row.id ?? '');
      const name = nullIfBlank(row.legal_name);
      if (id && name) map.set(id, name);
    }
  }
  return map;
}

async function listSuppressionsByTarget(
  leadsClient: SupabaseClient,
  companyIds: string[],
): Promise<Set<SuppressionKey>> {
  const out = new Set<SuppressionKey>();
  for (let index = 0; index < companyIds.length; index += SUPPRESSION_CHUNK_SIZE) {
    const chunk = companyIds.slice(index, index + SUPPRESSION_CHUNK_SIZE);
    const { data, error } = await leadsClient
      .from('contact_enrichment_suppressions')
      .select('company_id, entity_owner_id')
      .eq('provider', CONTACT_ENRICHMENT_PROVIDER)
      .eq('lookup_type', CONTACT_ENRICHMENT_LOOKUP_TYPE)
      .in('company_id', chunk);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      out.add(suppressionKey(String(row.company_id ?? ''), nullIfBlank(row.entity_owner_id)));
    }
  }
  return out;
}

async function listLatestAttemptsByFingerprint(
  leadsClient: SupabaseClient,
  fingerprints: string[],
): Promise<Map<string, LatestAttempt>> {
  const out = new Map<string, LatestAttempt>();
  for (let index = 0; index < fingerprints.length; index += FINGERPRINT_CHUNK_SIZE) {
    const chunk = fingerprints.slice(index, index + FINGERPRINT_CHUNK_SIZE);
    const { data, error } = await leadsClient
      .from('contact_enrichment_attempts')
      .select('lookup_fingerprint, performed_at, is_billable_candidate')
      .eq('provider', CONTACT_ENRICHMENT_PROVIDER)
      .in('lookup_fingerprint', chunk)
      .order('performed_at', { ascending: false });
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const fingerprint = String(row.lookup_fingerprint ?? '');
      if (!fingerprint || out.has(fingerprint)) continue;
      out.set(fingerprint, {
        performedAt: nullIfBlank(row.performed_at),
        isBillable: row.is_billable_candidate === true,
      });
    }
  }
  return out;
}

function isRecentLookup(
  latestAttempt: LatestAttempt | undefined,
  latestSourceObservedAt: string | null,
  options: ContactEnrichmentResolvedOptions,
): boolean {
  if (!latestAttempt?.performedAt) return false;
  const performedAtMs = Date.parse(latestAttempt.performedAt);
  if (!Number.isFinite(performedAtMs)) return false;
  const ageMs = Date.now() - performedAtMs;
  const freshnessMs = options.freshnessWindowDays * 24 * 60 * 60 * 1000;
  if (ageMs > freshnessMs) return false;
  if (!latestAttempt.isBillable) return false;
  if (!latestSourceObservedAt) return true;
  const latestSourceMs = Date.parse(latestSourceObservedAt);
  if (!Number.isFinite(latestSourceMs)) return true;
  return performedAtMs >= latestSourceMs;
}

export async function buildContactEnrichmentPreflight(
  leadsClient: SupabaseClient,
  runId: string,
  input: ContactEnrichmentOptions | null | undefined,
): Promise<ContactEnrichmentPreflightResult> {
  const run = await loadIngestionRun(leadsClient, runId);
  const options = resolveContactEnrichmentOptions(input);
  const linkedCompanies = await listLinkedCompaniesForIngestionRun(leadsClient, runId);
  const counts = emptyCounts();
  counts.linked_companies = linkedCompanies.size;
  if (linkedCompanies.size === 0) {
    return {
      ingestion_run_id: run.id,
      source_name: run.source_name,
      options,
      counts,
      eligibleTargets: [],
    };
  }

  const companyIds = [...linkedCompanies.keys()];
  const companyLegalById = await fetchCompanyLegalNames(leadsClient, companyIds);
  const exportRows = await fetchExportRowsForCompanies(leadsClient, companyIds);
  const rowsByCompany = new Map<string, ExportOwnerLeadRow[]>();
  for (const row of exportRows) {
    const list = rowsByCompany.get(row.company_id) ?? [];
    list.push(row);
    rowsByCompany.set(row.company_id, list);
  }

  const candidateTargets: ContactEnrichmentPreflightTarget[] = [];
  for (const companyId of companyIds) {
    const rows = rowsByCompany.get(companyId) ?? [];
    if (rows.length === 0) {
      counts.skipped_not_ready += 1;
      continue;
    }
    for (const row of rows) {
      if (row.entity_owner_id) counts.candidate_owner_rows += 1;
      if (!row.has_current_owner || !row.entity_owner_id) {
        counts.skipped_no_current_owner += 1;
        continue;
      }
      if (!row.is_export_ready) {
        counts.skipped_not_ready += 1;
        continue;
      }
      if (!row.owner_name) {
        counts.skipped_missing_person_name += 1;
        continue;
      }
      if (options.strongTargetsOnly && classifyOwnerName(row.owner_name).kind !== 'person') {
        counts.skipped_missing_person_name += 1;
        continue;
      }
      const parsedName = parseContactEnrichmentPersonName(row.owner_name);
      if (!parsedName) {
        counts.skipped_missing_person_name += 1;
        continue;
      }
      if (!hasUsableLookupAddress(row)) {
        counts.skipped_missing_address += 1;
        continue;
      }
      const latestSourceObservedAt = linkedCompanies.get(companyId)?.latestSourceObservedAt ?? null;
      const companyLegalName = companyLegalById.get(companyId) ?? null;
      candidateTargets.push({
        ingestion_run_id: run.id,
        source_name: run.source_name,
        company_id: companyId,
        entity_owner_id: row.entity_owner_id,
        owner_name: row.owner_name,
        owner_title_role: row.title_role,
        first_name: parsedName.firstName,
        last_name: parsedName.lastName,
        company_legal_name: companyLegalName,
        address_line_1: row.address_line_1,
        address_line_2: row.address_line_2,
        address_city: row.address_city,
        address_state: row.address_state,
        address_postal_code: row.address_postal_code,
        address_country: row.address_country,
        latest_source_observed_at: latestSourceObservedAt,
        lookup_fingerprint: buildContactEnrichmentFingerprint({
          source_name: run.source_name,
          company_id: companyId,
          entity_owner_id: row.entity_owner_id,
          first_name: parsedName.firstName,
          last_name: parsedName.lastName,
          address_line_1: row.address_line_1,
          address_line_2: row.address_line_2,
          address_city: row.address_city,
          address_state: row.address_state,
          address_postal_code: row.address_postal_code,
        }),
      });
    }
  }

  const suppressions = await listSuppressionsByTarget(leadsClient, companyIds);
  const latestAttempts = await listLatestAttemptsByFingerprint(
    leadsClient,
    candidateTargets.map((target) => target.lookup_fingerprint),
  );
  const eligibleTargets: ContactEnrichmentPreflightTarget[] = [];

  for (const target of candidateTargets) {
    if (suppressions.has(suppressionKey(target.company_id, target.entity_owner_id))) {
      counts.skipped_suppressed += 1;
      continue;
    }
    if (
      !options.forceRerunRecent &&
      isRecentLookup(latestAttempts.get(target.lookup_fingerprint), target.latest_source_observed_at, options)
    ) {
      counts.skipped_recent_lookup += 1;
      continue;
    }
    eligibleTargets.push(target);
  }

  counts.eligible = eligibleTargets.length;
  return {
    ingestion_run_id: run.id,
    source_name: run.source_name,
    options,
    counts,
    eligibleTargets,
  };
}

export async function insertContactEnrichmentTargetsForJob(
  leadsClient: SupabaseClient,
  jobId: string,
  preflight: ContactEnrichmentPreflightResult,
): Promise<void> {
  if (preflight.eligibleTargets.length === 0) return;
  for (let index = 0; index < preflight.eligibleTargets.length; index += COMPANY_CHUNK_SIZE) {
    const chunk = preflight.eligibleTargets.slice(index, index + COMPANY_CHUNK_SIZE);
    const { error } = await leadsClient.from('contact_enrichment_targets').insert(
      chunk.map((target) => ({
        foundry_job_id: jobId,
        ingestion_run_id: target.ingestion_run_id,
        source_name: target.source_name,
        company_id: target.company_id,
        entity_owner_id: target.entity_owner_id,
        owner_name: target.owner_name,
        owner_title_role: target.owner_title_role,
        first_name: target.first_name,
        last_name: target.last_name,
        company_legal_name: target.company_legal_name,
        address_line_1: target.address_line_1,
        address_line_2: target.address_line_2,
        address_city: target.address_city,
        address_state: target.address_state,
        address_postal_code: target.address_postal_code,
        address_country: target.address_country,
        lookup_fingerprint: target.lookup_fingerprint,
        latest_source_observed_at: target.latest_source_observed_at,
      })),
    );
    if (error) throw new Error(error.message);
  }
}

export async function listContactEnrichmentTargetsPage(
  leadsClient: SupabaseClient,
  jobId: string,
  batchSize: number,
  cursor: string | null,
): Promise<ContactEnrichmentTargetPage> {
  let query = leadsClient
    .from('contact_enrichment_targets')
    .select(
      'id, foundry_job_id, ingestion_run_id, source_name, company_id, entity_owner_id, owner_name, owner_title_role, first_name, last_name, company_legal_name, address_line_1, address_line_2, address_city, address_state, address_postal_code, address_country, lookup_fingerprint, latest_source_observed_at',
    )
    .eq('foundry_job_id', jobId)
    .eq('status', 'pending')
    .order('id', { ascending: true })
    .limit(Math.min(MAX_CONTACT_ENRICHMENT_BATCH_SIZE, Math.max(1, batchSize || MAX_CONTACT_ENRICHMENT_BATCH_SIZE)));
  if (cursor) query = query.gt('id', cursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const targets = rows.map((row) => ({
    id: String(row.id ?? ''),
    foundry_job_id: String(row.foundry_job_id ?? ''),
    ingestion_run_id: String(row.ingestion_run_id ?? ''),
    source_name: String(row.source_name ?? ''),
    company_id: String(row.company_id ?? ''),
    entity_owner_id: nullIfBlank(row.entity_owner_id),
    owner_name: String(row.owner_name ?? ''),
    owner_title_role: nullIfBlank(row.owner_title_role),
    first_name: String(row.first_name ?? ''),
    last_name: String(row.last_name ?? ''),
    company_legal_name: nullIfBlank(row.company_legal_name),
    address_line_1: String(row.address_line_1 ?? ''),
    address_line_2: nullIfBlank(row.address_line_2),
    address_city: nullIfBlank(row.address_city),
    address_state: nullIfBlank(row.address_state),
    address_postal_code: nullIfBlank(row.address_postal_code),
    address_country: nullIfBlank(row.address_country),
    lookup_fingerprint: String(row.lookup_fingerprint ?? ''),
    latest_source_observed_at: nullIfBlank(row.latest_source_observed_at),
  }));
  if (targets.length === 0) {
    return { targets: [], nextCursor: null, done: true };
  }
  return {
    targets,
    nextCursor: targets[targets.length - 1]!.id,
    done: targets.length < Math.min(MAX_CONTACT_ENRICHMENT_BATCH_SIZE, Math.max(1, batchSize || MAX_CONTACT_ENRICHMENT_BATCH_SIZE)),
  };
}

const INLINE_MAILING_ADDR_RE = /,\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/;

export function buildSkipSherpaLookupPayload(target: ContactEnrichmentTargetRow): SkipSherpaLookupPayload {
  let street = target.address_line_1;
  let city = target.address_city;
  let state = target.address_state;
  let zipcode = target.address_postal_code;
  if ((!city || !state || !zipcode) && street) {
    const m = street.match(INLINE_MAILING_ADDR_RE);
    if (m?.index != null) {
      street = street.slice(0, m.index).trim().replace(/,\s*$/, '');
      city = city ?? collapseWhitespace(m[1] ?? '');
      state = state ?? (m[2] ?? '').toUpperCase();
      zipcode = zipcode ?? m[3] ?? null;
    }
  }
  return {
    first_name: target.first_name,
    middle_name: null,
    last_name: target.last_name,
    age: null,
    email: null,
    phone_number: null,
    mailing_addresses: [
      {
        street,
        street2: target.address_line_2,
        city,
        state,
        zipcode,
      },
    ],
  };
}

export async function callSkipSherpaPersonLookup(
  apiKey: string,
  lookups: SkipSherpaLookupPayload[],
): Promise<{ httpStatus: number; body: unknown }> {
  const response = await fetch('https://skipsherpa.com/api/beta6/person', {
    method: 'PUT',
    headers: {
      'API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ person_lookups: lookups }),
  });
  const body = (await response.json().catch(() => ({}))) as unknown;
  return { httpStatus: response.status, body };
}

export function classifySkipSherpaPersonResult(
  lookup: ContactEnrichmentTargetRow,
  result: SkipSherpaPersonResult | null | undefined,
  context?: ContactEnrichmentClassifyContext,
): ContactEnrichmentMatchDecision {
  const full = classifySkipSherpaPersonResultCore(lookup, result, context);
  return {
    classification: full.classification as ContactEnrichmentClassification,
    matchedPerson: full.matchedPerson as SkipSherpaPerson,
    expectedResults: full.expectedResults,
    providerStatusCode: full.providerStatusCode,
    issues: full.issues,
    score: full.score,
    metadata: full.metadata,
  };
}

function safeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function safeBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** Promote a provider person onto `contact_enrichment_matches` (used by worker and review-queue resolution). */
export async function promoteContactEnrichmentPersonToMatch(
  leadsClient: SupabaseClient,
  attemptId: string,
  target: ContactEnrichmentTargetRow,
  person: SkipSherpaPerson,
): Promise<void> {
  const personName = person.person_name ?? null;
  const addresses = Array.isArray(person.addresses) ? person.addresses : [];
  const emails = Array.isArray(person.emails) ? person.emails : [];
  const phones = Array.isArray(person.phone_numbers) ? person.phone_numbers : [];
  const employers = Array.isArray(person.employers) ? person.employers : [];
  const relatives = Array.isArray(person.relatives) ? person.relatives : [];
  const sourceMetadata = person.source_metadata ?? null;

  const { data: inserted, error: insertErr } = await leadsClient
    .from('contact_enrichment_matches')
    .insert({
      attempt_id: attemptId,
      target_id: target.id,
      company_id: target.company_id,
      entity_owner_id: target.entity_owner_id,
      provider: CONTACT_ENRICHMENT_PROVIDER,
      lookup_type: CONTACT_ENRICHMENT_LOOKUP_TYPE,
      provider_object_id: nullIfBlank(person.object_id),
      provider_source_object_id: nullIfBlank(sourceMetadata?.object_id),
      provider_source_id: nullIfBlank(sourceMetadata?.provider_id),
      matched_name: nullIfBlank(person.name) ?? `${target.first_name} ${target.last_name}`,
      matched_first_name: nullIfBlank(personName?.first_name),
      matched_middle_name: nullIfBlank(personName?.middle_name),
      matched_last_name: nullIfBlank(personName?.last_name),
      matched_suffix: nullIfBlank(personName?.suffix),
      age: safeInteger(person.age),
      date_of_birth_month_year: nullIfBlank(person.date_of_birth_month_year),
      deceased: safeBoolean(person.deceased),
      bankruptcy: safeBoolean(person.bankruptcy),
      debt_summary: person.debts ?? {},
      email_count: emails.length,
      phone_count: phones.length,
      address_count: addresses.length,
      employer_count: employers.length,
      relative_count: relatives.length,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) throw new Error(insertErr?.message ?? 'Failed to insert enrichment match');
  const matchId = String(inserted.id);

  if (emails.length > 0) {
    const { error } = await leadsClient.from('contact_enrichment_match_emails').insert(
      emails
        .map((email, index) => {
          const value = nullIfBlank(email.email_address);
          if (!value) return null;
          return { match_id: matchId, email_address: value, raw_rank: index };
        })
        .filter(Boolean),
    );
    if (error) throw new Error(error.message);
  }

  if (phones.length > 0) {
    const { error } = await leadsClient.from('contact_enrichment_match_phones').insert(
      phones.map((phone, index) => ({
        match_id: matchId,
        e164_format: nullIfBlank(phone.e164_format),
        local_format: nullIfBlank(phone.local_format),
        phone_type: nullIfBlank(phone.type),
        carrier: nullIfBlank(phone.carrier),
        country_code: nullIfBlank(phone.country_code),
        country_calling_code: safeInteger(phone.country_calling_code),
        last_seen: nullIfBlank(phone.last_seen),
        is_dnc: safeBoolean((phone.dnc_statuses ?? [])[0]?.is_dnc),
        dnc_summary: Array.isArray(phone.dnc_statuses) && phone.dnc_statuses.length > 0 ? phone.dnc_statuses[0]! : {},
        raw_rank: index,
      })),
    );
    if (error) throw new Error(error.message);
  }

  if (addresses.length > 0) {
    const { error } = await leadsClient.from('contact_enrichment_match_addresses').insert(
      addresses.map((address, index) => ({
        match_id: matchId,
        provider_object_id: nullIfBlank(address.object_id),
        provider_source_object_id: nullIfBlank(address.source_metadata?.object_id),
        provider_source_id: nullIfBlank(address.source_metadata?.provider_id),
        delivery_line1: nullIfBlank(address.delivery_line1),
        delivery_line2: nullIfBlank(address.delivery_line2),
        last_line: nullIfBlank(address.last_line),
        country_code: nullIfBlank(address.country_code),
        is_verified_deliverable: safeBoolean(address.is_verified_deliverable),
        street: nullIfBlank(address.us_address?.street),
        city: nullIfBlank(address.us_address?.city),
        state: nullIfBlank(address.us_address?.state),
        zipcode: nullIfBlank(address.us_address?.zipcode),
        county_name: nullIfBlank(address.metadata?.county_name),
        fips: nullIfBlank(address.metadata?.fips),
        is_vacant: safeBoolean(address.metadata?.is_vacant),
        attom_summary: address.attom ?? {},
        raw_rank: index,
      })),
    );
    if (error) throw new Error(error.message);
  }

  if (employers.length > 0) {
    const { error } = await leadsClient.from('contact_enrichment_match_employers').insert(
      employers
        .map((employer, index) => {
          const name = nullIfBlank(employer.name);
          if (!name) return null;
          return {
            match_id: matchId,
            employer_name: name,
            employer_address: employer.address ?? {},
            raw_rank: index,
          };
        })
        .filter(Boolean),
    );
    if (error) throw new Error(error.message);
  }

  if (relatives.length > 0) {
    const { error } = await leadsClient.from('contact_enrichment_match_relatives').insert(
      relatives
        .map((relative, index) => {
          const name = nullIfBlank(relative.name);
          if (!name) return null;
          return {
            match_id: matchId,
            relative_name: name,
            relation_type: nullIfBlank(relative.relation_type),
            age: safeInteger(relative.age),
            deceased: safeBoolean(relative.deceased),
            date_of_birth_month_year: nullIfBlank(relative.date_of_birth_month_year),
            person_name: relative.person_name ?? {},
            raw_rank: index,
          };
        })
        .filter(Boolean),
    );
    if (error) throw new Error(error.message);
  }
}

export async function persistContactEnrichmentAttempt(
  leadsClient: SupabaseClient,
  params: {
    jobId: string;
    target: ContactEnrichmentTargetRow;
    requestPayload: SkipSherpaLookupPayload;
    responsePayload: unknown;
    httpStatus: number;
    decision: ContactEnrichmentMatchDecision;
  },
): Promise<void> {
  const meta = params.decision.metadata;
  const { data: attempt, error: attemptErr } = await leadsClient
    .from('contact_enrichment_attempts')
    .insert({
      foundry_job_id: params.jobId,
      target_id: params.target.id,
      ingestion_run_id: params.target.ingestion_run_id,
      provider: CONTACT_ENRICHMENT_PROVIDER,
      lookup_type: CONTACT_ENRICHMENT_LOOKUP_TYPE,
      source_name: params.target.source_name,
      company_id: params.target.company_id,
      entity_owner_id: params.target.entity_owner_id,
      lookup_fingerprint: params.target.lookup_fingerprint,
      request_payload: params.requestPayload,
      response_payload: params.responsePayload ?? {},
      http_status: params.httpStatus,
      provider_status_code: params.decision.providerStatusCode,
      expected_results: params.decision.expectedResults,
      classification: params.decision.classification,
      decision_metadata: meta
        ? {
            ambiguity_reason_codes: meta.ambiguity_reason_codes,
            ranked_candidates: meta.ranked_candidates,
            ambiguity_kind: meta.ambiguity_kind,
            review_task_eligible: meta.review_task_eligible,
          }
        : {},
      matcher_version: meta?.matcher_version ?? null,
      scoring_version: meta?.scoring_version ?? null,
      ruleset_version: meta?.ruleset_version ?? null,
      ruleset_preset: meta?.ruleset_preset ?? null,
      is_billable_candidate: params.httpStatus >= 200 && params.httpStatus < 300,
      error_summary:
        params.decision.classification === 'error'
          ? JSON.stringify(params.decision.issues?.[0] ?? { message: 'Contact enrichment error' })
          : null,
    })
    .select('id')
    .single();
  if (attemptErr || !attempt) throw new Error(attemptErr?.message ?? 'Failed to insert enrichment attempt');
  const attemptId = String(attempt.id);

  if (params.decision.classification === 'accepted_strong_match' && params.decision.matchedPerson) {
    await promoteContactEnrichmentPersonToMatch(leadsClient, attemptId, params.target, params.decision.matchedPerson);
  }

  if (
    params.decision.classification === 'ambiguous' &&
    meta?.review_task_eligible &&
    meta.ambiguity_kind === 'reviewable'
  ) {
    const { data: reviewRow, error: reviewErr } = await leadsClient
      .from('review_tasks')
      .insert({
        task_type: 'contact_enrichment_review',
        entity_type: 'contact_enrichment_attempt',
        entity_id: attemptId,
        status: 'pending',
        payload: {
          company_id: params.target.company_id,
          entity_owner_id: params.target.entity_owner_id,
          target_id: params.target.id,
          attempt_id: attemptId,
          owner_name: params.target.owner_name,
          ambiguity_reason_codes: meta.ambiguity_reason_codes,
          ranked_candidates: meta.ranked_candidates,
          ruleset_preset: meta.ruleset_preset,
          expected_results: params.decision.expectedResults,
        },
      })
      .select('id')
      .single();
    if (!reviewErr && reviewRow?.id) {
      await leadsClient
        .from('contact_enrichment_attempts')
        .update({ review_task_id: String(reviewRow.id) })
        .eq('id', attemptId);
    }
  }

  const status =
    params.decision.classification === 'accepted_strong_match'
      ? 'accepted'
      : params.decision.classification === 'ambiguous'
        ? 'ambiguous'
        : params.decision.classification === 'no_match'
          ? 'no_match'
          : 'error';
  const { error: targetErr } = await leadsClient
    .from('contact_enrichment_targets')
    .update({
      status,
      last_attempt_id: attemptId,
      skip_reason: null,
    })
    .eq('id', params.target.id);
  if (targetErr) throw new Error(targetErr.message);
}
