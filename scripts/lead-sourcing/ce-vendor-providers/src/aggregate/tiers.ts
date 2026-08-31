import type { FitRecord, ProspectRow, RegistrationKind, EntityClass, AudienceRelationship } from '../lib/types.js';
import { mergeCeFormats } from '../fit/ceFormat.js';
import { hostnameOf, isCePlatformHost } from '../lib/url.js';

function asBool(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function asFree(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

export function assignFitTier(row: {
  entity_class: string;
  self_provided: unknown;
  is_free: unknown;
  registration_kind: string;
  has_formal_grant_program: unknown;
  has_live_online?: unknown;
  source_kind?: string;
}): number {
  const entity = row.entity_class as EntityClass;
  if (entity === 'institution' || entity === 'society' || entity === 'education_company') return 0;

  const isFree = asFree(row.is_free);
  const ownReg = row.registration_kind === 'own_domain';

  if (isFree === false) return 0;
  if (entity !== 'commercial_vendor') return 0;
  return ownReg ? 1 : 2;
}

function isClearlyRecordedOnly(row: {
  has_live_online?: unknown;
  ce_formats?: string;
  primary_ce_format?: string;
}): boolean {
  if (asBool(row.has_live_online)) return false;
  const formats = (row.ce_formats || '')
    .split('|')
    .map((f) => f.trim())
    .filter(Boolean);
  if (formats.includes('live_online') || formats.includes('in_person')) return false;
  if (row.primary_ce_format === 'live_online' || row.primary_ce_format === 'in_person') return false;
  if (!row.primary_ce_format || row.primary_ce_format === 'unknown') return false;
  if (row.primary_ce_format === 'on_demand') return true;
  return formats.length > 0 && formats.every((f) => f === 'on_demand');
}

export function assignHostTier(row: {
  entity_class: string;
  class_reason?: string;
  source_directory?: string;
  source_kind?: string;
  registration_kind: string;
  has_live_online?: unknown;
  ce_formats?: string;
  primary_ce_format?: string;
}): number {
  const entity = row.entity_class as EntityClass;
  if (row.source_directory === 'ce_platform') return 1;
  if (entity === 'institution' || entity === 'society') return 0;

  const live = asBool(row.has_live_online);
  const ownReg = row.registration_kind === 'own_domain';
  const professionalFirm = /professional firm name/i.test(row.class_reason ?? '');

  if (row.source_kind === 'host_search') {
    if (!live) return 0;
    if (entity === 'education_company') return 1;
    if (professionalFirm && ownReg) return 2;
    if (entity === 'commercial_vendor') return 0;
    return live ? 1 : 0;
  }

  if (entity === 'education_company') {
    return isClearlyRecordedOnly(row) ? 0 : 1;
  }
  if (professionalFirm && live && ownReg) return 2;
  return 0;
}

/** Name leaks that are not training shops (for host_keep.csv). */
export function isHostKeepLeak(name: string): boolean {
  const n = name.toLowerCase();
  if (
    /\b(university|ucla|usc |nyu |school of|college of|health system|hospital|medical center|the college of|department of|council of|council on)\b/i.test(
      n,
    ) ||
    /\bcounseling and psychological services\b/i.test(n) ||
    (/\bcouncil\b/i.test(n) && !/\badvanced training\b/i.test(n))
  ) {
    return true;
  }
  const advancedTrainingShop = /\badvanced training\b/i.test(n);
  if (/\bfoundation\b/i.test(n) && !advancedTrainingShop) return true;
  if (/\bassociation\b/i.test(n) && !advancedTrainingShop) return true;
  if (/\bsociety of\b/i.test(n) || /\beducation society\b/i.test(n)) return true;
  return false;
}

const MANUFACTURER_DIRECTORIES = new Set([
  'arcat',
  'greence',
  'ronblank',
  'aecdaily',
  'cestrong',
  'bnp',
]);

export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Strip live_online from rows whose CE evidence came from a CE platform URL
 * (e.g. BNP, GreenCE boilerplate), so it doesn't mint false candidates.
 */
function stripPlatformLiveOnline(
  rows: FitRecord[],
): Array<{ ce_formats?: string; has_live_online?: unknown }> {
  return rows.map((r) => {
    const pageUrl = r.ce_page_url || r.source_url || '';
    const host = hostnameOf(pageUrl);
    if (host && isCePlatformHost(host) && r.source_directory !== 'ce_platform') {
      const formats = (r.ce_formats || '')
        .split('|')
        .filter((f) => f !== 'live_online')
        .join('|');
      return { ce_formats: formats, has_live_online: false };
    }
    return { ce_formats: r.ce_formats, has_live_online: r.has_live_online };
  });
}

export type EvidenceLike = {
  company_name: string;
  source_kind: string;
  source_url: string;
  page_title: string;
  extract_snippet: string;
  registration_url: string;
  audience_profession: string;
  fetched_at: string;
  fit_tier?: number;
};

export function aggregateProspects(rows: FitRecord[]): {
  prospects: ProspectRow[];
  evidence: EvidenceLike[];
} {
  const groups = new Map<string, FitRecord[]>();
  for (const row of rows) {
    const key = companyKey(row.provider_name || (row as unknown as { company_name?: string }).company_name || '');
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const prospects: ProspectRow[] = [];
  const evidence: EvidenceLike[] = [];

  for (const [, list] of groups) {
    const display = pickDisplayName(list);
    const entity = pickMostVendor(list);
    const selfProvided = list.some((r) => asBool(r.self_provided));
    const isFree = list.some((r) => asFree(r.is_free) === true)
      ? true
      : list.every((r) => asFree(r.is_free) === false)
        ? false
        : list.find((r) => asFree(r.is_free) != null)
          ? asFree(list.find((r) => asFree(r.is_free) != null)!.is_free)
          : null;
    const registrationKind = pickRegKind(list);
    const grantProgram = list.some((r) => asBool(r.has_formal_grant_program));
    const format = mergeCeFormats(stripPlatformLiveOnline(list));
    const sourceKind = list.some((r) => r.source_kind === 'directory')
      ? 'directory'
      : list.some((r) => r.source_kind === 'host_search')
        ? 'host_search'
        : 'grant_search';

    const tier = assignFitTier({
      entity_class: entity,
      self_provided: selfProvided,
      is_free: isFree,
      registration_kind: registrationKind,
      has_formal_grant_program: grantProgram,
      has_live_online: format.has_live_online,
      source_kind: sourceKind,
    });

    const urls = [...new Set(list.map((r) => r.ce_page_url || r.source_url || r.homepage_url).filter(Boolean))];
    const professions = [...new Set(list.map((r) => r.audience_profession).filter(Boolean))];
    const dirs = [...new Set(list.map((r) => r.source_directory).filter(Boolean))];
    const relationship = pickRelationship(list);

    const hostTier = assignHostTier({
      entity_class: entity,
      class_reason:
        list.find((r) => /professional firm name/i.test(r.class_reason ?? ''))?.class_reason ??
        list.find((r) => r.class_reason)?.class_reason,
      source_directory: list.some((r) => r.source_directory === 'ce_platform')
        ? 'ce_platform'
        : list.find((r) => r.source_directory)?.source_directory,
      source_kind: sourceKind,
      registration_kind: registrationKind,
      has_live_online: format.has_live_online,
      ce_formats: format.ce_formats_csv,
      primary_ce_format: format.primary_ce_format,
    });

    prospects.push({
      company_name: display,
      fit_tier: tier,
      host_tier: hostTier,
      activity_count: list.length,
      entity_class: entity,
      self_provided: selfProvided,
      is_free: isFree,
      registration_kind: registrationKind,
      registration_host_domain: list.find((r) => r.registration_host_domain)?.registration_host_domain ?? '',
      audience_profession: professions.join('; '),
      audience_relationship: relationship,
      company_sells_what: list.find((r) => r.company_sells_what)?.company_sells_what ?? '',
      has_formal_grant_program: grantProgram,
      ce_formats: format.ce_formats_csv,
      primary_ce_format: format.primary_ce_format,
      has_live_online: format.has_live_online,
      source_directories: dirs.join('; '),
      example_urls: urls.slice(0, 3).join(' | '),
      needs_review: list.some((r) => asBool(r.needs_review) || r.entity_class === 'unknown'),
      easy_audience_access_review: '',
    });

    for (const row of list) {
      evidence.push({
        company_name: display,
        source_kind: row.source_kind,
        source_url: row.ce_page_url || row.source_url || row.homepage_url,
        page_title: row.activity_title,
        extract_snippet: row.class_reason,
        registration_url: row.registration_url,
        audience_profession: row.audience_profession,
        fetched_at: new Date().toISOString(),
        fit_tier: tier,
      });
    }
  }

  prospects.sort((a, b) => {
    const tierA = a.fit_tier === 0 ? 99 : a.fit_tier;
    const tierB = b.fit_tier === 0 ? 99 : b.fit_tier;
    if (tierA !== tierB) return tierA - tierB;
    if (a.self_provided !== b.self_provided) return a.self_provided ? -1 : 1;
    if (a.has_live_online !== b.has_live_online) return a.has_live_online ? -1 : 1;
    return b.activity_count - a.activity_count;
  });

  return { prospects, evidence };
}

function pickDisplayName(list: FitRecord[]): string {
  return list[0]?.provider_name || '';
}

function pickMostVendor(list: FitRecord[]): EntityClass {
  if (list.some((r) => r.entity_class === 'commercial_vendor')) return 'commercial_vendor';
  if (
    list.some(
      (r) => r.entity_class === 'society' && MANUFACTURER_DIRECTORIES.has(r.source_directory),
    )
  ) {
    return 'commercial_vendor';
  }
  if (list.some((r) => r.entity_class === 'education_company')) return 'education_company';
  if (list.some((r) => r.entity_class === 'institution')) return 'institution';
  if (list.some((r) => r.entity_class === 'society')) return 'society';
  return 'unknown';
}

function pickRegKind(list: FitRecord[]): RegistrationKind {
  if (list.some((r) => r.registration_kind === 'own_domain')) return 'own_domain';
  if (list.some((r) => r.registration_kind === 'third_party')) return 'third_party';
  return 'unknown';
}

function pickRelationship(list: FitRecord[]): AudienceRelationship {
  if (list.some((r) => r.audience_relationship === 'partner')) return 'partner';
  if (
    list.some(
      (r) => r.entity_class === 'society' && MANUFACTURER_DIRECTORIES.has(r.source_directory),
    )
  ) {
    return 'partner';
  }
  if (list.some((r) => r.audience_relationship === 'customer')) return 'customer';
  return 'unknown';
}
