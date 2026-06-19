import { SupabaseClient } from '@supabase/supabase-js';
import {
  formatUnknownError,
  isRetryableSupabaseReadError,
  reportErrorToSlack,
} from '@furnace/slack-lib';
import type { Enrollment } from '../types.js';
import {
  AUTO_REPLY_CATEGORY,
  isBranchCategory,
  type CategorizerBranchCategory,
} from '../categorizer/classify.js';

/**
 * Categorizer node handler.
 *
 * Driven entirely by durable state (idempotent, safe to re-run):
 * 1. No replied thread yet -> park (next_run_at = NULL, invisible to the claim loop).
 * 2. Latest replied thread has a branch category -> branch (cancel holds,
 *    set reply_thread_id, follow the sourceHandle edge).
 * 3. Category is Auto Reply -> restore the held outbound sequence at the
 *    extracted return date (or now); nothing held -> park and wait for a
 *    real reply (no LLM call).
 * 4. AI on + uncategorized -> classify the latest inbound message, write the
 *    category (source 'ai') with stats sync, then branch or restore.
 * 5. Manual + uncategorized -> park (holds kept; the user's category in the
 *    Master Inbox decides: real category branches, Auto Reply restores).
 *
 * Spec: docs/implementation/flow/CATEGORIZER_IMPLEMENTATION.md
 */

const RETRY_DELAY_MS = 15 * 60 * 1000;

const CATEGORY_SOURCE_HANDLES: Record<CategorizerBranchCategory, string> = {
  Interested: 'interested',
  Neutral: 'neutral',
  'Not Interested': 'not-interested',
};

/** Test seam retained for compatibility; scheduler no longer classifies replies. */
export function resetCategorizerLlmFailureTracking(): void {}

export interface CategorizerHandlerContext {
  activeFlowVersionNumber: number;
}

interface EnrollmentCategorizerState {
  state: string;
  reply_thread_id: string | null;
  held_node_id: string | null;
  held_next_run_at: string | null;
  deleted_at: string | null;
}

interface RepliedThread {
  id: string;
  campaign_id: string | null;
  message_job_id: string | null;
  category: string | null;
  category_source: string | null;
  classification_status: string | null;
  handling_metadata: Record<string, unknown> | null;
  last_message_at: string | null;
}

