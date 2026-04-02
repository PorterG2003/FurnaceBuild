import { Platform } from 'react-native';
import type { ExportCompanyChainPeopleRow, ExportCompanyOwnerLeadRow } from '@/lib/foundry/registry-types';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_HEADER: (keyof ExportCompanyOwnerLeadRow)[] = [
  'company_id',
  'legal_name',
  'normalized_key',
  'company_updated_at',
  'has_current_linked_source',
  'linked_source_count',
  'registry_state',
  'registry_entity_id',
  'state_entity_state',
  'state_entity_legal_name',
  'entity_owner_id',
  'owner_name',
  'title_role',
  'effective_at',
  'observed_at',
  'parser_version',
  'provenance_snapshot_id',
  'address_line_1',
  'address_line_2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'primary_location_city',
  'primary_location_state',
  'website',
  'has_current_owner',
  'has_open_review_task',
  'has_parse_failure_task',
  'is_export_ready',
];

export function exportCompanyOwnerLeadsToCsv(rows: ExportCompanyOwnerLeadRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(CSV_HEADER.map((k) => csvCell(r[k])).join(','));
  }
  return lines.join('\n');
}

const CHAIN_PEOPLE_CSV_HEADER: (keyof ExportCompanyChainPeopleRow)[] = [
  'company_id',
  'company_legal_name',
  'company_entity_match_id',
  'registry_state',
  'state_entity_id',
  'registry_entity_id',
  'state_entity_legal_name',
  'address_line_1',
  'address_line_2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'website',
  'person_owner_row_id',
  'person_name',
  'person_first_name',
  'person_last_name',
  'person_title_role',
  'chain_depth',
  'linkage_path',
  'has_current_linked_source',
  'has_current_owner',
  'has_open_review_task',
  'has_parse_failure_task',
  'is_export_ready',
];

export function exportCompanyChainPeopleToCsv(rows: ExportCompanyChainPeopleRow[]): string {
  const lines = [CHAIN_PEOPLE_CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(CHAIN_PEOPLE_CSV_HEADER.map((k) => csvCell(r[k])).join(','));
  }
  return lines.join('\n');
}

export function downloadCsvOnWeb(filename: string, csv: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
