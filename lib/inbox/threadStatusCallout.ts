import type { SmartHandlingActionOption, SmartHandlingMetadata, SmartHandlingMode } from './smartHandling';
import type { ThreadAutoReplyPipelineState } from '@/lib/supabase/services';

export type ThreadStatusCalloutKind = 'loading' | 'manual_actions' | 'ai_info' | 'pipeline_only';
export type ThreadStatusCalloutTone = 'info' | 'warning' | 'ai' | 'pipeline';

export interface ThreadStatusCalloutView {
  kind: ThreadStatusCalloutKind;
  mode: SmartHandlingMode;
  tone: ThreadStatusCalloutTone;
  title: string;
  message: string;
  secondaryMessage?: string | null;
  loading: boolean;
  primary?: SmartHandlingActionOption | null;
  alternatives?: SmartHandlingActionOption[];
  dismissible: boolean;
}

export interface ResolveThreadStatusCalloutParams {
  conversationStatus: string | null | undefined;
  classificationStatus: string | null | undefined;
  category: string | null | undefined;
  categorySource: string | null | undefined;
  handlingMetadata: SmartHandlingMetadata | null | undefined;
  pipelineState: ThreadAutoReplyPipelineState | null | undefined;
  dismissedForCurrentView: boolean;
}

const MANUAL_PIPELINE_HINT = 'An automated campaign reply may send after you categorize.';
const PENDING_MANUAL_PIPELINE_HINT = 'An automated campaign reply may send once classification completes.';
const DEFAULT_LOADING_MESSAGE = 'Classifying the latest reply for smart handling.';
const DEFAULT_PIPELINE_MESSAGE = 'Automated reply preparing...';
const REPLACE_AND_FORWARD_LABEL = 'Replace + forward with message';

function trimTrailingPeriod(value: string): string {
  return value.trim().replace(/[.]\s*$/, '');
}

function joinSentences(primary: string, secondary: string): string {
  return `${trimTrailingPeriod(primary)}. ${secondary.trim()}`;
}

function combinePendingMessageAndHint(message: string, hint: string | null): { message: string; secondaryMessage: string | null } {
  if (!hint) {
    return { message, secondaryMessage: null };
  }
  return {
    message: joinSentences(message, hint),
    secondaryMessage: null,
  };
}

function normalizeActionLabel(
  action: SmartHandlingActionOption | null | undefined
): SmartHandlingActionOption | null {
  if (!action) return null;
  if (action.action !== 'replace_lead') return action;
  if (action.label === REPLACE_AND_FORWARD_LABEL) return action;
  return { ...action, label: REPLACE_AND_FORWARD_LABEL };
}

function resolveManualPipelineSecondaryMessage(
  metadata: SmartHandlingMetadata | null | undefined
): string | null {
  const category = metadata?.category;
  const hasActions = !!(metadata?.primary || (metadata?.alternatives?.length ?? 0) > 0);

  if (!hasActions) {
    return 'The campaign may send its automated follow-up once this reply is categorized.';
  }

  // Primary message + action buttons already explain what to do.
  if (category === 'Auto Reply') {
    return null;
  }

  if (metadata?.header_mismatch || metadata?.suggested_referral?.reason === 'wrong_contact') {
    return 'The campaign may email the wrong contact until the lead is replaced.';
  }

  if (metadata?.suggested_referral) {
    return 'The campaign may send to the wrong person until the lead is updated.';
  }

  if (category === 'Not Interested') {
    return "The campaign's automated follow-up will send unless this is marked not interested.";
  }

  if (category === 'Interested') {
    return 'Your selection determines whether the campaign sends its automated follow-up.';
  }

  if (category === 'Neutral') {
    return "The campaign's automated follow-up will send once this reply is categorized.";
  }

  return null;
}

function combineCompletedMessageAndHint(
  kind: 'manual_actions' | 'ai_info',
  message: string,
  hint: string | null,
  handlingMetadata?: SmartHandlingMetadata | null | undefined
): { message: string; secondaryMessage: string | null } {
  if (!hint) {
    return { message, secondaryMessage: null };
  }

  if (kind === 'manual_actions' && hint === MANUAL_PIPELINE_HINT) {
    return {
      message,
      secondaryMessage: resolveManualPipelineSecondaryMessage(handlingMetadata),
    };
  }

  if (hint === DEFAULT_PIPELINE_MESSAGE || /^Automated reply preparing/i.test(hint)) {
    return {
      message,
      secondaryMessage: "The campaign's automated follow-up is being prepared.",
    };
  }

  return {
    message: joinSentences(message, hint),
    secondaryMessage: null,
  };
}

function resolveMode(
  handlingMetadata: SmartHandlingMetadata | null | undefined,
  categorySource: string | null | undefined
): SmartHandlingMode {
  return handlingMetadata?.mode ?? (categorySource === 'ai' ? 'ai' : 'manual');
}

