import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Insert notification_events row and enqueue SQS message for async processing (Lambda).
 * Safe to call on duplicate dedupe_key (unique violation → no-op).
 */
export async function emitEmailReceivedNotification(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    threadId: string;
    emailMessageId: string;
    mailboxId: string;
    fromEmail: string;
    fromName: string | null;
    subject: string;
    receivedAt: string;
  }
): Promise<void> {
  const dedupeKey = `email.received:${params.emailMessageId}`;
  const { data: eventRow, error } = await supabase
    .from('notification_events')
    .insert({
      account_id: params.accountId,
      event_type: 'email.received',
      resource_type: 'email_message',
      resource_id: params.emailMessageId,
      dedupe_key: dedupeKey,
      payload: {
        email_message_id: params.emailMessageId,
        thread_id: params.threadId,
        mailbox_id: params.mailboxId,
        from_email: params.fromEmail,
        from_name: params.fromName,
        subject: params.subject,
        received_at: params.receivedAt,
      },
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return;
    }
    console.error('[notifications] failed to insert notification_events', error);
    return;
  }

  const queueUrl = process.env.NOTIFICATION_QUEUE_URL?.trim();
  if (!queueUrl || !eventRow?.id) {
    return;
  }

  try {
    const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
    await client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ eventId: eventRow.id }),
      })
    );
  } catch (e) {
    console.error('[notifications] failed to enqueue SQS', e);
  }
}
