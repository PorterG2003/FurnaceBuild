import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SupabaseClient } from '@supabase/supabase-js';

export type EnqueueWebhookEventResult =
  | { status: 'enqueued' }
  | { status: 'already_enqueued' }
  | { status: 'not_found' };

export async function enqueueWebhookEventById(
  supabase: SupabaseClient,
  eventId: string,
  options?: {
    queueUrl?: string;
    sqsClient?: SQSClient;
  },
): Promise<EnqueueWebhookEventResult> {
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('webhook_events')
    .update({ sqs_enqueued_at: now } as never)
    .eq('id', eventId)
    .is('sqs_enqueued_at', null)
    .select('id')
    .maybeSingle();

  if (claimError) {
    throw new Error(`Failed to claim webhook event for enqueue: ${claimError.message}`);
  }
  if (!claimed) {
    const { data: existing, error: existingError } = await supabase
      .from('webhook_events')
      .select('id')
      .eq('id', eventId)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Failed to load webhook event: ${existingError.message}`);
    }
    return existing ? { status: 'already_enqueued' } : { status: 'not_found' };
  }

  const queueUrl = options?.queueUrl?.trim() || process.env.CLIENT_API_WEBHOOK_QUEUE_URL?.trim() || process.env.WEBHOOK_QUEUE_URL?.trim();
  if (!queueUrl) {
    return { status: 'enqueued' };
  }

  try {
    const client = options?.sqsClient ?? new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ eventId }),
      }),
    );
    return { status: 'enqueued' };
  } catch (error) {
    await supabase
      .from('webhook_events')
      .update({ sqs_enqueued_at: null } as never)
      .eq('id', eventId);
    throw error;
  }
}

export async function reconcileStaleWebhookEnqueues(
  supabase: SupabaseClient,
  options?: {
    limit?: number;
    staleAfterMs?: number;
    enqueue?: (eventId: string) => Promise<EnqueueWebhookEventResult>;
  },
): Promise<string[]> {
  const limit = options?.limit ?? 100;
  const staleAfterMs = options?.staleAfterMs ?? 2 * 60 * 1000;
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();

  const { data: rows, error } = await supabase
    .from('webhook_events')
    .select('id')
    .is('sqs_enqueued_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to list stale webhook events: ${error.message}`);
  }

  const enqueued: string[] = [];
  const enqueueFn =
    options?.enqueue ??
    ((eventId: string) => enqueueWebhookEventById(supabase, eventId));

  for (const row of rows ?? []) {
    const result = await enqueueFn(row.id as string);
    if (result.status === 'enqueued') {
      enqueued.push(row.id as string);
    }
  }

  return enqueued;
}
