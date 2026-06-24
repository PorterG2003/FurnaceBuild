import { isEmailBlockedByEntries } from '@/lib/leads/block-list-match';
import type { BlockListEntry } from '@/lib/supabase/types';

export const CSV_STANDARD_FIELD_KEYS = [
  'email',
  'name',
  'first_name',
  'last_name',
  'company_name',
  'website',
  'linkedin_url',
  'company_linkedin_url',
] as const;

export type CsvStandardFieldKey = (typeof CSV_STANDARD_FIELD_KEYS)[number];
export type CsvFieldMappings = Record<CsvStandardFieldKey, string>;
export type CsvRow = Record<string, string>;

/** Lead payload shape accepted by `import_api_leads_to_campaign`. */
export type CsvImportLeadPayload = {
  email: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  company_linkedin_url?: string | null;
  custom_lead_data?: Record<string, string> | null;
};

export type CsvDedupeStats = {
  totalInput: number;
  kept: number;
  removedWithinFile: number;
  removedInCampaigns: number;
  removedBlocked: number;
};

export type CsvDedupeResult = {
  kept: CsvRow[];
  stats: CsvDedupeStats;
};

export type CsvDedupeOptions = {
  dedupeWithinFile: boolean;
  filterInCampaigns: boolean;
  filterBlockList: boolean;
  emailColumn: string | undefined;
  matchingCampaignEmails: Set<string>;
  blockListEntries: BlockListEntry[];
};

function sanitizeValue(value?: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeCsvEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function extractEmailFromRow(row: CsvRow, emailColumn: string | undefined): string | null {
  if (!emailColumn) return null;
  return normalizeCsvEmail(sanitizeValue(row[emailColumn]));
}

export function extractUniqueEmailsFromRows(rows: CsvRow[], emailColumn: string | undefined): string[] {
  const emails = new Set<string>();
  for (const row of rows) {
    const email = extractEmailFromRow(row, emailColumn);
    if (email) emails.add(email);
  }
  return [...emails];
}

export function mapCsvRowToLeadPayload(
  row: CsvRow,
  fieldMappings: CsvFieldMappings,
  customFieldColumns: string[],
): CsvImportLeadPayload | null {
  const valueForColumn = (columnName?: string) => sanitizeValue(columnName ? row[columnName] : undefined);

  const email = valueForColumn(fieldMappings.email);
  const firstName = valueForColumn(fieldMappings.first_name);
  const lastName = valueForColumn(fieldMappings.last_name);
  const combinedName = valueForColumn(fieldMappings.name);
  const companyName = valueForColumn(fieldMappings.company_name);
  const website = valueForColumn(fieldMappings.website);
  const linkedinUrl = valueForColumn(fieldMappings.linkedin_url);
  const companyLinkedinUrl = valueForColumn(fieldMappings.company_linkedin_url);

  const derivedName =
    combinedName || [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  const customData = customFieldColumns.reduce<Record<string, string>>((acc, column) => {
    const value = valueForColumn(column);
    if (value !== null) acc[column] = value;
    return acc;
  }, {});

  const hasPrimaryFields = email || derivedName || firstName || lastName || companyName;
  if (!hasPrimaryFields && Object.keys(customData).length === 0) {
    return null;
  }

  if (!email) return null;

  const payload: CsvImportLeadPayload = {
    email,
    name: derivedName,
    first_name: firstName,
    last_name: lastName,
    company_name: companyName,
    website,
    linkedin_url: linkedinUrl,
    company_linkedin_url: companyLinkedinUrl,
  };

  if (Object.keys(customData).length > 0) {
    payload.custom_lead_data = customData;
  }

  return payload;
}

export function mapCsvRowsToLeadPayloads(
  rows: CsvRow[],
  fieldMappings: CsvFieldMappings,
  customFieldColumns: string[],
): CsvImportLeadPayload[] {
  return rows
    .map((row) => mapCsvRowToLeadPayload(row, fieldMappings, customFieldColumns))
    .filter((payload): payload is CsvImportLeadPayload => payload !== null);
}

export function dedupeWithinFile(
  rows: CsvRow[],
  emailColumn: string | undefined,
): { kept: CsvRow[]; removed: number } {
  if (!emailColumn) {
    return { kept: rows, removed: 0 };
  }

  const seen = new Set<string>();
  const kept: CsvRow[] = [];
  let removed = 0;

  for (const row of rows) {
    const email = extractEmailFromRow(row, emailColumn);
    if (!email) {
      kept.push(row);
      continue;
    }
    if (seen.has(email)) {
      removed += 1;
      continue;
    }
    seen.add(email);
    kept.push(row);
  }

  return { kept, removed };
}

export function filterExistingCampaignEmails(
  rows: CsvRow[],
  emailColumn: string | undefined,
  existingEmails: Set<string>,
): { kept: CsvRow[]; removed: number } {
  if (!emailColumn || existingEmails.size === 0) {
    return { kept: rows, removed: 0 };
  }

  const kept: CsvRow[] = [];
  let removed = 0;

  for (const row of rows) {
    const email = extractEmailFromRow(row, emailColumn);
    if (email && existingEmails.has(email)) {
      removed += 1;
      continue;
    }
    kept.push(row);
  }

  return { kept, removed };
}

export function filterBlockedEmails(
  rows: CsvRow[],
  emailColumn: string | undefined,
  blockListEntries: BlockListEntry[],
): { kept: CsvRow[]; removed: number } {
  if (!emailColumn || blockListEntries.length === 0) {
    return { kept: rows, removed: 0 };
  }

  const kept: CsvRow[] = [];
  let removed = 0;

  for (const row of rows) {
    const email = extractEmailFromRow(row, emailColumn);
    if (email && isEmailBlockedByEntries(email, blockListEntries)) {
      removed += 1;
      continue;
    }
    kept.push(row);
  }

  return { kept, removed };
}

export function runCsvDedupePipeline(rows: CsvRow[], options: CsvDedupeOptions): CsvDedupeResult {
  const totalInput = rows.length;
  let current = rows;

  let removedWithinFile = 0;
  if (options.dedupeWithinFile) {
    const result = dedupeWithinFile(current, options.emailColumn);
    current = result.kept;
    removedWithinFile = result.removed;
  }

  let removedInCampaigns = 0;
  if (options.filterInCampaigns) {
    const result = filterExistingCampaignEmails(
      current,
      options.emailColumn,
      options.matchingCampaignEmails,
    );
    current = result.kept;
    removedInCampaigns = result.removed;
  }

  let removedBlocked = 0;
  if (options.filterBlockList) {
    const result = filterBlockedEmails(current, options.emailColumn, options.blockListEntries);
    current = result.kept;
    removedBlocked = result.removed;
  }

  return {
    kept: current,
    stats: {
      totalInput,
      kept: current.length,
      removedWithinFile,
      removedInCampaigns,
      removedBlocked,
    },
  };
}

export function createEmptyCsvFieldMappings(): CsvFieldMappings {
  return {
    email: '',
    name: '',
    first_name: '',
    last_name: '',
    company_name: '',
    website: '',
    linkedin_url: '',
    company_linkedin_url: '',
  };
}
