import { normalizeNameKey } from '../ingestion/normalizeSourceRecord.js';

export type OwnerKind = 'entity' | 'person' | 'unknown';

export type OwnerResolutionStatus =
  | 'unclassified'
  | 'person'
  | 'entity_enqueued'
  | 'entity_resolved'
  | 'entity_no_hit'
  | 'entity_ambiguous'
  | 'entity_parse_failed'
  | 'max_depth_reached'
  | 'cycle_skipped';

export type OwnerClassification = {
  kind: OwnerKind;
  reason: string;
};

export type DrilldownWorkItem = {
  state: string;
  originCompanyId: string;
  depth: number;
  ownerNameRaw: string;
  ownerNormalizedKey: string;
  parentStateEntityId: string;
  ownerRowId: string;
};

export type PersistEntityOwnerInput = {
  ownerName: string;
  titleRole: string | null;
  ownerKind?: OwnerKind | null;
  resolutionStatus?: OwnerResolutionStatus | null;
  resolvedStateEntityId?: string | null;
  discoveryDepth?: number | null;
  resolutionNotes?: Record<string, unknown> | null;
};

export type PersistedEntityOwnerRow = {
  id: string;
  owner_name: string;
  title_role: string | null;
  owner_normalized_key: string | null;
  owner_kind: OwnerKind | null;
  resolution_status: OwnerResolutionStatus | null;
  resolved_state_entity_id: string | null;
  discovery_depth: number | null;
};

const ENTITY_TOKEN_RE =
  /\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|L\.P\.|LLP|L\.L\.P\.|PC|P\.C\.|COMPANY|CO\.|HOLDINGS|VENTURES|TRUST|ASSOCIATES|GROUP|PARTNERS|PARTNERSHIP|PROPERTIES|INVESTMENTS|ENTERPRISES|FOUNDATION)\b/i;
const PERSON_SUFFIX_RE = /\b(JR|SR|II|III|IV|MD|DDS|DMD|ESQ|CPA)\b\.?$/i;

function cleanOwnerName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function looksLikeNaturalPerson(name: string): boolean {
  const cleaned = cleanOwnerName(name)
    .replace(/,/g, ' ')
    .replace(PERSON_SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /\d/.test(cleaned)) return false;
  if (/[&/]/.test(cleaned)) return false;
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length < 2 || parts.length > 5) return false;
  return parts.every((part, index) => {
    if (index > 0 && /^[A-Z]$/i.test(part)) return true;
    return /^[A-Z][A-Z'\-]+$/i.test(part);
  });
}

export function classifyOwnerName(ownerName: string): OwnerClassification {
  const cleaned = cleanOwnerName(ownerName);
  if (!cleaned) {
    return { kind: 'unknown', reason: 'empty_name' };
  }
  if (ENTITY_TOKEN_RE.test(cleaned)) {
    return { kind: 'entity', reason: 'organization_marker' };
  }
  if (looksLikeNaturalPerson(cleaned)) {
    return { kind: 'person', reason: 'natural_person_shape' };
  }
  return { kind: 'unknown', reason: 'weak_signal' };
}

export function ownerResolutionStatusForSeed(params: {
  kind: OwnerKind;
  discoveryDepth: number;
  depthMax: number;
}): OwnerResolutionStatus {
  if (params.kind === 'person') return 'person';
  if (params.kind === 'unknown') return 'unclassified';
  return params.discoveryDepth > params.depthMax ? 'max_depth_reached' : 'entity_enqueued';
}

export function buildOwnerQueryKey(state: string, ownerName: string): string {
  return `${state}:${normalizeNameKey(ownerName)}`;
}

export function buildRegistryEntityKey(state: string, registryEntityId: string): string {
  return `${state}:${registryEntityId.trim()}`;
}

export function buildDrilldownWorkItem(params: {
  state: string;
  originCompanyId: string;
  depth: number;
  ownerNameRaw: string;
  parentStateEntityId: string;
  ownerRowId: string;
}): DrilldownWorkItem {
  return {
    state: params.state,
    originCompanyId: params.originCompanyId,
    depth: params.depth,
    ownerNameRaw: params.ownerNameRaw.trim(),
    ownerNormalizedKey: normalizeNameKey(params.ownerNameRaw),
    parentStateEntityId: params.parentStateEntityId,
    ownerRowId: params.ownerRowId,
  };
}
