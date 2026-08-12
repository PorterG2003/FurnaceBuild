import crypto from 'node:crypto';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { createServiceRoleClient } from '../../../lib/client-api/service-role.js';
import type { Json } from '../../../lib/supabase/types/database.js';
import {
  batchCompletionEventType,
  isImportJobOperation,
  type ImportJobOperation,
} from '../../../lib/client-api/webhooks/batchCompletion.js';
import { insertBatchCompletionWebhookEvent } from '../../../lib/client-api/webhooks/emitBatchCompletion.js';

const CHUNK_SIZE = 500;
const TIMEOUT_GUARD_MS = 4 * 60 * 1000;
const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });

type ImportJobRow = {
  id: string;
  account_id: string;
  campaign_id: string | null;
  status: string;
  progress: number;
  cursor: number;
  input: Json;
  result: Json;
  errors: Json;
};

type ChunkStats = {
  created: number;
  updated: number;
  enrolled: number;
  skipped: number;
  incomplete: number;
  failed: number;
  paused: number;
  resumed: number;
  removed: number;
  added: number;
  errors: Array<Record<string, unknown>>;
};

function mergeStats(existing: ChunkStats, chunk: ChunkStats): ChunkStats {
  return {
    created: existing.created + chunk.created,
    updated: existing.updated + chunk.updated,
    enrolled: existing.enrolled + chunk.enrolled,
    skipped: existing.skipped + chunk.skipped,
    incomplete: existing.incomplete + chunk.incomplete,
    failed: existing.failed + chunk.failed,
    paused: existing.paused + chunk.paused,
    resumed: existing.resumed + chunk.resumed,
    removed: existing.removed + chunk.removed,
    added: existing.added + chunk.added,
    errors: [...existing.errors, ...chunk.errors].slice(0, 100),
  };
}

function emptyStats(): ChunkStats {
  return {
    created: 0,
    updated: 0,
    enrolled: 0,
    skipped: 0,
    incomplete: 0,
    failed: 0,
    paused: 0,
    resumed: 0,
    removed: 0,
    added: 0,
    errors: [],
  };
}

function parseStats(value: Json | null | undefined): ChunkStats {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    created: typeof row.created === 'number' ? row.created : 0,
    updated: typeof row.updated === 'number' ? row.updated : 0,
    enrolled: typeof row.enrolled === 'number' ? row.enrolled : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: typeof row.incomplete === 'number' ? row.incomplete : 0,
    failed: typeof row.failed === 'number' ? row.failed : 0,
    paused: typeof row.paused === 'number' ? row.paused : 0,
    resumed: typeof row.resumed === 'number' ? row.resumed : 0,
    removed: typeof row.removed === 'number' ? row.removed : 0,
    added: typeof row.added === 'number' ? row.added : 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

function requireCampaignId(job: ImportJobRow, operation: string): string {
  if (!job.campaign_id) {
    throw new Error(`${operation} job is missing campaign_id.`);
  }
  return job.campaign_id;
}

async function emitJobBatchCompletionWebhook(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  stats: ChunkStats,
  operation: ImportJobOperation,
): Promise<void> {
  const input = (job.input && typeof job.input === 'object' ? job.input : {}) as Record<string, unknown>;
  const globalLeadIds = Array.isArray(input.global_lead_ids)
    ? input.global_lead_ids.filter((id): id is string => typeof id === 'string')
    : [];
  await insertBatchCompletionWebhookEvent(supabase, {
    accountId: job.account_id,
    campaignId: job.campaign_id,
    operation,
    jobId: job.id,
    source: 'async',
    counts: stats,
    errors: stats.errors.map((entry) => ({
      global_lead_id: typeof entry.global_lead_id === 'string' ? entry.global_lead_id : undefined,
      index: typeof entry.index === 'number' ? entry.index : undefined,
      message: String(entry.message ?? 'Unknown error'),
    })),
    globalLeadIds: globalLeadIds.length > 0 ? globalLeadIds : undefined,
  });
}

async function requeueJob(jobId: string, delaySeconds = 0): Promise<void> {
  const queueUrl = process.env.CLIENT_API_IMPORT_QUEUE_URL?.trim();
  if (!queueUrl) return;
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ jobId }),
    ...(delaySeconds > 0 ? { DelaySeconds: Math.min(delaySeconds, 900) } : {}),
  }));
}

