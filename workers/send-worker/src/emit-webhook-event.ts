import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function emitWebhookEvent(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    campaignId?: string | null;
    eventType: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  }
): Promise<void> {
  const { data: eventRow, error } = await supabase
    .from('webhook_events')
    .insert({
      account_id: params.accountId,
      campaign_id: params.campaignId ?? null,
      event_type: params.eventType,
      payload: params.payload,
      dedupe_key: params.dedupeKey,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') return;
    console.error('[webhooks] failed to insert webhook_events', error);
    return;
  }
  const queueUrl = process.env.WEBHOOK_QUEUE_URL?.trim();
  if (!queueUrl || !eventRow?.id) return;
  try {
    const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ eventId: eventRow.id }),
      })
    );
  } catch (error) {
    console.error('[webhooks] failed to enqueue webhook event', error);
  }
}
