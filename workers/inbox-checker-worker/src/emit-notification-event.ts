import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SendNotificationQueueMessage = (params: {
  queueUrl: string;
  eventId: string;
}) => Promise<void>;

const DEFAULT_SQS_MAX_ATTEMPTS = 3;

async function defaultSendNotificationQueueMessage(params: {
  queueUrl: string;
  eventId: string;
}): Promise<void> {
  const client = new SQSClient({ region: process.env.AWS_REGION || 'us-west-2' });
  await client.send(
    new SendMessageCommand({
      QueueUrl: params.queueUrl,
      MessageBody: JSON.stringify({ eventId: params.eventId }),
    })
  );
}

/**
 * Enqueue `{ eventId }` for processNotificationEvent. Retries transient SQS failures.
 * Does not throw — reply handling must continue even if enqueue fails.
 */
export async function enqueueNotificationEvent(
  eventId: string,
  options?: {
    sendMessage?: SendNotificationQueueMessage;
    maxAttempts?: number;
  }
): Promise<boolean> {
  const queueUrl = process.env.NOTIFICATION_QUEUE_URL?.trim();
  if (!queueUrl) {
    return false;
  }

  const sendMessage = options?.sendMessage ?? defaultSendNotificationQueueMessage;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_SQS_MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await sendMessage({ queueUrl, eventId });
      return true;
    } catch (e) {
      lastError = e;
      console.error(
        `[notifications] failed to enqueue SQS (attempt ${attempt}/${maxAttempts})`,
        e
      );
    }
  }

  console.error('[notifications] exhausted SQS enqueue retries for event', eventId, lastError);
  return false;
}

/**
 * Insert notification_events row and enqueue SQS message for async processing (Lambda).
 * On duplicate dedupe_key, looks up the existing event and re-enqueues (heals dropped SQS).
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
  },
  options?: {
    sendMessage?: SendNotificationQueueMessage;
    maxAttempts?: number;
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

  let eventId = eventRow?.id as string | undefined;

  if (error) {
    if (error.code === '23505') {
      const { data: existing, error: lookupError } = await supabase
        .from('notification_events')
        .select('id')
        .eq('account_id', params.accountId)
        .eq('dedupe_key', dedupeKey)
        .maybeSingle();

      if (lookupError || !existing?.id) {
        console.error(
          '[notifications] duplicate notification_events but lookup failed',
          lookupError ?? 'missing row'
        );
        return;
      }
      eventId = existing.id;
    } else {
      console.error('[notifications] failed to insert notification_events', error);
      return;
    }
  }

  if (!eventId) {
    return;
  }

  await enqueueNotificationEvent(eventId, options);
}
