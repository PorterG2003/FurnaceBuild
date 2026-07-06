import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type CategorizerCategory } from '../../../lib/categorizer/index';
import { classifyReply as runCategorizer } from '../../../workers/scheduler-worker/src/categorizer/classify';
import type { ClassifyReplyQueuePayload } from '../../../workers/inbox-checker-worker/src/emit-classify-reply-job';
import { detectAutoReplyRedirectSignals } from '../../../lib/inbox/autoReplyRedirectDetection';
import {
  buildSuggestedReferralFromExtraction,
  extractReferralContactHeuristic,
  type SuggestedReferralReason,
} from '../../../lib/inbox/referralContactExtraction';
import { parseOutOfOfficeReturnDate } from '../../../lib/inbox/parseOutOfOfficeReturnDate';
import {
  buildAutoReplyInfoMessage,
  buildSystemDetectedAutoReplyMetadata,
  buildOooSmartHandlingOptions,
  buildNeutralSmartHandlingOptions,
  buildNotInterestedSmartHandlingOptions,
} from '../../../lib/inbox/smartHandling';
import { resolveSuggestionVersion } from '../../../lib/inbox/smartHandlingVersion';

type ThreadRow = {
  id: string;
  account_id: string;
  campaign_id: string | null;
  message_job_id: string | null;
  lead_id: string | null;
  category: string | null;
  category_source: string | null;
  classification_status: string;
};

type MessageRow = {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_at: string | null;
};

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) or SUPABASE_SECRET_KEY');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

import {
  INTERESTED_SMART_HANDLING_SUGGESTED_REPLY,
  NEUTRAL_SMART_HANDLING_SUGGESTED_REPLY,
} from '../../../lib/inbox/smartHandling';

function buildSuggestedReply(category: CategorizerCategory): string | null {
  switch (category) {
    case 'Interested':
      return INTERESTED_SMART_HANDLING_SUGGESTED_REPLY;
    case 'Neutral':
      return NEUTRAL_SMART_HANDLING_SUGGESTED_REPLY;
    default:
      return null;
  }
}

function buildReplaceLeadMetadata(params: {
  category: CategorizerCategory;
  headerMismatch: boolean;
  bodyText: string | null;
  fromEmail: string;
  fromName: string | null;
  leadEmail: string | null;
  primaryMessage: string;
  reason: SuggestedReferralReason;
  alternatives: Array<{ action: string; label: string }>;
}) {
  const {
    category,
    headerMismatch,
    bodyText,
    fromEmail,
    fromName,
    leadEmail,
    primaryMessage,
    reason,
    alternatives,
  } = params;
  const extraction = extractReferralContactHeuristic({
    bodyText,
    fromEmail,
    fromName,
    leadEmail,
  });

  return {
    mode: 'manual',
    suggestion_version: resolveSuggestionVersion('manual'),
    category,
    return_date: null,
    primary_message: primaryMessage,
    primary: { action: 'replace_lead', label: 'Replace + forward with message' },
    alternatives,
    follow_ups: [],
    suggested_reply: buildSuggestedReply(category),
    suggested_referral: buildSuggestedReferralFromExtraction(extraction, reason),
    header_mismatch: headerMismatch,
  };
}