const WARNING_PRIMARY_ACTIONS = new Set<SmartHandlingActionOption['action']>([
  'replace_lead',
  'block_sender',
  'mark_not_interested_block',
]);

export function resolveThreadStatusCalloutTone(
  kind: ThreadStatusCalloutKind,
  handlingMetadata: SmartHandlingMetadata | null | undefined
): ThreadStatusCalloutTone {
  if (kind === 'pipeline_only') return 'pipeline';
  if (kind === 'ai_info') return 'ai';

  if (
    handlingMetadata?.header_mismatch ||
    handlingMetadata?.suggested_referral?.reason === 'wrong_contact' ||
    (handlingMetadata?.primary?.action &&
      WARNING_PRIMARY_ACTIONS.has(handlingMetadata.primary.action))
  ) {
    return 'warning';
  }

  if (handlingMetadata?.suggested_referral) {
    return 'warning';
  }

  if (handlingMetadata?.category === 'Not Interested') {
    return 'warning';
  }

  return 'info';
}

function resolvePipelineSecondaryMessage(
  classificationStatus: string | null | undefined,
  mode: SmartHandlingMode,
  category: string | null | undefined,
  pipelineState: ThreadAutoReplyPipelineState | null | undefined
): string | null {
  if (!pipelineState?.active) return null;
  if (pipelineState.phase === 'arming_reply') {
    return pipelineState.label?.trim() || DEFAULT_PIPELINE_MESSAGE;
  }
  if (pipelineState.phase === 'categorizing') {
    if (mode === 'manual' && !category) {
      if (classificationStatus === 'pending') {
        return PENDING_MANUAL_PIPELINE_HINT;
      }
      return MANUAL_PIPELINE_HINT;
    }
    return pipelineState.label?.trim() || null;
  }
  return pipelineState.label?.trim() || null;
}

export function resolveThreadStatusCallout({
  conversationStatus,
  classificationStatus,
  category,
  categorySource,
  handlingMetadata,
  pipelineState,
  dismissedForCurrentView,
}: ResolveThreadStatusCalloutParams): ThreadStatusCalloutView | null {
  const mode = resolveMode(handlingMetadata, categorySource);
  const isOpenConversation = conversationStatus === 'open';
  const pipelineSecondaryMessage = resolvePipelineSecondaryMessage(
    classificationStatus,
    mode,
    category,
    pipelineState
  );

  if (isOpenConversation && !dismissedForCurrentView) {
    if (classificationStatus === 'pending') {
      const combined = combinePendingMessageAndHint('Classifying the latest reply', pipelineSecondaryMessage);
      return {
        kind: 'loading',
        mode,
        tone: resolveThreadStatusCalloutTone('loading', handlingMetadata),
        title: 'Smart handling',
        message: pipelineSecondaryMessage ? combined.message : DEFAULT_LOADING_MESSAGE,
        secondaryMessage: combined.secondaryMessage,
        loading: true,
        dismissible: true,
      };
    }

    if (classificationStatus === 'complete') {
      if (mode === 'manual') {
        const primaryMessage = handlingMetadata?.primary_message ?? 'Suggested next step for this reply.';
        const combined = combineCompletedMessageAndHint(
          'manual_actions',
          primaryMessage,
          pipelineSecondaryMessage,
          handlingMetadata
        );
        return {
          kind: 'manual_actions',
          mode,
          tone: resolveThreadStatusCalloutTone('manual_actions', handlingMetadata),
          title: 'Suggested next step',
          message: combined.message,
          secondaryMessage: combined.secondaryMessage,
          loading: false,
          primary: normalizeActionLabel(handlingMetadata?.primary),
          alternatives: (handlingMetadata?.alternatives ?? []).map((action) => normalizeActionLabel(action) ?? action),
          dismissible: true,
        };
      }

      const aiMessage =
        handlingMetadata?.primary_message ??
        (category ? `AI categorized this reply as ${category}.` : 'AI finished classifying this reply.');
      const combined = combineCompletedMessageAndHint(
        'ai_info',
        aiMessage,
        pipelineSecondaryMessage,
        handlingMetadata
      );
      return {
        kind: 'ai_info',
        mode,
        tone: resolveThreadStatusCalloutTone('ai_info', handlingMetadata),
        title: 'AI classification',
        message: combined.message,
        secondaryMessage: combined.secondaryMessage,
        loading: false,
        dismissible: true,
      };
    }
  }

  if (pipelineState?.active) {
    return {
      kind: 'pipeline_only',
      mode,
      tone: resolveThreadStatusCalloutTone('pipeline_only', handlingMetadata),
      title: 'Automated reply in progress',
      message: pipelineState.label?.trim() || DEFAULT_PIPELINE_MESSAGE,
      loading: false,
      dismissible: false,
    };
  }

  return null;
}
