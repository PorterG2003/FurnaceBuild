import type { GenerateCandidatesResponse, SourceRecordDetailResponse } from '@/lib/foundry/registry-types';

/** Aligned with auto-link behavior in entityResolution (not a second backend rule). */
export const WEAK_MATCH_UI_THRESHOLD = 0.92;

export interface SourceRecordImportedFields {
  /** This source_business_records.id (for labels and support). */
  sourceRecordId: string;
  sourceName: string | null;
  nameRaw: string;
  website: string | null;
  phone: string | null;
  addressRaw: string | null;
  ingestionRunId: string | null;
  observedAt: string | null;
}

export interface SourceRecordNormalization {
  normalizedNameKey: string | null;
  inferredStateRegion: string | null;
}

export interface SourceLinkedState {
  companyId: string | null;
  companyLegalName: string | null;
}

export interface SourceCandidateRow {
  companyId: string;
  legalName: string;
  normalizedKey: string | null;
  linkScore: number;
  primaryAddressLine: string | null;
  linkedSourceWebsites: string[];
}

export interface SourceRecordMatchConfidence {
  bestCandidateScore: number | null;
  /** True when not linked, there are candidates, and best score is below auto-link confidence. */
  weakAutomaticMatch: boolean;
}

export interface SourceRecordViewModel {
  imported: SourceRecordImportedFields;
  normalization: SourceRecordNormalization;
  linked: SourceLinkedState;
  candidates: SourceCandidateRow[];
  match: SourceRecordMatchConfidence;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function isCurrentLink(row: Record<string, unknown>): boolean {
  return row.is_current === true;
}

export function buildSourceRecordViewModel(detail: SourceRecordDetailResponse): SourceRecordViewModel {
  const rec = detail.record;
  const recordId =
    typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : (str(rec.id) ?? '');
  const meta = (rec.resolution_meta ?? null) as Record<string, unknown> | null;
  const normalizedNameKey =
    meta && typeof meta.normalized_name_key === 'string' ? meta.normalized_name_key : null;
  const inferredStateRegion =
    meta && typeof meta.inferred_state_region === 'string' ? meta.inferred_state_region : null;

  const imported: SourceRecordImportedFields = {
    sourceRecordId: recordId,
    sourceName: str(rec.source_name),
    nameRaw: str(rec.name_raw) ?? '—',
    website: str(rec.website),
    phone: str(rec.phone),
    addressRaw: str(rec.address_raw),
    ingestionRunId: str(rec.ingestion_run_id),
    observedAt: str(rec.observed_at),
  };

  const currentLinks = detail.links.filter((l) => isCurrentLink(l as Record<string, unknown>));

  let linkedCompanyId: string | null = null;
  let linkedCompanyLegalName: string | null = null;
  for (const raw of currentLinks) {
    const row = raw as Record<string, unknown>;
    if (row.link_status !== 'linked') continue;
    const cid = str(row.company_id);
    if (!cid) continue;
    linkedCompanyId = cid;
    const co = detail.companiesById[cid];
    linkedCompanyLegalName = co?.legal_name ?? cid.slice(0, 8) + '…';
    break;
  }

  const candidates: SourceCandidateRow[] = [];
  for (const raw of currentLinks) {
    const row = raw as Record<string, unknown>;
    if (row.link_status !== 'candidate') continue;
    const cid = str(row.company_id);
    if (!cid) continue;
    const score = Number(row.link_score);
    const co = detail.companiesById[cid];
    candidates.push({
      companyId: cid,
      legalName: co?.legal_name ?? `Company ${cid.slice(0, 8)}…`,
      normalizedKey: co?.normalized_key ?? null,
      linkScore: Number.isFinite(score) ? score : 0,
      primaryAddressLine: co?.primary_address_line ?? null,
      linkedSourceWebsites: co?.linked_source_websites ?? [],
    });
  }
  candidates.sort((a, b) => b.linkScore - a.linkScore);

  const bestCandidateScore =
    candidates.length === 0 ? null : Math.max(...candidates.map((c) => c.linkScore));
  const weakAutomaticMatch =
    linkedCompanyId == null &&
    candidates.length > 0 &&
    bestCandidateScore != null &&
    bestCandidateScore < WEAK_MATCH_UI_THRESHOLD;

  return {
    imported,
    normalization: { normalizedNameKey, inferredStateRegion },
    linked: { companyId: linkedCompanyId, companyLegalName: linkedCompanyLegalName },
    candidates,
    match: { bestCandidateScore, weakAutomaticMatch },
  };
}

export function formatLinkScore(score: number): string {
  if (!Number.isFinite(score)) return '—';
  return `${(score * 100).toFixed(1)}%`;
}

export function formatGenerateCandidatesMessage(r: GenerateCandidatesResponse): string {
  if (r.skipped_existing_linked) {
    return 'Skipped — this row is already linked to a company. No new candidates were added.';
  }
  const n = r.inserted_link_ids.length;
  const found = r.candidates.length;
  if (n === 0 && found === 0) {
    return 'No directory matches found; 0 candidate links inserted. Try Create company + link, or confirm normalization keys.';
  }
  if (n === 0) {
    return `Found ${found} possible match(es) but inserted 0 new candidate links (they may already exist). See list below after refresh.`;
  }
  return `Inserted ${n} candidate link${n === 1 ? '' : 's'}.`;
}