function buildManualMetadata(params: {
  category: CategorizerCategory;
  returnDate: string | null;
  fromEmail: string;
  fromName: string | null;
  leadEmail: string | null;
  subject: string | null;
  bodyText: string | null;
}) {
  const { category, returnDate, fromEmail, fromName, leadEmail, subject, bodyText } = params;
  const redirect = detectAutoReplyRedirectSignals({ fromEmail, leadEmail, bodyText });

  if (category === 'Auto Reply') {
    if (redirect.shouldReplaceLead) {
      return buildReplaceLeadMetadata({
        category,
        headerMismatch: redirect.headerMismatch,
        bodyText,
        fromEmail,
        fromName,
        leadEmail,
        primaryMessage: redirect.headerMismatch
          ? 'This auto-reply came from a different contact. Consider replacing the lead.'
          : 'This auto-reply redirects you to a different contact.',
        reason: 'auto_reply_forward',
        alternatives: [{ action: 'mark_neutral', label: 'Mark neutral' }],
      });
    }
    const oooOptions = buildOooSmartHandlingOptions(returnDate);
    return {
      mode: 'manual',
      suggestion_version: resolveSuggestionVersion('manual'),
      category,
      return_date: oooOptions.return_date,
      primary_message: oooOptions.primary_message,
      primary: oooOptions.primary,
      alternatives: oooOptions.alternatives,
      follow_ups: [],
      suggested_reply: null,
      suggested_referral: null,
      header_mismatch: false,
    };
  }

  if (redirect.shouldReplaceLead) {
    return buildReplaceLeadMetadata({
      category,
      headerMismatch: redirect.headerMismatch,
      bodyText,
      fromEmail,
      fromName,
      leadEmail,
      primaryMessage: redirect.headerMismatch
        ? 'This reply came from a different contact. Consider replacing the lead.'
        : 'This reply may be redirecting you to a different contact.',
      reason: redirect.headerMismatch ? 'wrong_contact' : 'manual_referral',
      alternatives:
        category === 'Interested'
          ? [
              { action: 'mark_interested_reply', label: 'Interested + reply' },
              { action: 'mark_interested', label: 'Interested only' },
            ]
          : category === 'Not Interested'
            ? [{ action: 'mark_not_interested', label: 'Not Interested only' }]
            : [{ action: 'mark_neutral', label: 'Mark neutral' }],
    });
  }

  if (category === 'Interested') {
    return {
      mode: 'manual',
      suggestion_version: resolveSuggestionVersion('manual'),
      category,
      return_date: null,
      primary_message: 'This looks like an interested reply.',
      primary: { action: 'mark_interested_reply', label: 'Interested + reply' },
      alternatives: [
        { action: 'mark_interested', label: 'Interested only' },
        { action: 'reply_only', label: 'Reply only' },
      ],
      follow_ups: [],
      suggested_reply: buildSuggestedReply(category),
      suggested_referral: null,
      header_mismatch: false,
    };
  }

  if (category === 'Not Interested') {
    const notInterestedOptions = buildNotInterestedSmartHandlingOptions({ subject, bodyText });
    return {
      mode: 'manual',
      suggestion_version: resolveSuggestionVersion('manual'),
      category,
      return_date: null,
      primary_message: notInterestedOptions.primary_message,
      primary: notInterestedOptions.primary,
      alternatives: notInterestedOptions.alternatives,
      follow_ups: [],
      suggested_reply: null,
      suggested_referral: null,
      header_mismatch: false,
    };
  }

  return {
    mode: 'manual',
    suggestion_version: resolveSuggestionVersion('manual'),
    category,
    return_date: null,
    ...buildNeutralSmartHandlingOptions(),
    follow_ups: [],
    suggested_referral: null,
    header_mismatch: false,
  };
}

function buildAiMetadata(params: {
  category: CategorizerCategory;
  returnDate: string | null;
  categorySource?: string | null;
}) {
  const { category, returnDate, categorySource } = params;

  if (category === 'Auto Reply') {
    return {
      mode: 'ai',
      suggestion_version: resolveSuggestionVersion('ai'),
      category,
      return_date: returnDate,
      primary_message: buildAutoReplyInfoMessage({ returnDate, categorySource }),
      primary: null,
      alternatives: [],
      follow_ups: [],
      suggested_reply: null,
      suggested_referral: null,
      header_mismatch: false,
    };
  }

  return {
    mode: 'ai',
    suggestion_version: resolveSuggestionVersion('ai'),
    category,
    return_date: null,
    primary_message: `AI categorized this reply as ${category}.`,
    primary: null,
    alternatives: [],
    follow_ups: [],
    suggested_reply: null,
    suggested_referral: null,
    header_mismatch: false,
  };
}

async function syncPositiveReplyStats(
  supabase: SupabaseClient,
  thread: ThreadRow,
  nextCategory: string,
): Promise<void> {
  if (!thread.campaign_id || !thread.message_job_id) return;

  const previousPositive = thread.category === 'Interested';
  const nextPositive = nextCategory === 'Interested';

  const { error: eventError } = await supabase.rpc('update_replied_event_is_positive', {
    p_campaign_id: thread.campaign_id,
    p_message_job_id: thread.message_job_id,
    p_is_positive: nextPositive,
  });
  if (eventError) {
    console.error('[classifyReply] failed to sync replied event positivity', eventError);
  }

  const delta = nextPositive === previousPositive ? 0 : nextPositive ? 1 : -1;
  if (delta !== 0) {
    const { error: statsError } = await supabase.rpc('update_campaign_stats_positive_reply', {
      p_campaign_id: thread.campaign_id,
      p_delta: delta,
    });
    if (statsError) {
      console.error('[classifyReply] failed to adjust campaign_stats positive_reply_count', statsError);
    }
  }
}

