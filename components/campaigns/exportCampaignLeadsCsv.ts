import type { CampaignLeadTableRow } from '@/lib/supabase/services/leads';

const CAMPAIGN_LEAD_CSV_BASE_COLUMNS = [
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
  'phone_number',
  'source',
  'status',
  'reply_category',
  'enrollment_state',
  'enrollment_current_node_id',
  'enrollment_stopped_reason',
  'enrollment_stopped_error_message',
  'replacement_role',
  'replacement_counterpart_name',
  'replacement_counterpart_email',
  'replacement_reason',
  'replacement_reason_note',
  'replacement_completed_at',
  'created_at',
] as const satisfies readonly string[];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const normalized =
    typeof value === 'object' ? JSON.stringify(value) : typeof value === 'string' ? value : String(value);
  if (/[",\n\r]/.test(normalized)) return `"${normalized.replace(/"/g, '""')}"`;
  return normalized;
}

function getCustomLeadKeys(rows: CampaignLeadTableRow[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!row.custom_lead_data || typeof row.custom_lead_data !== 'object' || Array.isArray(row.custom_lead_data)) {
      continue;
    }
    Object.keys(row.custom_lead_data).forEach((key) => keys.add(key));
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function getCsvValue(row: CampaignLeadTableRow, column: string): unknown {
  if (column in row) {
    return row[column as keyof CampaignLeadTableRow];
  }
  if (row.custom_lead_data && typeof row.custom_lead_data === 'object' && !Array.isArray(row.custom_lead_data)) {
    return row.custom_lead_data[column];
  }
  return '';
}

export function exportCampaignLeadsToCsv(rows: CampaignLeadTableRow[]): string {
  const customColumns = getCustomLeadKeys(rows);
  const header = [...CAMPAIGN_LEAD_CSV_BASE_COLUMNS, ...customColumns];
  const lines = [header.join(',')];

  for (const row of rows) {
    lines.push(header.map((column) => csvCell(getCsvValue(row, column))).join(','));
  }

  return lines.join('\n');
}

export function downloadCsvOnWeb(filename: string, csv: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
