import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { previewNewMessagePlainText } from './emailPreview.js';

type EmailReceivedPayload = {
  email_message_id: string;
  thread_id: string;
  mailbox_id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  received_at: string;
};

/** Event types this Lambda knows how to process; extend when adding producers. */
const HANDLED_NOTIFICATION_EVENT_TYPES = new Set<string>(['email.received']);
type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
type SendWebPushFn = (...args: Parameters<typeof webpush.sendNotification>) => Promise<unknown>;

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) or SUPABASE_SECRET_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function configureWebPush() {
  const publicKey = (
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY ??
    process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ??
    ''
  ).trim();
  const privateKey = (process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '').trim();
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails('mailto:support@getfurnace.io', publicKey, privateKey);
    return true;
  } catch (error) {
    console.error('[processNotificationEvent] invalid web push configuration', error);
    return false;
  }
}

const MAX_NOTIFICATION_BODY_CHARS = 140;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export async function preferenceEnabled(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
  eventType: string,
  channel: 'in_app' | 'web_push',
  defaultEnabled: boolean,
  defaultFrequency: 'instant' | 'muted'
): Promise<{ enabled: boolean; frequency: string }> {
  const { data } = await supabase
    .from('notification_preferences')
    .select('enabled, frequency')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .eq('event_type', eventType)
    .eq('channel', channel)
    .maybeSingle();

  const row = data as { enabled: boolean; frequency: string | null } | null;
  if (!row) {
    return { enabled: defaultEnabled, frequency: defaultFrequency };
  }
  return { enabled: row.enabled, frequency: row.frequency ?? 'instant' };
}

export function buildInboxNotificationActionUrl(threadId: string): string {
  return `/inbox/${encodeURIComponent(threadId)}`;
}

export async function listActivePushSubscriptionsForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<PushSubscriptionRow[]> {
  const { data } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
    .is('revoked_at', null);

  return (data ?? []) as PushSubscriptionRow[];
}

export async function listAccountMemberUserIds(
  supabase: SupabaseClient,
  accountId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('account_users')
    .select('user_id')
    .eq('account_id', accountId);

  if (error) {
    console.error('[processNotificationEvent] account_users lookup failed', accountId, error);
    return [];
  }

  const ids = (data ?? [])
    .map((row) => (row as { user_id: string | null }).user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)];
}

export async function sendWebPushDeliveries(params: {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  notificationId: string;
  eventId: string;
  title: string;
  bodyText: string;
  actionUrl: string;
  webOrigin: string;
  sendNotification: SendWebPushFn;
}): Promise<void> {
  const {
    supabase,
    userId,
    accountId,
    notificationId,
    eventId,
    title,
    bodyText,
    actionUrl,
    webOrigin,
    sendNotification,
  } = params;

  const subs = await listActivePushSubscriptionsForUser(supabase, userId);
  const openUrl = `${webOrigin}${actionUrl}`;
  const pushPayload = JSON.stringify({
    title,
    body: bodyText,
    url: openUrl,
    tag: `furnace-${eventId}`,
  });

  for (const sub of subs) {
    const { data: delivery, error: delInsErr } = await supabase
      .from('notification_deliveries')
      .insert({
        notification_id: notificationId,
        account_id: accountId,
        channel: 'web_push',
        provider: 'web_push_vapid',
        status: 'sending',
        attempt_count: 1,
        last_attempt_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (delInsErr) {
      console.error('[processNotificationEvent] delivery row', delInsErr);
      continue;
    }

    try {
      await sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        pushPayload,
        { TTL: 3600 }
      );
      await supabase
        .from('notification_deliveries')
        .update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
        })
        .eq('id', delivery.id);
    } catch (pushErr: unknown) {
      const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
      const statusCode = (pushErr as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from('push_subscriptions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', sub.id);
      }
      await supabase
        .from('notification_deliveries')
        .update({
          status: 'failed',
          error: msg.slice(0, 2000),
        })
        .eq('id', delivery.id);
    }
  }
}