async function shouldCancelJob(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('api_import_jobs')
    .select('status, cancel_requested_at')
    .eq('id', jobId)
    .maybeSingle();
  if (error) {
    if (/cancel_requested_at/i.test(error.message)) {
      const { data: fallback, error: fallbackError } = await supabase
        .from('api_import_jobs')
        .select('status, result')
        .eq('id', jobId)
        .maybeSingle();
      if (fallbackError) throw new Error(`Failed to check cancel state: ${fallbackError.message}`);
      if (!fallback) return true;
      const result = fallback.result && typeof fallback.result === 'object'
        ? (fallback.result as Record<string, unknown>)
        : {};
      return fallback.status === 'cancelled' || result.cancelled === true;
    }
    throw new Error(`Failed to check cancel state: ${error.message}`);
  }
  if (!data) return true;
  return Boolean((data as { cancel_requested_at?: string | null }).cancel_requested_at)
    || data.status === 'cancelled';
}

async function markJobCancelled(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
  stats: ChunkStats,
  cursor: number,
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('api_import_jobs')
    .update({
      status: 'cancelled',
      cursor,
      result: stats as never,
      errors: stats.errors as never,
      completed_at: now,
      updated_at: now,
    } as never)
    .eq('id', jobId);
}

function parseExclusions(input: Record<string, unknown>): {
  listId: string | null;
  campaignId: string | null;
  globalLeadIds: Set<string>;
  emails: Set<string>;
} {
  const raw = input.exclusions && typeof input.exclusions === 'object'
    ? (input.exclusions as Record<string, unknown>)
    : {};
  return {
    listId: typeof raw.list_id === 'string' ? raw.list_id : null,
    campaignId: typeof raw.campaign_id === 'string' ? raw.campaign_id : null,
    globalLeadIds: new Set(
      Array.isArray(raw.global_lead_ids)
        ? raw.global_lead_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [],
    ),
    emails: new Set(
      Array.isArray(raw.emails)
        ? raw.emails
            .filter((email): email is string => typeof email === 'string' && email.trim().length > 0)
            .map((email) => email.trim().toLowerCase())
        : [],
    ),
  };
}

async function filterExcludedLeadIds(
  supabase: ReturnType<typeof createServiceRoleClient>,
  accountId: string,
  ids: string[],
  input: Record<string, unknown>,
): Promise<string[]> {
  const exclusions = parseExclusions(input);
  if (
    !exclusions.listId
    && !exclusions.campaignId
    && exclusions.globalLeadIds.size === 0
    && exclusions.emails.size === 0
  ) {
    return ids;
  }

  let next = ids.filter((id) => !exclusions.globalLeadIds.has(id));
  if (!next.length) return [];

  if (exclusions.listId) {
    const { data, error } = await supabase
      .from('lead_saved_list_members')
      .select('global_lead_id')
      .eq('account_id', accountId)
      .eq('list_id', exclusions.listId)
      .in('global_lead_id', next);
    if (error) throw new Error(`Failed to load exclusion list members: ${error.message}`);
    const excluded = new Set((data ?? []).map((row) => row.global_lead_id).filter(Boolean));
    next = next.filter((id) => !excluded.has(id));
  }

  if (exclusions.campaignId && next.length) {
    const { data, error } = await supabase
      .from('leads')
      .select('global_lead_id')
      .eq('account_id', accountId)
      .eq('campaign_id', exclusions.campaignId)
      .is('deleted_at', null)
      .in('global_lead_id', next);
    if (error) throw new Error(`Failed to load exclusion campaign people: ${error.message}`);
    const excluded = new Set((data ?? []).map((row) => row.global_lead_id).filter(Boolean) as string[]);
    next = next.filter((id) => !excluded.has(id));
  }

  if (exclusions.emails.size && next.length) {
    const { data, error } = await supabase
      .from('account_lead_people')
      .select('global_lead_id, email')
      .eq('account_id', accountId)
      .in('global_lead_id', next);
    if (error) throw new Error(`Failed to load emails for exclusions: ${error.message}`);
    const excluded = new Set(
      (data ?? [])
        .filter((row) => row.email && exclusions.emails.has(String(row.email).toLowerCase()))
        .map((row) => row.global_lead_id),
    );
    next = next.filter((id) => !excluded.has(id));
  }

  return next;
}

async function processAddToLeadListChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  accountId: string,
  listId: string,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  if (!globalLeadIds.length) {
    return {
      created: 0, updated: 0, enrolled: 0, skipped: 0, incomplete: 0, failed: 0,
      paused: 0, resumed: 0, removed: 0, added: 0, errors: [],
    };
  }
  const rows = globalLeadIds.map((globalLeadId) => ({
    account_id: accountId,
    list_id: listId,
    global_lead_id: globalLeadId,
  }));
  const { error } = await supabase
    .from('lead_saved_list_members')
    .upsert(rows as never, { onConflict: 'list_id,global_lead_id', ignoreDuplicates: true });
  if (error) throw new Error(`Failed to add lead list members: ${error.message}`);
  return {
    created: 0, updated: 0, enrolled: 0, skipped: 0, incomplete: 0, failed: 0,
    paused: 0, resumed: 0, removed: 0, added: globalLeadIds.length, errors: [],
  };
}

