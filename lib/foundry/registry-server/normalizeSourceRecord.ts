/**
 * Deterministic normalization for source business records (v1 US-oriented).
 * Output is stored in source_business_records.resolution_meta; raw_payload is not modified.
 */

export const NORMALIZER_VERSION = 'foundry_normalize_v1';

export interface ResolutionMeta {
  normalized_name_key: string;
  normalized_domain_key: string | null;
  inferred_state_region: string | null;
  quality_flags: string[];
  normalizer_version: string;
  normalized_at: string;
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Lowercase alphanumeric + single spaces; collapse whitespace. */
export function normalizeNameKey(nameRaw: string): string {
  const s = stripDiacritics(nameRaw)
    .toLowerCase()
    .replace(/[.,'"&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const suffixes =
    /\b(inc|llc|ltd|corp|corporation|company|co|plc|lp|llp|dba)\b\.?$/gi;
  let out = s.replace(suffixes, '').trim();
  out = out.replace(/\s+/g, '_');
  return out || 'unknown';
}

export function normalizeDomainKey(website: string | null | undefined): string | null {
  if (website == null || String(website).trim() === '') return null;
  let h = String(website).trim().toLowerCase();
  h = h.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const slash = h.indexOf('/');
  if (slash >= 0) h = h.slice(0, slash);
  const colon = h.indexOf(':');
  if (colon >= 0) h = h.slice(0, colon);
  if (!h || h === '') return null;
  return h;
}

/** Best-effort US state (2 letters) from freeform address. */
export function inferUSStateRegion(addressRaw: string | null | undefined): string | null {
  if (!addressRaw || typeof addressRaw !== 'string') return null;
  const a = addressRaw.trim();
  const zipState = a.match(/,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\s*$/);
  if (zipState) return zipState[1].toUpperCase();
  const loose = a.match(/\b([A-Za-z]{2})\s+\d{5}\b/);
  if (loose) return loose[1].toUpperCase();
  return null;
}

export function buildResolutionMeta(input: {
  name_raw: string;
  website: string | null | undefined;
  address_raw: string | null | undefined;
}): ResolutionMeta {
  const quality_flags: string[] = [];
  if (!input.name_raw || input.name_raw.trim().length < 2) {
    quality_flags.push('weak_name');
  }
  const normalized_name_key = normalizeNameKey(input.name_raw || '');
  const normalized_domain_key = normalizeDomainKey(input.website ?? null);
  const inferred_state_region = inferUSStateRegion(input.address_raw ?? null);
  if (!inferred_state_region && (input.address_raw?.trim().length ?? 0) > 3) {
    quality_flags.push('state_unclear');
  }
  if (!normalized_domain_key && (input.website?.trim().length ?? 0) > 0) {
    quality_flags.push('domain_parse_failed');
  }

  return {
    normalized_name_key,
    normalized_domain_key,
    inferred_state_region,
    quality_flags,
    normalizer_version: NORMALIZER_VERSION,
    normalized_at: new Date().toISOString(),
  };
}