export async function processClassifyReplyPayload(
  payload: ClassifyReplyQueuePayload,
  supabase: SupabaseClient,
): Promise<void> {
  if (!payload.threadId || !payload.emailMessageId) {
    return;
  }

  const { data: threadData, error: threadError } = await supabase
    .from('email_threads')
    .select('id, account_id, campaign_id, message_job_id, lead_id, category, category_source, classification_status')
    .eq('id', payload.threadId)
    .maybeSingle();
  if (threadError) throw threadError;
  const thread = threadData as ThreadRow | null;
  if (!thread) return;

  const { data: messageData, error: messageError } = await supabase
    .from('email_messages')
    .select('id, from_email, from_name, subject, body_text, body_html, received_at')
    .eq('id', payload.emailMessageId)
    .maybeSingle();
  if (messageError) throw messageError;
  const message = messageData as MessageRow | null;
  if (!message) return;

  const { data: lead } = thread.lead_id
    ? await supabase.from('leads').select('email').eq('id', thread.lead_id).maybeSingle()
    : { data: null };
  const leadEmail = (lead as { email?: string | null } | null)?.email ?? null;

  const systemStampedAutoReply =
    thread.category === 'Auto Reply' && thread.category_source === 'system';

  let category: CategorizerCategory;
  let returnDate: string | null = null;

  if (systemStampedAutoReply) {
    category = 'Auto Reply';
    const sourceText = message.body_text ?? message.body_html ?? '';
    const parsed = parseOutOfOfficeReturnDate(
      sourceText,
      message.received_at ? new Date(message.received_at) : new Date(),
    );
    returnDate = parsed ? parsed.toISOString().slice(0, 10) : null;
  } else {
    const result = await runCategorizer({
      subject: message.subject,
      bodyText: message.body_text ?? message.body_html,
      messageDate: message.received_at ? new Date(message.received_at) : new Date(),
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
    category = result.classification.category;
    returnDate = result.classification.returnDate;
  }

  const handlingMetadata = systemStampedAutoReply
    ? buildSystemDetectedAutoReplyMetadata(returnDate)
    : payload.hasCategorizer && payload.useAi
      ? buildAiMetadata({
          category,
          returnDate,
          categorySource: 'ai',
        })
      : buildManualMetadata({
          category,
          returnDate,
          fromEmail: message.from_email,
          fromName: message.from_name,
          leadEmail,
          subject: message.subject,
          bodyText: message.body_text,
        });

  const updatePatch: Record<string, unknown> = {
    handling_metadata: handlingMetadata,
    classification_status: 'complete',
    classification_completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (payload.hasCategorizer && payload.useAi && thread.category_source !== 'user') {
    updatePatch.category = category;
    updatePatch.category_source = systemStampedAutoReply ? thread.category_source : 'ai';
  }

  const { error: updateError } = await supabase
    .from('email_threads')
    .update(updatePatch)
    .eq('id', thread.id);
  if (updateError) throw updateError;

  if (payload.hasCategorizer && payload.useAi && thread.category_source !== 'user') {
    await syncPositiveReplyStats(supabase, thread, category);
    const { error: wakeError } = await supabase.rpc('wake_enrollment_for_thread_category', {
      p_thread_id: thread.id,
    });
    if (wakeError) {
      console.error('[classifyReply] failed to wake enrollment after AI classify', wakeError);
    }
  }
}

async function markThreadClassificationFailed(
  supabase: SupabaseClient,
  threadId: string,
): Promise<void> {
  await supabase
    .from('email_threads')
    .update({
      classification_status: 'failed',
      classification_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', threadId);
}

export async function processClassifyReplyPayloadSafely(
  payload: ClassifyReplyQueuePayload,
  supabase: SupabaseClient,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await processClassifyReplyPayload(payload, supabase);
    return { ok: true };
  } catch (error) {
    console.error('[classifyReply] failed to process payload', payload.threadId, payload.emailMessageId, error);

    if (payload.threadId) {
      try {
        await markThreadClassificationFailed(supabase, payload.threadId);
      } catch (secondaryError) {
        console.error('[classifyReply] failed to mark thread classification failed', secondaryError);
      }
    }

    return { ok: false, error };
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const supabase = getSupabase();
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  await Promise.all(
    event.Records.map(async (record) => {
      const payload = JSON.parse(record.body ?? '{}') as ClassifyReplyQueuePayload;
      const result = await processClassifyReplyPayloadSafely(payload, supabase);
      if (!result.ok) {
        console.error('[classifyReply] failed to process record', record.messageId, result.error);
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }),
  );

  return { batchItemFailures };
};