async function processRemoveFromLeadListChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  accountId: string,
  listId: string,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  if (!globalLeadIds.length) {
    return {
      created: 0, updated: 0, enrolled: 0, skipped: 0, incomplete: 0, failed: 0,
      paused: 0, resumed: 0, removed: 0, added: 0, errors: [],
    };
  }
  const { error, count } = await supabase
    .from('lead_saved_list_members')
    .delete({ count: 'exact' })
    .eq('account_id', accountId)
    .eq('list_id', listId)
    .in('global_lead_id', globalLeadIds);
  if (error) throw new Error(`Failed to remove lead list members: ${error.message}`);
  return {
    created: 0, updated: 0, enrolled: 0, skipped: 0, incomplete: 0, failed: 0,
    paused: 0, resumed: 0, removed: count ?? globalLeadIds.length, added: 0, errors: [],
  };
}

async function processPauseEnrollmentsChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  const campaignId = requireCampaignId(job, 'pause_enrollments');
  const { data, error } = await supabase.rpc('pause_enrollments_for_leads', {
    p_account_id: job.account_id,
    p_campaign_id: campaignId,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    created: 0,
    updated: 0,
    enrolled: 0,
    paused: typeof row.paused === 'number' ? row.paused : 0,
    resumed: 0,
    removed: 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: 0,
    failed: 0,
    added: 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

async function processResumeEnrollmentsChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  const campaignId = requireCampaignId(job, 'resume_enrollments');
  const { data, error } = await supabase.rpc('resume_enrollments_for_leads', {
    p_account_id: job.account_id,
    p_campaign_id: campaignId,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    created: 0,
    updated: 0,
    enrolled: 0,
    paused: 0,
    resumed: typeof row.resumed === 'number' ? row.resumed : 0,
    removed: 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: 0,
    failed: 0,
    added: 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

async function processRemoveFromCampaignChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  const campaignId = requireCampaignId(job, 'remove_from_campaign');
  const { data, error } = await supabase.rpc('remove_global_leads_from_campaign', {
    p_account_id: job.account_id,
    p_campaign_id: campaignId,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    created: 0,
    updated: 0,
    enrolled: 0,
    paused: 0,
    resumed: 0,
    removed: typeof row.removed === 'number' ? row.removed : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: 0,
    failed: 0,
    added: 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

async function processRemoveFromAllCampaignsChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  const { data, error } = await supabase.rpc('remove_global_leads_from_all_campaigns', {
    p_account_id: job.account_id,
    p_global_lead_ids: globalLeadIds,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    created: 0,
    updated: 0,
    enrolled: 0,
    paused: 0,
    resumed: 0,
    removed: typeof row.removed === 'number' ? row.removed : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: 0,
    failed: 0,
    added: 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

async function processEnrollmentActionListChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  operation: 'pause_enrollments' | 'resume_enrollments',
  savedListId: string,
  cursor: number,
): Promise<{ stats: ChunkStats; chunkSize: number }> {
  const { data: memberRows, error: membersError } = await supabase
    .from('lead_saved_list_members')
    .select('global_lead_id')
    .eq('account_id', job.account_id)
    .eq('list_id', savedListId)
    .order('global_lead_id', { ascending: true })
    .range(cursor, cursor + CHUNK_SIZE - 1);

  if (membersError) {
    throw new Error(`Failed to load saved list members: ${membersError.message}`);
  }

  const chunk = (memberRows ?? [])
    .map((row) => row.global_lead_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (chunk.length === 0) {
    return {
      stats: emptyStats(),
      chunkSize: 0,
    };
  }

  const stats =
    operation === 'pause_enrollments'
      ? await processPauseEnrollmentsChunk(supabase, job, chunk)
      : await processResumeEnrollmentsChunk(supabase, job, chunk);

  return { stats, chunkSize: chunk.length };
}

async function processRemoveActionListChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  operation: 'remove_from_campaign' | 'remove_from_all_campaigns',
  savedListId: string,
  cursor: number,
): Promise<{ stats: ChunkStats; chunkSize: number }> {
  const { data: memberRows, error: membersError } = await supabase
    .from('lead_saved_list_members')
    .select('global_lead_id')
    .eq('account_id', job.account_id)
    .eq('list_id', savedListId)
    .order('global_lead_id', { ascending: true })
    .range(cursor, cursor + CHUNK_SIZE - 1);

  if (membersError) {
    throw new Error(`Failed to load saved list members: ${membersError.message}`);
  }

  const chunk = (memberRows ?? [])
    .map((row) => row.global_lead_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (chunk.length === 0) {
    return {
      stats: emptyStats(),
      chunkSize: 0,
    };
  }

  const stats =
    operation === 'remove_from_campaign'
      ? await processRemoveFromCampaignChunk(supabase, job, chunk)
      : await processRemoveFromAllCampaignsChunk(supabase, job, chunk);

  return { stats, chunkSize: chunk.length };
}

async function processAddToCampaignChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  globalLeadIds: string[],
): Promise<ChunkStats> {
  const campaignId = requireCampaignId(job, 'add_to_campaign');
  const { data, error } = await supabase.rpc('add_global_leads_to_campaign', {
    p_account_id: job.account_id,
    p_campaign_id: campaignId,
    p_global_lead_ids: globalLeadIds,
    p_options: { emit_row_webhooks: false, source: 'Leads workbench' },
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    created: typeof row.created === 'number' ? row.created : 0,
    updated: typeof row.updated === 'number' ? row.updated : 0,
    enrolled: typeof row.enrolled === 'number' ? row.enrolled : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: typeof row.incomplete === 'number' ? row.incomplete : 0,
    failed: typeof row.failed === 'number' ? row.failed : 0,
    paused: 0,
    resumed: 0,
    removed: 0,
    added: 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

async function processApiImportChunk(
  supabase: ReturnType<typeof createServiceRoleClient>,
  job: ImportJobRow,
  leads: Record<string, unknown>[],
): Promise<ChunkStats> {
  const campaignId = requireCampaignId(job, 'api_lead_import');
  const { data, error } = await supabase.rpc('import_api_leads_to_campaign', {
    p_account_id: job.account_id,
    p_campaign_id: campaignId,
    p_leads: leads as Json,
    p_options: { emit_row_webhooks: false },
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    created: typeof row.created === 'number' ? row.created : 0,
    updated: typeof row.updated === 'number' ? row.updated : 0,
    enrolled: typeof row.enrolled === 'number' ? row.enrolled : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    incomplete: typeof row.incomplete === 'number' ? row.incomplete : 0,
    failed: typeof row.failed === 'number' ? row.failed : 0,
    paused: 0,
    resumed: 0,
    removed: 0,
    added: 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

export async function processImportJobById(
  jobId: string,
  options: { supabase?: ReturnType<typeof createServiceRoleClient> } = {},
): Promise<void> {
  const supabase = options.supabase ?? createServiceRoleClient();
  const startedAt = Date.now();
  const now = new Date().toISOString();

  const { data: job, error: jobError } = await supabase
    .from('api_import_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (jobError) throw new Error(`Failed to load import job: ${jobError.message}`);
  if (!job) return;
  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') return;

  const importJob = job as ImportJobRow & { cancel_requested_at?: string | null };
  const input = (importJob.input && typeof importJob.input === 'object' ? importJob.input : {}) as Record<string, unknown>;
  const operation = typeof input.operation === 'string' ? input.operation : 'api_lead_import';

  if (importJob.status === 'uploading') {
    return;
  }

  if ((importJob as { cancel_requested_at?: string | null }).cancel_requested_at) {
    await markJobCancelled(supabase, importJob.id, parseStats(importJob.result), importJob.cursor ?? 0);
    return;
  }

  if (importJob.status !== 'running') {
    const { data: claim, error: claimError } = await supabase.rpc('claim_api_import_job' as never, {
      p_job_id: importJob.id,
      p_max_running: 3,
    } as never);
    if (claimError) {
      // Fallback for environments without the migration yet.
      const { error: markRunningError } = await supabase
        .from('api_import_jobs')
        .update({ status: 'running', started_at: now, updated_at: now })
        .eq('id', importJob.id)
        .eq('status', 'queued');
      if (markRunningError) throw new Error(`Failed to mark import job running: ${markRunningError.message}`);
    } else {
      const claimRow = (claim ?? {}) as { claimed?: boolean; reason?: string };
      if (!claimRow.claimed) {
        if (claimRow.reason === 'cancelled') return;
        if (claimRow.reason === 'no_slot') {
          await requeueJob(importJob.id, 30);
          return;
        }
        return;
      }
    }
  }

  let stats = parseStats(importJob.result);
  let cursor = importJob.cursor ?? 0;
  let totalItems = 0;

  const checkpointOrCancel = async (): Promise<'continue' | 'timeout' | 'cancelled'> => {
    if (await shouldCancelJob(supabase, importJob.id)) {
      await markJobCancelled(supabase, importJob.id, stats, cursor);
      return 'cancelled';
    }
    if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
      const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
      await supabase
        .from('api_import_jobs')
        .update({
          status: 'queued',
          cursor,
          progress,
          result: stats as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', importJob.id);
      await requeueJob(importJob.id);
      return 'timeout';
    }
    return 'continue';
  };

  if (operation === 'add_to_campaign') {
    const savedListId = typeof input.saved_list_id === 'string' ? input.saved_list_id : null;
    const sourceCampaignId = typeof input.source_campaign_id === 'string' ? input.source_campaign_id : null;

    if (savedListId) {
      totalItems =
        typeof input.total_count === 'number'
          ? input.total_count
          : 0;

      if (totalItems <= 0) {
        const { count, error: countError } = await supabase
          .from('lead_saved_list_members')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', importJob.account_id)
          .eq('list_id', savedListId);
        if (countError) throw new Error(`Failed to count saved list members: ${countError.message}`);
        totalItems = count ?? 0;
      }

      while (cursor < totalItems) {
        const gate = await checkpointOrCancel();
        if (gate !== 'continue') return;

        const { data: memberRows, error: membersError } = await supabase
          .from('lead_saved_list_members')
          .select('global_lead_id')
          .eq('account_id', importJob.account_id)
          .eq('list_id', savedListId)
          .order('global_lead_id', { ascending: true })
          .range(cursor, cursor + CHUNK_SIZE - 1);

        if (membersError) {
          throw new Error(`Failed to load saved list members: ${membersError.message}`);
        }

        const rawChunk = (memberRows ?? [])
          .map((row) => row.global_lead_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const chunk = await filterExcludedLeadIds(supabase, importJob.account_id, rawChunk, input);

        if (rawChunk.length === 0) break;

        const chunkStats = chunk.length
          ? await processAddToCampaignChunk(supabase, importJob, chunk)
          : {
              created: 0, updated: 0, enrolled: 0, skipped: rawChunk.length, incomplete: 0, failed: 0,
              paused: 0, resumed: 0, removed: 0, added: 0, errors: [],
            };
        stats = mergeStats(stats, chunkStats);
        cursor += rawChunk.length;

        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            progress,
            cursor,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
      }
    } else if (sourceCampaignId) {
      totalItems = typeof input.total_count === 'number' ? input.total_count : 0;
      if (totalItems <= 0) {
        const { count, error: countError } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', importJob.account_id)
          .eq('campaign_id', sourceCampaignId)
          .is('deleted_at', null)
          .not('global_lead_id', 'is', null);
        if (countError) throw new Error(`Failed to count source campaign people: ${countError.message}`);
        totalItems = count ?? 0;
      }

      while (cursor < totalItems) {
        const gate = await checkpointOrCancel();
        if (gate !== 'continue') return;

        const { data: leadRows, error: leadsError } = await supabase
          .from('leads')
          .select('global_lead_id')
          .eq('account_id', importJob.account_id)
          .eq('campaign_id', sourceCampaignId)
          .is('deleted_at', null)
          .not('global_lead_id', 'is', null)
          .order('global_lead_id', { ascending: true })
          .range(cursor, cursor + CHUNK_SIZE - 1);
        if (leadsError) throw new Error(`Failed to load source campaign people: ${leadsError.message}`);

        const rawChunk = [...new Set(
          (leadRows ?? [])
            .map((row) => row.global_lead_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        )];
        const chunk = await filterExcludedLeadIds(supabase, importJob.account_id, rawChunk, input);
        if (rawChunk.length === 0) break;

        const chunkStats = chunk.length
          ? await processAddToCampaignChunk(supabase, importJob, chunk)
          : {
              created: 0, updated: 0, enrolled: 0, skipped: rawChunk.length, incomplete: 0, failed: 0,
              paused: 0, resumed: 0, removed: 0, added: 0, errors: [],
            };
        stats = mergeStats(stats, chunkStats);
        cursor += rawChunk.length;
        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            progress,
            cursor,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
      }
    } else {
    const globalLeadIds = Array.isArray(input.global_lead_ids)
      ? input.global_lead_ids.filter((id): id is string => typeof id === 'string')
      : [];
    totalItems = globalLeadIds.length;

    while (cursor < totalItems) {
      const gate = await checkpointOrCancel();
      if (gate !== 'continue') return;

      const rawChunk = globalLeadIds.slice(cursor, cursor + CHUNK_SIZE);
      const chunk = await filterExcludedLeadIds(supabase, importJob.account_id, rawChunk, input);
      const chunkStats = chunk.length
        ? await processAddToCampaignChunk(supabase, importJob, chunk)
        : {
            created: 0, updated: 0, enrolled: 0, skipped: rawChunk.length, incomplete: 0, failed: 0,
            paused: 0, resumed: 0, removed: 0, added: 0, errors: [],
          };
      stats = mergeStats(stats, chunkStats);
      cursor += rawChunk.length;

      const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
      await supabase
        .from('api_import_jobs')
        .update({
          progress,
          cursor,
          result: stats as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', importJob.id);
    }
    }
  } else if (operation === 'add_to_lead_list' || operation === 'remove_from_lead_list') {
    const targetListId = typeof input.target_list_id === 'string' ? input.target_list_id : null;
    if (!targetListId) throw new Error(`${operation} job is missing target_list_id.`);
    const savedListId = typeof input.saved_list_id === 'string' ? input.saved_list_id : null;
    const sourceCampaignId = typeof input.source_campaign_id === 'string' ? input.source_campaign_id : null;
    const processChunk = operation === 'add_to_lead_list'
      ? (ids: string[]) => processAddToLeadListChunk(supabase, importJob.account_id, targetListId, ids)
      : (ids: string[]) => processRemoveFromLeadListChunk(supabase, importJob.account_id, targetListId, ids);

    if (savedListId) {
      totalItems = typeof input.total_count === 'number' ? input.total_count : 0;
      if (totalItems <= 0) {
        const { count, error: countError } = await supabase
          .from('lead_saved_list_members')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', importJob.account_id)
          .eq('list_id', savedListId);
        if (countError) throw new Error(countError.message);
        totalItems = count ?? 0;
      }
      while (cursor < totalItems) {
        const gate = await checkpointOrCancel();
        if (gate !== 'continue') return;
        const { data: memberRows, error: membersError } = await supabase
          .from('lead_saved_list_members')
          .select('global_lead_id')
          .eq('account_id', importJob.account_id)
          .eq('list_id', savedListId)
          .order('global_lead_id', { ascending: true })
          .range(cursor, cursor + CHUNK_SIZE - 1);
        if (membersError) throw new Error(membersError.message);
        const rawChunk = (memberRows ?? []).map((row) => row.global_lead_id).filter(Boolean) as string[];
        const chunk = operation === 'add_to_lead_list'
          ? await filterExcludedLeadIds(supabase, importJob.account_id, rawChunk, input)
          : rawChunk;
        if (rawChunk.length === 0) break;
        stats = mergeStats(stats, await processChunk(chunk));
        cursor += rawChunk.length;
        await supabase.from('api_import_jobs').update({
          progress: Math.round((cursor / Math.max(totalItems, 1)) * 100),
          cursor,
          result: stats as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never).eq('id', importJob.id);
      }
    } else if (sourceCampaignId) {
      totalItems = typeof input.total_count === 'number' ? input.total_count : 0;
      if (totalItems <= 0) {
        const { count, error: countError } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', importJob.account_id)
          .eq('campaign_id', sourceCampaignId)
          .is('deleted_at', null)
          .not('global_lead_id', 'is', null);
        if (countError) throw new Error(countError.message);
        totalItems = count ?? 0;
      }
      while (cursor < totalItems) {
        const gate = await checkpointOrCancel();
        if (gate !== 'continue') return;
        const { data: leadRows, error: leadsError } = await supabase
          .from('leads')
          .select('global_lead_id')
          .eq('account_id', importJob.account_id)
          .eq('campaign_id', sourceCampaignId)
          .is('deleted_at', null)
          .not('global_lead_id', 'is', null)
          .order('global_lead_id', { ascending: true })
          .range(cursor, cursor + CHUNK_SIZE - 1);
        if (leadsError) throw new Error(leadsError.message);
        const rawChunk = [...new Set((leadRows ?? []).map((row) => row.global_lead_id).filter(Boolean) as string[])];
        const chunk = operation === 'add_to_lead_list'
          ? await filterExcludedLeadIds(supabase, importJob.account_id, rawChunk, input)
          : rawChunk;
        if (rawChunk.length === 0) break;
        stats = mergeStats(stats, await processChunk(chunk));
        cursor += rawChunk.length;
        await supabase.from('api_import_jobs').update({
          progress: Math.round((cursor / Math.max(totalItems, 1)) * 100),
          cursor,
          result: stats as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never).eq('id', importJob.id);
      }
    } else {
      const globalLeadIds = Array.isArray(input.global_lead_ids)
        ? input.global_lead_ids.filter((id): id is string => typeof id === 'string')
        : [];
      totalItems = globalLeadIds.length;
      while (cursor < totalItems) {
        const gate = await checkpointOrCancel();
        if (gate !== 'continue') return;
        const rawChunk = globalLeadIds.slice(cursor, cursor + CHUNK_SIZE);
        const chunk = operation === 'add_to_lead_list'
          ? await filterExcludedLeadIds(supabase, importJob.account_id, rawChunk, input)
          : rawChunk;
        stats = mergeStats(stats, await processChunk(chunk));
        cursor += rawChunk.length;
        await supabase.from('api_import_jobs').update({
          progress: Math.round((cursor / Math.max(totalItems, 1)) * 100),
          cursor,
          result: stats as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never).eq('id', importJob.id);
      }
    }
  } else if (operation === 'pause_enrollments' || operation === 'resume_enrollments') {
    const savedListId = typeof input.saved_list_id === 'string' ? input.saved_list_id : null;
    const processChunk =
      operation === 'pause_enrollments' ? processPauseEnrollmentsChunk : processResumeEnrollmentsChunk;

    if (savedListId) {
      totalItems = typeof input.total_count === 'number' ? input.total_count : 0;
      if (totalItems <= 0) {
        const { count, error: countError } = await supabase
          .from('lead_saved_list_members')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', importJob.account_id)
          .eq('list_id', savedListId);
        if (countError) throw new Error(`Failed to count saved list members: ${countError.message}`);
        totalItems = count ?? 0;
      }

      while (cursor < totalItems) {
        if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
          const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
          await supabase
            .from('api_import_jobs')
            .update({
              status: 'queued',
              cursor,
              progress,
              result: stats as never,
              errors: stats.errors as never,
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', importJob.id);
          await requeueJob(importJob.id);
          return;
        }

        const { stats: chunkStats, chunkSize } = await processEnrollmentActionListChunk(
          supabase,
          importJob,
          operation,
          savedListId,
          cursor,
        );
        if (chunkSize === 0) break;
        stats = mergeStats(stats, chunkStats);
        cursor += chunkSize;

        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            progress,
            cursor,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
      }
    } else {
      const globalLeadIds = Array.isArray(input.global_lead_ids)
        ? input.global_lead_ids.filter((id): id is string => typeof id === 'string')
        : [];
      totalItems = globalLeadIds.length;

      while (cursor < totalItems) {
        if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
          const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
          await supabase
            .from('api_import_jobs')
            .update({
              status: 'queued',
              cursor,
              progress,
              result: stats as never,
              errors: stats.errors as never,
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', importJob.id);
          await requeueJob(importJob.id);
          return;
        }

        const chunk = globalLeadIds.slice(cursor, cursor + CHUNK_SIZE);
        const chunkStats = await processChunk(supabase, importJob, chunk);
        stats = mergeStats(stats, chunkStats);
        cursor += chunk.length;

        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            progress,
            cursor,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
      }
    }
  } else if (operation === 'remove_from_campaign' || operation === 'remove_from_all_campaigns') {
    const savedListId = typeof input.saved_list_id === 'string' ? input.saved_list_id : null;
    const processChunk =
      operation === 'remove_from_campaign'
        ? processRemoveFromCampaignChunk
        : processRemoveFromAllCampaignsChunk;

    if (savedListId) {
      totalItems = typeof input.total_count === 'number' ? input.total_count : 0;
      if (totalItems <= 0) {
        const { count, error: countError } = await supabase
          .from('lead_saved_list_members')
          .select('*', { count: 'exact', head: true })
          .eq('account_id', importJob.account_id)
          .eq('list_id', savedListId);
        if (countError) throw new Error(`Failed to count saved list members: ${countError.message}`);
        totalItems = count ?? 0;
      }

      while (cursor < totalItems) {
        if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
          const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
          await supabase
            .from('api_import_jobs')
            .update({
              status: 'queued',
              cursor,
              progress,
              result: stats as never,
              errors: stats.errors as never,
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', importJob.id);
          await requeueJob(importJob.id);
          return;
        }

        const { stats: chunkStats, chunkSize } = await processRemoveActionListChunk(
          supabase,
          importJob,
          operation,
          savedListId,
          cursor,
        );
        if (chunkSize === 0) break;
        stats = mergeStats(stats, chunkStats);
        cursor += chunkSize;

        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            progress,
            cursor,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
      }
    } else {
      const globalLeadIds = Array.isArray(input.global_lead_ids)
        ? input.global_lead_ids.filter((id): id is string => typeof id === 'string')
        : [];
      totalItems = globalLeadIds.length;

      while (cursor < totalItems) {
        if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
          const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
          await supabase
            .from('api_import_jobs')
            .update({
              status: 'queued',
              cursor,
              progress,
              result: stats as never,
              errors: stats.errors as never,
              updated_at: new Date().toISOString(),
            } as never)
            .eq('id', importJob.id);
          await requeueJob(importJob.id);
          return;
        }

        const chunk = globalLeadIds.slice(cursor, cursor + CHUNK_SIZE);
        const chunkStats = await processChunk(supabase, importJob, chunk);
        stats = mergeStats(stats, chunkStats);
        cursor += chunk.length;

        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            progress,
            cursor,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
      }
    }
  } else if (operation === 'csv_lead_import_staged') {
    totalItems = typeof input.total_count === 'number' ? input.total_count : 0;
    if (totalItems <= 0) {
      const { count, error: countError } = await supabase
        .from('csv_import_staging')
        .select('*', { count: 'exact', head: true })
        .eq('job_id', importJob.id);
      if (countError) {
        throw new Error(`Failed to count staged CSV rows: ${countError.message}`);
      }
      totalItems = count ?? 0;
    }

    while (cursor < totalItems) {
      if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            status: 'queued',
            cursor,
            progress,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
        await requeueJob(importJob.id);
        return;
      }

      const { data: stagingRows, error: stagingError } = await supabase
        .from('csv_import_staging')
        .select('payload')
        .eq('job_id', importJob.id)
        .order('row_index', { ascending: true })
        .range(cursor, cursor + CHUNK_SIZE - 1);

      if (stagingError) {
        throw new Error(`Failed to load staged CSV rows: ${stagingError.message}`);
      }

      const chunk: Record<string, unknown>[] = [];
      for (const row of stagingRows ?? []) {
        const payload = row.payload;
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          chunk.push(payload as Record<string, unknown>);
        }
      }

      if (chunk.length === 0) break;

      const chunkStats = await processApiImportChunk(supabase, importJob, chunk);
      stats = mergeStats(stats, chunkStats);
      cursor += chunk.length;

      const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
      await supabase
        .from('api_import_jobs')
        .update({
          progress,
          cursor,
          result: {
            ...stats,
            imported: stats.created + stats.updated,
          } as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', importJob.id);
    }

    await supabase.rpc('delete_csv_import_staging_for_job', { p_job_id: importJob.id });
  } else if (operation === 'api_lead_import' || Array.isArray(input.leads)) {
    const rows = Array.isArray(input.leads) ? (input.leads as Record<string, unknown>[]) : [];
    totalItems = rows.length;

    while (cursor < totalItems) {
      if (Date.now() - startedAt > TIMEOUT_GUARD_MS) {
        const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
        await supabase
          .from('api_import_jobs')
          .update({
            status: 'queued',
            cursor,
            progress,
            result: stats as never,
            errors: stats.errors as never,
            updated_at: new Date().toISOString(),
          } as never)
          .eq('id', importJob.id);
        await requeueJob(importJob.id);
        return;
      }

      const chunk = rows.slice(cursor, cursor + CHUNK_SIZE);
      const chunkStats = await processApiImportChunk(supabase, importJob, chunk);
      stats = mergeStats(stats, chunkStats);
      cursor += chunk.length;

      const progress = Math.round((cursor / Math.max(totalItems, 1)) * 100);
      await supabase
        .from('api_import_jobs')
        .update({
          progress,
          cursor,
          result: {
            ...stats,
            imported: stats.created + stats.updated,
          } as never,
          errors: stats.errors as never,
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', importJob.id);
    }
  }

  const completedAt = new Date().toISOString();
  const affectedEnrollmentCount = stats.paused + stats.resumed;
  const affectedRemoveCount = stats.removed;
  const isEnrollmentAction =
    operation === 'pause_enrollments' || operation === 'resume_enrollments';
  const isRemoveAction =
    operation === 'remove_from_campaign' || operation === 'remove_from_all_campaigns';
  const isListMembershipAction =
    operation === 'add_to_lead_list' || operation === 'remove_from_lead_list';
  const finalStatus = isEnrollmentAction
    ? stats.failed > 0 && affectedEnrollmentCount === 0
      ? 'failed'
      : 'completed'
    : isRemoveAction || operation === 'remove_from_lead_list'
      ? stats.failed > 0 && affectedRemoveCount === 0
        ? 'failed'
        : 'completed'
      : isListMembershipAction
        ? stats.failed > 0 && stats.added === 0
          ? 'failed'
          : 'completed'
      : stats.failed > 0 && stats.created + stats.updated === 0
        ? 'failed'
        : 'completed';
  await supabase
    .from('api_import_jobs')
    .update({
      status: finalStatus,
      progress: 100,
      cursor: totalItems,
      result: {
        ...stats,
        imported: stats.created + stats.updated,
      } as never,
      errors: stats.errors as never,
      completed_at: completedAt,
      updated_at: completedAt,
    } as never)
    .eq('id', importJob.id);

  if (finalStatus === 'completed' && isImportJobOperation(operation)) {
    try {
      await emitJobBatchCompletionWebhook(supabase, importJob, stats, operation);
    } catch (error) {
      console.error('[clientApiBulkImport] bulk webhook failed', error);
    }
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const parsed = JSON.parse(record.body ?? '{}') as { jobId?: string };
      if (!parsed.jobId) continue;
      await processImportJobById(parsed.jobId);
    } catch (error) {
      console.error('[clientApiBulkImport] failed record', error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
