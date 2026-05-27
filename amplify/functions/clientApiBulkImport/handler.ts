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
  failed: number;
  paused: number;
  resumed: number;
  removed: number;
  errors: Array<Record<string, unknown>>;
};

function mergeStats(existing: ChunkStats, chunk: ChunkStats): ChunkStats {
  return {
    created: existing.created + chunk.created,
    updated: existing.updated + chunk.updated,
    enrolled: existing.enrolled + chunk.enrolled,
    skipped: existing.skipped + chunk.skipped,
    failed: existing.failed + chunk.failed,
    paused: existing.paused + chunk.paused,
    resumed: existing.resumed + chunk.resumed,
    removed: existing.removed + chunk.removed,
    errors: [...existing.errors, ...chunk.errors].slice(0, 100),
  };
}

function parseStats(value: Json | null | undefined): ChunkStats {
  const row = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    created: typeof row.created === 'number' ? row.created : 0,
    updated: typeof row.updated === 'number' ? row.updated : 0,
    enrolled: typeof row.enrolled === 'number' ? row.enrolled : 0,
    skipped: typeof row.skipped === 'number' ? row.skipped : 0,
    failed: typeof row.failed === 'number' ? row.failed : 0,
    paused: typeof row.paused === 'number' ? row.paused : 0,
    resumed: typeof row.resumed === 'number' ? row.resumed : 0,
    removed: typeof row.removed === 'number' ? row.removed : 0,
    errors: Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [],
  };
}

function requireCampaignId(job: ImportJobRow, operation: string): string {
  if (!job.campaign_id) {
    throw new Error(`${operation} job is missing campaign_id.`);
  }
  return job.campaign_id;
}

async function enqueueWebhookEvent(eventId: string): Promise<void> {
  const queueUrl = process.env.WEBHOOK_QUEUE_URL?.trim();
  if (!queueUrl) return;
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ eventId }),
  }));
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
  const eventId = await insertBatchCompletionWebhookEvent(supabase, {
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
  await enqueueWebhookEvent(eventId);
}

async function requeueJob(jobId: string): Promise<void> {
  const queueUrl = process.env.CLIENT_API_IMPORT_QUEUE_URL?.trim();
  if (!queueUrl) return;
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ jobId }),
  }));
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
    failed: 0,
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
    failed: 0,
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
    failed: 0,
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
    failed: 0,
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
      stats: {
        created: 0,
        updated: 0,
        enrolled: 0,
        paused: 0,
        resumed: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      },
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
      stats: {
        created: 0,
        updated: 0,
        enrolled: 0,
        paused: 0,
        resumed: 0,
        removed: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      },
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
    failed: typeof row.failed === 'number' ? row.failed : 0,
    paused: 0,
    resumed: 0,
    removed: 0,
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
    failed: typeof row.failed === 'number' ? row.failed : 0,
    paused: 0,
    resumed: 0,
    removed: 0,
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
  if (job.status === 'completed') return;

  const importJob = job as ImportJobRow;
  const input = (importJob.input && typeof importJob.input === 'object' ? importJob.input : {}) as Record<string, unknown>;
  const operation = typeof input.operation === 'string' ? input.operation : 'api_lead_import';

  if (importJob.status !== 'running') {
    const { error: markRunningError } = await supabase
      .from('api_import_jobs')
      .update({ status: 'running', started_at: now, updated_at: now })
      .eq('id', importJob.id);
    if (markRunningError) throw new Error(`Failed to mark import job running: ${markRunningError.message}`);
  }

  let stats = parseStats(importJob.result);
  let cursor = importJob.cursor ?? 0;
  let totalItems = 0;

  if (operation === 'add_to_campaign') {
    const savedListId = typeof input.saved_list_id === 'string' ? input.saved_list_id : null;

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

        const chunk = (memberRows ?? [])
          .map((row) => row.global_lead_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        if (chunk.length === 0) break;

        const chunkStats = await processAddToCampaignChunk(supabase, importJob, chunk);
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
      const chunkStats = await processAddToCampaignChunk(supabase, importJob, chunk);
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
  const finalStatus = isEnrollmentAction
    ? stats.failed > 0 && affectedEnrollmentCount === 0
      ? 'failed'
      : 'completed'
    : isRemoveAction
      ? stats.failed > 0 && affectedRemoveCount === 0
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
