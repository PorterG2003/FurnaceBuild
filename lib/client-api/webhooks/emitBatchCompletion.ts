import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/types/supabase-client-database.js';
import {
  batchCompletionDedupeKey,
  batchCompletionEventType,
  buildBatchCompletionPayload,
  chunkStatsToCounts,
  type BatchCompletionCounts,
  type BatchCompletionError,
  type BatchWebhookSource,
  type ImportJobOperation,
} from './batchCompletion.js';

type Supabase = SupabaseClient<Database>;

export async function insertBatchCompletionWebhookEvent(
  supabase: Supabase,
  params: {
    accountId: string;
    campaignId: string | null;
    operation: ImportJobOperation;
    jobId: string | null;
    source: BatchWebhookSource;
    counts: BatchCompletionCounts;
    errors?: BatchCompletionError[];
    globalLeadIds?: string[];
    syncScopeKey?: string;
  },
): Promise<string> {
  const eventType = batchCompletionEventType(params.operation);
  const payload = buildBatchCompletionPayload({
    jobId: params.jobId,
    source: params.source,
    campaignId: params.campaignId,
    operation: params.operation,
    counts: chunkStatsToCounts(params.operation, params.counts),
    errors: params.errors,
    globalLeadIds: params.globalLeadIds,
  });
  const dedupeKey = batchCompletionDedupeKey(eventType, params.jobId, params.syncScopeKey);
  const { data, error } = await supabase
    .from('webhook_events')
    .insert({
      account_id: params.accountId,
      campaign_id: params.campaignId,
      event_type: eventType,
      payload: payload as never,
      dedupe_key: dedupeKey,
    } as never)
    .select('id')
    .single();
  if (error) throw new Error(`Failed to persist batch webhook event: ${error.message}`);
  return data.id as string;
}