export async function processNotificationRecord(params: {
  record: Pick<SQSEvent['Records'][number], 'body' | 'messageId'>;
  supabase: SupabaseClient;
  webPushReady: boolean;
  webOrigin: string;
  sendNotification: SendWebPushFn;
}): Promise<{ itemIdentifier?: string }> {
  const { record, supabase, webPushReady, webOrigin, sendNotification } = params;

  try {
    let eventId: string;
    try {
      const body = JSON.parse(record.body ?? '{}');
      eventId = body.eventId;
    } catch {
      return { itemIdentifier: record.messageId };
    }
    if (!eventId) {
      return { itemIdentifier: record.messageId };
    }

    const { data: evt, error: evtError } = await supabase
      .from('notification_events')
      .select('id, account_id, event_type, payload')
      .eq('id', eventId)
      .maybeSingle();

    // Missing row is retryable (eventual consistency / delayed insert). Do not ack.
    if (evtError || !evt) {
      console.error('[processNotificationEvent] notification_events row missing; retrying', eventId, evtError);
      return { itemIdentifier: record.messageId };
    }
    if (!HANDLED_NOTIFICATION_EVENT_TYPES.has(String(evt.event_type))) {
      console.log('[processNotificationEvent] unsupported event_type, skipping', evt.event_type);
      return {};
    }

    const payload = evt.payload as EmailReceivedPayload;
    const accountId = evt.account_id as string;

    // Validate mailbox belongs to the account; recipients are account members, not mailbox.user_id.
    const { data: mailbox, error: mbError } = await supabase
      .from('mailboxes')
      .select('id')
      .eq('id', payload.mailbox_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (mbError || !mailbox) {
      console.error('[processNotificationEvent] mailbox not found', payload.mailbox_id, mbError);
      return {};
    }

    const memberUserIds = await listAccountMemberUserIds(supabase, accountId);
    if (memberUserIds.length === 0) {
      console.error('[processNotificationEvent] no account members for', accountId);
      return {};
    }

    const { data: emailMessage } = await supabase
      .from('email_messages')
      .select('body_text, body_html')
      .eq('id', payload.email_message_id)
      .maybeSingle();

    const fromDisplay = payload.from_name?.trim()
      ? payload.from_name.trim()
      : payload.from_email;
    const title = fromDisplay;
    const previewRaw = previewNewMessagePlainText(
      emailMessage?.body_text ?? null,
      emailMessage?.body_html ?? null
    );
    const bodyText = previewRaw
      ? truncateText(previewRaw, MAX_NOTIFICATION_BODY_CHARS)
      : '';
    const actionUrl = buildInboxNotificationActionUrl(payload.thread_id);

    let hardFailure = false;

    for (const userId of memberUserIds) {
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existing) {
        continue;
      }

      const inAppPref = await preferenceEnabled(
        supabase,
        userId,
        accountId,
        'email.received',
        'in_app',
        true,
        'instant'
      );
      const pushPref = await preferenceEnabled(
        supabase,
        userId,
        accountId,
        'email.received',
        'web_push',
        false,
        'instant'
      );
      const wantInApp = inAppPref.enabled && inAppPref.frequency !== 'muted';
      const wantPush = pushPref.enabled && pushPref.frequency !== 'muted';
      if (!wantInApp && !wantPush) {
        continue;
      }

      const { data: notif, error: insErr } = await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          account_id: accountId,
          event_id: eventId,
          title,
          body: bodyText,
          status: 'unread',
          action_url: actionUrl,
        })
        .select('id')
        .single();

      if (insErr) {
        if (insErr.code === '23505') {
          continue;
        }
        console.error('[processNotificationEvent] insert notification', userId, insErr);
        hardFailure = true;
        continue;
      }

      if (webPushReady && wantPush && notif?.id) {
        await sendWebPushDeliveries({
          supabase,
          userId,
          accountId,
          notificationId: notif.id,
          eventId,
          title,
          bodyText,
          actionUrl,
          webOrigin,
          sendNotification,
        });
      }
    }

    if (hardFailure) {
      return { itemIdentifier: record.messageId };
    }
  } catch (e) {
    console.error('[processNotificationEvent] record failed', e);
    return { itemIdentifier: record.messageId };
  }

  return {};
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const supabase = getSupabase();
  const webPushReady = configureWebPush();
  const webOrigin = (process.env.WEB_APP_ORIGIN ?? 'https://build.getfurnace.io').replace(/\/$/, '');
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const result = await processNotificationRecord({
      record,
      supabase,
      webPushReady,
      webOrigin,
      sendNotification: webpush.sendNotification.bind(webpush),
    });
    if (result.itemIdentifier) {
      batchItemFailures.push({ itemIdentifier: result.itemIdentifier });
    }
  }

  return { batchItemFailures };
}
