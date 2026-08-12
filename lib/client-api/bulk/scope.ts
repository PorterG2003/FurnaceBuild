/**
 * Server-side bulk scope model for Client API / MCP.
 * Extends the UI workbench BulkScope with campaign and staged-upload sources.
 */

export const API_BULK_SCOPE_KINDS = [
  'selection',
  'explorer_view',
  'saved_list',
  'saved_list_filtered',
  'campaign',
  'staged_upload',
] as const;

export type ApiBulkScopeKind = (typeof API_BULK_SCOPE_KINDS)[number];

export type ApiExplorerViewQuery = {
  campaign_ids?: string[];
  reply_statuses?: string[];
  enrollment_states?: string[];
  reply_categories?: string[];
  search?: string | null;
  tag_ids?: string[];
};

export type ApiSavedListFilteredQuery = {
  campaign_ids?: string[];
  reply_statuses?: string[];
  enrollment_states?: string[];
  reply_categories?: string[];
  search?: string | null;
};

export type ApiBulkScope =
  | {
      kind: 'selection';
      global_lead_ids: string[];
    }
  | {
      kind: 'explorer_view';
      query: ApiExplorerViewQuery;
    }
  | {
      kind: 'saved_list';
      list_id: string;
    }
  | {
      kind: 'saved_list_filtered';
      list_id: string;
      query: ApiSavedListFilteredQuery;
    }
  | {
      kind: 'campaign';
      campaign_id: string;
    }
  | {
      kind: 'staged_upload';
      upload_id: string;
    };

export type ApiBulkExclusions = {
  list_id?: string;
  campaign_id?: string;
  global_lead_ids?: string[];
  emails?: string[];
};

export function isApiBulkScopeKind(value: unknown): value is ApiBulkScopeKind {
  return typeof value === 'string' && (API_BULK_SCOPE_KINDS as readonly string[]).includes(value);
}

export function normalizeStringIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))];
}

export function normalizeEmails(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
        .map((email) => email.trim().toLowerCase()),
    ),
  ];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function parseApiBulkExclusions(raw: unknown): ApiBulkExclusions | null {
  if (raw == null) return null;
  const row = asObject(raw);
  const exclusions: ApiBulkExclusions = {};
  if (typeof row.list_id === 'string' && row.list_id.trim()) exclusions.list_id = row.list_id.trim();
  if (typeof row.campaign_id === 'string' && row.campaign_id.trim()) {
    exclusions.campaign_id = row.campaign_id.trim();
  }
  const ids = normalizeStringIds(row.global_lead_ids);
  if (ids.length) exclusions.global_lead_ids = ids;
  const emails = normalizeEmails(row.emails);
  if (emails.length) exclusions.emails = emails;
  return Object.keys(exclusions).length ? exclusions : null;
}

export function parseApiBulkScope(raw: unknown): ApiBulkScope | null {
  if (raw == null) return null;
  const row = asObject(raw);
  const kind = row.kind;
  if (!isApiBulkScopeKind(kind)) return null;

  switch (kind) {
    case 'selection': {
      const globalLeadIds = normalizeStringIds(row.global_lead_ids);
      if (!globalLeadIds.length) return null;
      return { kind, global_lead_ids: globalLeadIds };
    }
    case 'explorer_view': {
      return { kind, query: asObject(row.query) as ApiExplorerViewQuery };
    }
    case 'saved_list': {
      if (typeof row.list_id !== 'string' || !row.list_id.trim()) return null;
      return { kind, list_id: row.list_id.trim() };
    }
    case 'saved_list_filtered': {
      if (typeof row.list_id !== 'string' || !row.list_id.trim()) return null;
      return {
        kind,
        list_id: row.list_id.trim(),
        query: asObject(row.query) as ApiSavedListFilteredQuery,
      };
    }
    case 'campaign': {
      if (typeof row.campaign_id !== 'string' || !row.campaign_id.trim()) return null;
      return { kind, campaign_id: row.campaign_id.trim() };
    }
    case 'staged_upload': {
      if (typeof row.upload_id !== 'string' || !row.upload_id.trim()) return null;
      return { kind, upload_id: row.upload_id.trim() };
    }
    default:
      return null;
  }
}

/** Convert legacy createAsyncJob fields into a scope when `scope` is omitted. */
export function scopeFromLegacyJobFields(body: {
  global_lead_ids?: string[];
  list_id?: string | null;
  leads?: unknown[];
  upload_id?: string | null;
  source_campaign_id?: string | null;
}): ApiBulkScope | null {
  if (body.upload_id?.trim()) {
    return { kind: 'staged_upload', upload_id: body.upload_id.trim() };
  }
  if (body.list_id?.trim()) {
    return { kind: 'saved_list', list_id: body.list_id.trim() };
  }
  if (body.source_campaign_id?.trim()) {
    return { kind: 'campaign', campaign_id: body.source_campaign_id.trim() };
  }
  const ids = normalizeStringIds(body.global_lead_ids);
  if (ids.length) {
    return { kind: 'selection', global_lead_ids: ids };
  }
  return null;
}