export async function handleAICategorizerNode(
  enrollment: Enrollment,
  node: any,
  flowData: any,
  supabase: SupabaseClient,
  context: CategorizerHandlerContext,
): Promise<void> {
  const enrollmentTag = enrollment.id.substring(0, 8);
  const useAi = node?.node_data?.use_ai === true;

  // Fresh durable state (claim payload may be stale: reply_thread_id and the
  // hold snapshot can change between claim and processing).
  const { data: freshEnrollment, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('state, reply_thread_id, held_node_id, held_next_run_at, deleted_at')
    .eq('id', enrollment.id)
    .maybeSingle();

  if (enrollmentError) {
    throw enrollmentError;
  }

  const current = freshEnrollment as EnrollmentCategorizerState | null;
  if (!current || current.state !== 'active' || current.deleted_at) {
    console.log(`[CATEGORIZER ${enrollmentTag}] Enrollment no longer active; nothing to do.`);
    return;
  }

  // Already branched: recover the edge advance if a previous run failed
  // between setting reply_thread_id and moving current_node_id.
  if (current.reply_thread_id) {
    const thread = await loadThreadById(supabase, current.reply_thread_id);
    if (thread && isBranchCategory(thread.category)) {
      await branchEnrollment(enrollment, node, flowData, supabase, context, thread.id, thread.category);
      return;
    }

    console.warn(
      `[CATEGORIZER ${enrollmentTag}] reply_thread_id set but thread category is not branchable (${thread?.category ?? 'missing thread'}). Parking.`,
    );
    await parkEnrollment(enrollment, node, supabase, context);
    return;
  }

  // Latest replied thread for this enrollment.
  const thread = await loadLatestRepliedThread(supabase, enrollment.id);

  if (!thread) {
    console.log(`[CATEGORIZER ${enrollmentTag}] No replied thread yet. Parking until a reply arrives.`);
    await parkEnrollment(enrollment, node, supabase, context);
    return;
  }

  // Resolved category (manual, prior AI, or system-stamped).
  if (isBranchCategory(thread.category)) {
    console.log(`[CATEGORIZER ${enrollmentTag}] Thread ${thread.id.substring(0, 8)} categorized '${thread.category}'. Branching.`);
    await branchEnrollment(enrollment, node, flowData, supabase, context, thread.id, thread.category);
    return;
  }

  if (thread.category === AUTO_REPLY_CATEGORY) {
    const returnDate =
      typeof thread.handling_metadata?.return_date === 'string'
        ? thread.handling_metadata.return_date
        : null;
    await handleAutoReply(enrollment, node, supabase, context, thread, returnDate);
    return;
  }

  if (thread.classification_status === 'pending') {
    console.log(
      `[CATEGORIZER ${enrollmentTag}] Classification pending for thread ${thread.id.substring(0, 8)}. Parking until Lambda completes.`,
    );
    await parkEnrollment(enrollment, node, supabase, context);
    return;
  }

  // Uncategorized or failed classification. Scheduler is consumer-only now:
  // it waits for the classify Lambda or a manual inbox action to write the
  // durable thread category.
  if (!useAi) {
    console.log(`[CATEGORIZER ${enrollmentTag}] Manual mode, thread uncategorized. Parking until the user categorizes.`);
  } else {
    console.log(
      `[CATEGORIZER ${enrollmentTag}] AI mode but no durable category yet (status=${thread.classification_status ?? 'none'}). Parking until Lambda writes one.`,
    );
  }
  await parkEnrollment(enrollment, node, supabase, context);
}

async function loadThreadById(
  supabase: SupabaseClient,
  threadId: string,
): Promise<RepliedThread | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('id, campaign_id, message_job_id, category, category_source, classification_status, handling_metadata, last_message_at')
    .eq('id', threadId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return (data as RepliedThread | null) ?? null;
}

async function loadLatestRepliedThread(
  supabase: SupabaseClient,
  enrollmentId: string,
): Promise<RepliedThread | null> {
  const { data, error } = await supabase
    .from('email_threads')
    .select('id, campaign_id, message_job_id, category, category_source, classification_status, handling_metadata, last_message_at')
    .eq('enrollment_id', enrollmentId)
    .eq('has_reply', true)
    .order('last_message_at', { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }
  return ((data ?? [])[0] as RepliedThread | undefined) ?? null;
}

/** Park: active + next_run_at NULL. Invisible to claim_enrollments_ready. */
async function parkEnrollment(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  context: CategorizerHandlerContext,
): Promise<void> {
  const { error } = await supabase
    .from('enrollments')
    .update({
      current_node_id: node.id,
      current_flow_version_number: context.activeFlowVersionNumber,
      next_run_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id)
    .eq('state', 'active');

  if (error) {
    throw error;
  }
}

/** Defer a retry while staying at the categorizer node. */
async function deferRetry(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  context: CategorizerHandlerContext,
  delayMs: number,
): Promise<void> {
  const { error } = await supabase
    .from('enrollments')
    .update({
      current_node_id: node.id,
      current_flow_version_number: context.activeFlowVersionNumber,
      next_run_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id)
    .eq('state', 'active');

  if (error) {
    throw error;
  }
}

/**
 * Auto Reply outcome: restore the held outbound sequence. Nothing held ->
 * park and wait for a real reply (no LLM extraction on sweep wakes).
 * `knownReturnDate` comes from durable thread handling metadata written by the
 * classify Lambda. No scheduler-side extraction call remains.
 */
async function handleAutoReply(
  enrollment: Enrollment,
  node: any,
  supabase: SupabaseClient,
  context: CategorizerHandlerContext,
  thread: RepliedThread,
  knownReturnDate: string | null,
): Promise<void> {
  const enrollmentTag = enrollment.id.substring(0, 8);

  const { data: holdRow, error: holdError } = await supabase
    .from('enrollments')
    .select('held_node_id')
    .eq('id', enrollment.id)
    .maybeSingle();

  if (holdError) {
    throw holdError;
  }

  if (!(holdRow as { held_node_id: string | null } | null)?.held_node_id) {
    console.log(
      `[CATEGORIZER ${enrollmentTag}] Auto Reply with nothing held (sequence already finished). Parking until a real reply.`,
    );
    await parkEnrollment(enrollment, node, supabase, context);
    return;
  }

  const resumeAt = knownReturnDate ? `${knownReturnDate}T00:00:00.000Z` : new Date().toISOString();

  const { data: restored, error: restoreError } = await supabase.rpc('restore_enrollment_outbound', {
    p_enrollment_id: enrollment.id,
    p_resume_at: resumeAt,
  });

  if (restoreError || restored === false) {
    const errMsg = restoreError ? restoreError.message : 'restore_enrollment_outbound returned false';
    console.error(`[CATEGORIZER ${enrollmentTag}] Restore failed: ${errMsg}`);
    reportErrorToSlack('Scheduler: categorizer restore_enrollment_outbound failed', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      thread_id: thread.id,
      error: errMsg,
      alertPolicy: isRetryableSupabaseReadError(errMsg)
        ? 'transient_retryable_warning'
        : 'critical_failure',
      aggregationKey: `categorizer-restore:${enrollment.campaign_id}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
      },
    });
    await deferRetry(enrollment, node, supabase, context, RETRY_DELAY_MS);
    return;
  }

  console.log(
    `[CATEGORIZER ${enrollmentTag}] Auto Reply: outbound sequence restored (resume at ${resumeAt}).`,
  );
}

/**
 * Branch: cancel held jobs, set reply_thread_id, follow the sourceHandle
 * edge. No connected edge for the category -> enrollment completed.
 */
async function branchEnrollment(
  enrollment: Enrollment,
  node: any,
  flowData: any,
  supabase: SupabaseClient,
  context: CategorizerHandlerContext,
  threadId: string,
  category: CategorizerBranchCategory,
): Promise<void> {
  const enrollmentTag = enrollment.id.substring(0, 8);

  // 1. Held jobs are cancelled once a real category resolves.
  const { error: cancelError } = await supabase.rpc('cancel_held_jobs_for_enrollment', {
    p_enrollment_id: enrollment.id,
  });

  if (cancelError) {
    console.error(`[CATEGORIZER ${enrollmentTag}] Failed to cancel held jobs: ${cancelError.message}`);
    reportErrorToSlack('Scheduler: categorizer branch failed to cancel held jobs', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      thread_id: threadId,
      error: cancelError.message,
      alertPolicy: isRetryableSupabaseReadError(cancelError.message)
        ? 'transient_retryable_warning'
        : 'critical_failure',
      aggregationKey: `categorizer-branch:${enrollment.campaign_id}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
      },
    });
    await deferRetry(enrollment, node, supabase, context, RETRY_DELAY_MS);
    return;
  }

  // 2. Match the edge by sourceHandle.
  const sourceHandle = CATEGORY_SOURCE_HANDLES[category];
  const edges: any[] = flowData?.edges ?? [];
  const matchingEdge = edges.find(
    (edge: any) => edge.source === node.flow_node_id && edge.sourceHandle === sourceHandle,
  );

  if (!matchingEdge) {
    console.warn(
      `[CATEGORIZER ${enrollmentTag}] No edge connected for category '${category}' (handle '${sourceHandle}'). Completing enrollment.`,
    );
    reportErrorToSlack('Scheduler: categorizer has no edge for resolved category (enrollment completed)', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      node_id: node.id,
      category,
      alertPolicy: 'persistent_config_warning',
      aggregationKey: `categorizer-no-edge:${enrollment.campaign_id}:${sourceHandle}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
        category,
      },
    });

    const { error: completeError } = await supabase
      .from('enrollments')
      .update({
        state: 'completed',
        reply_thread_id: threadId,
        current_node_id: node.id,
        current_flow_version_number: context.activeFlowVersionNumber,
        next_run_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', enrollment.id)
      .eq('state', 'active');

    if (completeError) {
      throw completeError;
    }
    return;
  }

  // 3. Resolve the target database node.
  const { data: targetNodes, error: targetError } = await supabase
    .from('nodes')
    .select('id, flow_node_id, node_type')
    .eq('campaign_id', enrollment.campaign_id)
    .eq('flow_node_id', matchingEdge.target)
    .is('deleted_at', null)
    .limit(1);

  if (targetError) {
    throw targetError;
  }

  const targetNode = (targetNodes ?? [])[0] as { id: string; flow_node_id: string } | undefined;
  if (!targetNode) {
    console.error(
      `[CATEGORIZER ${enrollmentTag}] Branch target node '${matchingEdge.target}' not found. Retrying.`,
    );
    reportErrorToSlack('Scheduler: categorizer branch target node not found (flow inconsistency)', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      flow_node_id: matchingEdge.target,
      alertPolicy: 'persistent_config_warning',
      aggregationKey: `categorizer-target-missing:${enrollment.campaign_id}:${matchingEdge.target}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
        flow_node_id: matchingEdge.target,
      },
    });
    await deferRetry(enrollment, node, supabase, context, 60 * 1000);
    return;
  }

  // 4. Advance: reply_thread_id marks the enrollment as branched (idempotency
  //    guard - only one branch is ever taken).
  const { error: advanceError } = await supabase
    .from('enrollments')
    .update({
      reply_thread_id: threadId,
      current_node_id: targetNode.id,
      current_flow_version_number: context.activeFlowVersionNumber,
      next_run_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id)
    .eq('state', 'active');

  if (advanceError) {
    console.error(`[CATEGORIZER ${enrollmentTag}] Branch advance failed: ${advanceError.message}`);
    reportErrorToSlack('Scheduler: categorizer branch advance failed', {
      severity: 'critical',
      enrollment_id: enrollment.id,
      campaign_id: enrollment.campaign_id,
      thread_id: threadId,
      error: advanceError.message,
      alertPolicy: isRetryableSupabaseReadError(advanceError.message)
        ? 'transient_retryable_warning'
        : 'critical_failure',
      aggregationKey: `categorizer-branch:${enrollment.campaign_id}`,
      summaryFields: {
        campaign_id: enrollment.campaign_id,
      },
    });
    await deferRetry(enrollment, node, supabase, context, RETRY_DELAY_MS);
    return;
  }

  console.log(
    `[CATEGORIZER ${enrollmentTag}] Branched '${category}' -> node ${targetNode.id.substring(0, 8)} (thread ${threadId.substring(0, 8)}).`,
  );
}
