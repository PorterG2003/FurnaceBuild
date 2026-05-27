export const IMPORT_JOB_OPERATIONS = [
  'api_lead_import',
  'add_to_campaign',
  'remove_from_campaign',
  'remove_from_all_campaigns',
  'pause_enrollments',
  'resume_enrollments',
] as const;

export type ImportJobOperation = (typeof IMPORT_JOB_OPERATIONS)[number];

export type BatchWebhookSource = 'async' | 'sync';

export type BatchCompletionCounts = {
  created?: number;
  updated?: number;
  enrolled?: number;
  removed?: number;
  paused?: number;
  resumed?: number;
  skipped?: number;
  failed?: number;
};

export type BatchCompletionError = {
  global_lead_id?: string;
  index?: number;
  message: string;
};

export function isImportJobOperation(value: unknown): value is ImportJobOperation {
  return typeof value === 'string' && (IMPORT_JOB_OPERATIONS as readonly string[]).includes(value);
}

export function batchCompletionEventType(operation: ImportJobOperation): string {
  switch (operation) {
    case 'api_lead_import':
      return 'lead.bulk_import.completed';
    case 'add_to_campaign':
      return 'lead.added_to_campaign.completed';
    case 'remove_from_campaign':
      return 'lead.removed_from_campaign.completed';
    case 'remove_from_all_campaigns':
      return 'lead.removed_from_all_campaigns.completed';
    case 'pause_enrollments':
      return 'enrollment.pause_completed';
    case 'resume_enrollments':
      return 'enrollment.resume_completed';
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}

export function buildBatchCompletionPayload(params: {
  jobId: string | null;
  source: BatchWebhookSource;
  campaignId: string | null;
  operation: ImportJobOperation;
  counts: BatchCompletionCounts;
  errors?: BatchCompletionError[];
  globalLeadIds?: string[];
}): Record<string, unknown> {
  return {
    job_id: params.jobId,
    source: params.source,
    campaign_id: params.campaignId,
    operation: params.operation,
    counts: params.counts,
    errors: params.errors ?? [],
    ...(params.globalLeadIds?.length ? { global_lead_ids: params.globalLeadIds } : {}),
  };
}

export function batchCompletionDedupeKey(
  eventType: string,
  jobId: string | null,
  syncScopeKey?: string,
): string {
  if (jobId) return `${eventType}:${jobId}`;
  if (syncScopeKey) return `${eventType}:sync:${syncScopeKey}`;
  return `${eventType}:sync:${Date.now()}`;
}

export function stableGlobalLeadIdsKey(globalLeadIds: string[]): string {
  return [...globalLeadIds].sort().join(',');
}

export function chunkStatsToCounts(
  operation: ImportJobOperation,
  stats: BatchCompletionCounts,
): BatchCompletionCounts {
  switch (operation) {
    case 'api_lead_import':
      return {
        created: stats.created ?? 0,
        updated: stats.updated ?? 0,
        enrolled: stats.enrolled ?? 0,
        skipped: stats.skipped ?? 0,
        failed: stats.failed ?? 0,
      };
    case 'add_to_campaign':
      return {
        created: stats.created ?? 0,
        updated: stats.updated ?? 0,
        enrolled: stats.enrolled ?? 0,
        skipped: stats.skipped ?? 0,
        failed: stats.failed ?? 0,
      };
    case 'remove_from_campaign':
    case 'remove_from_all_campaigns':
      return {
        removed: stats.removed ?? 0,
        skipped: stats.skipped ?? 0,
        failed: stats.failed ?? 0,
      };
    case 'pause_enrollments':
      return {
        paused: stats.paused ?? 0,
        skipped: stats.skipped ?? 0,
        failed: stats.failed ?? 0,
      };
    case 'resume_enrollments':
      return {
        resumed: stats.resumed ?? 0,
        skipped: stats.skipped ?? 0,
        failed: stats.failed ?? 0,
      };
    default: {
      const _exhaustive: never = operation;
      return _exhaustive;
    }
  }
}
