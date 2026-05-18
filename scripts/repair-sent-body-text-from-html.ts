/**
 * Repair sent event/email_message plain-text bodies that were stored with
 * unrendered spintax while their HTML bodies were already fully rendered.
 *
 * Usage:
 *   npx tsx scripts/repair-sent-body-text-from-html.ts
 *   APPLY=true npx tsx scripts/repair-sent-body-text-from-html.ts
 *   SELF_RECOVERY_TARGET_ENV=prod APPLY=true npx tsx scripts/repair-sent-body-text-from-html.ts
 *
 * Notes:
 * - Only targets rows where plain text still looks like a spintax template
 *   (`{...|...}`-style content) while the HTML body appears rendered.
 * - Derives repaired text from the rendered HTML body using the same
 *   whitespace-collapsing stripHtml logic used elsewhere in the app.
 */

import { stripHtml } from '../lib/email/parse-body.js';
import {
  fetchSecretFromParameterStore,
  loadSelfRecoveryEnv,
  resolveSecretParamPathForTarget,
  resolveSelfRecoveryTargetEnv,
  resolveSupabaseUrlForTarget,
} from './self-recovery-env.js';

loadSelfRecoveryEnv();

type SentEventRow = {
  id: string;
  message_job_id: string | null;
  event_data: {
    sent_body_text?: string | null;
    sent_body_html?: string | null;
  } | null;
};

type SentMessageRow = {
  id: string;
  message_job_id: string | null;
  body_text: string | null;
  body_html: string | null;
};

function looksLikeUnrenderedSpintax(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.includes('{') && text.includes('|');
}

function htmlLooksRendered(html: string | null | undefined): boolean {
  if (!html) return false;
  return !html.includes('{');
}

function shouldRepairTextFromHtml(text: string | null | undefined, html: string | null | undefined): boolean {
  return looksLikeUnrenderedSpintax(text) && htmlLooksRendered(html);
}

async function main() {
  const targetEnv = resolveSelfRecoveryTargetEnv();
  const { url, source: urlSource } = resolveSupabaseUrlForTarget(targetEnv);
  const apply = process.env.APPLY === 'true';
  const awsRegion =
    process.env.AWS_REGION?.trim() ||
    process.env.CDK_DEFAULT_REGION?.trim() ||
    'us-west-2';

  let key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    null;

  const secretParamPath = resolveSecretParamPathForTarget(targetEnv);
  if (secretParamPath) {
    try {
      key = await fetchSecretFromParameterStore(secretParamPath, awsRegion);
      process.env.SUPABASE_SECRET_KEY = key;
    } catch (error) {
      if (!key) throw error;
      console.warn(
        `[repair-sent-body-text-from-html] Failed to fetch ${secretParamPath}; falling back to existing secret env.`
      );
    }
  }

  if (!url || !key) {
    console.error(
      'Missing Supabase configuration. Provide a resolvable URL plus either SSM worker secret prefixes / SUPABASE_SECRET_KEY_PARAM_PATH, or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY.'
    );
    process.exit(1);
  }

  console.log(`Target env: ${targetEnv}`);
  console.log(`Resolved SUPABASE_URL from ${urlSource}.`);
  if (secretParamPath) {
    console.log(`Resolved SUPABASE secret from Parameter Store path ${secretParamPath}.`);
  } else {
    console.log('Resolved SUPABASE secret from environment variable.');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, key);

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, message_job_id, event_data')
    .eq('event_type', 'sent')
    .order('created_at', { ascending: false })
    .limit(20000);

  if (eventsError) {
    console.error('Failed to load sent events:', eventsError.message);
    process.exit(1);
  }

  const eventCandidates = ((events ?? []) as SentEventRow[])
    .map((row) => {
      const html = row.event_data?.sent_body_html ?? null;
      const text = row.event_data?.sent_body_text ?? null;
      return {
        id: row.id,
        messageJobId: row.message_job_id,
        currentText: text,
        html,
        repairedText: stripHtml(html),
      };
    })
    .filter((row) => shouldRepairTextFromHtml(row.currentText, row.html))
    .filter((row) => row.repairedText !== row.currentText);

  const { data: messages, error: messagesError } = await supabase
    .from('email_messages')
    .select('id, message_job_id, body_text, body_html')
    .eq('direction', 'sent')
    .order('received_at', { ascending: false })
    .limit(5000);

  if (messagesError) {
    console.error('Failed to load sent email_messages:', messagesError.message);
    process.exit(1);
  }

  const messageCandidates = ((messages ?? []) as SentMessageRow[])
    .map((row) => ({
      id: row.id,
      messageJobId: row.message_job_id,
      currentText: row.body_text,
      html: row.body_html,
      repairedText: stripHtml(row.body_html),
    }))
    .filter((row) => shouldRepairTextFromHtml(row.currentText, row.html))
    .filter((row) => row.repairedText !== row.currentText);

  console.log(`Sent event candidates: ${eventCandidates.length}`);
  console.log(`Sent email_message candidates: ${messageCandidates.length}`);

  if (eventCandidates.length > 0) {
    console.log('Sample sent event repairs:');
    for (const row of eventCandidates.slice(0, 5)) {
      console.log(
        `  ${row.messageJobId ?? row.id}: ${JSON.stringify(row.currentText?.slice(0, 80) ?? '')} -> ${JSON.stringify(row.repairedText.slice(0, 80))}`
      );
    }
  }

  if (messageCandidates.length > 0) {
    console.log('Sample sent email_message repairs:');
    for (const row of messageCandidates.slice(0, 5)) {
      console.log(
        `  ${row.messageJobId ?? row.id}: ${JSON.stringify(row.currentText?.slice(0, 80) ?? '')} -> ${JSON.stringify(row.repairedText.slice(0, 80))}`
      );
    }
  }

  if (!apply) {
    console.log('Dry run only. Re-run with APPLY=true to persist changes.');
    return;
  }

  for (const row of eventCandidates) {
    const { error } = await supabase
      .from('events')
      .update({
        event_data: {
          ...(events as SentEventRow[]).find((event) => event.id === row.id)?.event_data,
          sent_body_text: row.repairedText,
        },
      } as any)
      .eq('id', row.id);
    if (error) {
      throw new Error(`Failed to update sent event ${row.id}: ${error.message}`);
    }
  }

  for (const row of messageCandidates) {
    const { error } = await supabase
      .from('email_messages')
      .update({
        body_text: row.repairedText,
      } as any)
      .eq('id', row.id);
    if (error) {
      throw new Error(`Failed to update email_message ${row.id}: ${error.message}`);
    }
  }

  console.log(`Updated sent events: ${eventCandidates.length}`);
  console.log(`Updated sent email_messages: ${messageCandidates.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
