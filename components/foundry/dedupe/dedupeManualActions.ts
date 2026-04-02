import { type DedupeMergeField, type DedupeMergeReadOnlyRow } from '@/components/foundry/dedupe/DedupeMergeModal';
import {
  formatEntityMatchesPreview,
  formatLocationsPreview,
  formatSourceLinksPreview,
  MERGE_HINT_ENTITY_MATCHES,
  MERGE_HINT_LOCATIONS,
  MERGE_HINT_SOURCE_LINKS,
} from '@/components/foundry/dedupe/companyMergePreviewText';
import { fetchCompanyDetail } from '@/lib/foundry/registry-client';
import type { ParsedCompanyDetail, RegistryCompany, RegistryEntityOwnerRow } from '@/lib/foundry/registry-types';

export const companyMergeFields: DedupeMergeField[] = [
  { key: 'legal_name', label: 'Legal name' },
  { key: 'notes', label: 'Notes' },
];

export const entityOwnerMergeFields: DedupeMergeField[] = [
  { key: 'owner_name', label: 'Owner name' },
  { key: 'title_role', label: 'Title / role' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
];

export function getSelectedDeleteTargetId<T extends { id: string }>(rows: T[]): string | null {
  return rows.length === 1 ? rows[0]!.id : null;
}

export function getCompanyValueMatrix(rows: RegistryCompany[]): string[][] {
  return [rows.map((row) => row.legal_name), rows.map((row) => row.notes ?? '')];
}

export function getEntityOwnerValueMatrix(rows: RegistryEntityOwnerRow[]): string[][] {
  return [
    rows.map((row) => row.owner_name),
    rows.map((row) => row.title_role ?? ''),
    rows.map((row) => row.first_name ?? ''),
    rows.map((row) => row.last_name ?? ''),
  ];
}

export async function loadCompanyMergePreviewDetails(companyIds: string[]): Promise<ParsedCompanyDetail[]> {
  return Promise.all(companyIds.map((id) => fetchCompanyDetail(id)));
}

export function buildCompanyMergeReadOnlyRows(
  selectedCompanies: RegistryCompany[],
  mergePreviewLoading: boolean,
  mergePreviewDetails: ParsedCompanyDetail[] | null,
): DedupeMergeReadOnlyRow[] | undefined {
  if (selectedCompanies.length < 2) return undefined;
  const count = selectedCompanies.length;
  const loadingCells = () => Array.from({ length: count }, () => 'Loading…');
  const emptyCells = () => Array.from({ length: count }, () => '—');

  if (mergePreviewLoading) {
    return [
      { key: 'source_links', label: 'Source links', cells: loadingCells(), mergedHint: MERGE_HINT_SOURCE_LINKS },
      { key: 'entity_matches', label: 'Entity matches', cells: loadingCells(), mergedHint: MERGE_HINT_ENTITY_MATCHES },
      { key: 'locations', label: 'Locations', cells: loadingCells(), mergedHint: MERGE_HINT_LOCATIONS },
    ];
  }

  if (mergePreviewDetails && mergePreviewDetails.length === count) {
    return [
      {
        key: 'source_links',
        label: 'Source links',
        cells: mergePreviewDetails.map((detail) => formatSourceLinksPreview(detail.source_links)),
        mergedHint: MERGE_HINT_SOURCE_LINKS,
      },
      {
        key: 'entity_matches',
        label: 'Entity matches',
        cells: mergePreviewDetails.map((detail) => formatEntityMatchesPreview(detail.entity_matches)),
        mergedHint: MERGE_HINT_ENTITY_MATCHES,
      },
      {
        key: 'locations',
        label: 'Locations',
        cells: mergePreviewDetails.map((detail) => formatLocationsPreview(detail.locations)),
        mergedHint: MERGE_HINT_LOCATIONS,
      },
    ];
  }

  return [
    { key: 'source_links', label: 'Source links', cells: emptyCells(), mergedHint: MERGE_HINT_SOURCE_LINKS },
    { key: 'entity_matches', label: 'Entity matches', cells: emptyCells(), mergedHint: MERGE_HINT_ENTITY_MATCHES },
    { key: 'locations', label: 'Locations', cells: emptyCells(), mergedHint: MERGE_HINT_LOCATIONS },
  ];
}

export function buildCompanyMergePayload(rows: RegistryCompany[], merged: Record<string, string>, survivorIdx: number) {
  const survivor = rows[survivorIdx];
  if (!survivor) return null;
  return {
    survivor_company_id: survivor.id,
    other_company_ids: rows.filter((_, index) => index !== survivorIdx).map((row) => row.id),
    merged: {
      legal_name: merged.legal_name,
      notes: merged.notes || null,
    },
  };
}

export function buildEntityOwnerMergePayload(
  rows: RegistryEntityOwnerRow[],
  merged: Record<string, string>,
  survivorIdx: number,
) {
  const survivor = rows[survivorIdx];
  if (!survivor) return null;
  return {
    survivor_entity_owner_id: survivor.id,
    other_entity_owner_ids: rows.filter((_, index) => index !== survivorIdx).map((row) => row.id),
    merged: {
      owner_name: merged.owner_name,
      title_role: merged.title_role.trim() ? merged.title_role : null,
      first_name: merged.first_name.trim() ? merged.first_name : null,
      last_name: merged.last_name.trim() ? merged.last_name : null,
    },
  };
}
