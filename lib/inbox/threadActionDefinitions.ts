import type { SmartHandlingActionId, SmartHandlingActionOption } from './smartHandling';

/** Inbox thread actions include smart-handling ids plus menu-only entries. */
export type ThreadActionId = SmartHandlingActionId | 'mark_out_of_office';

export type ThreadActionPhase = 'immediate' | 'deferred';
export type ThreadActionSource = 'smart_handling' | 'message_menu';
export type FinalizeWhen = 'always' | 'smart_handling_only' | 'never';

export interface ThreadActionPresentation {
  desktop: 'modal';
  mobile: 'modal' | 'page';
  mobileRoute?: '/inbox/replace-lead';
}

export interface ThreadActionImmediateEffects {
  setCategory?: 'Interested' | 'Neutral' | 'Not Interested' | 'Auto Reply';
  oooResume?: 'dated' | 'month' | 'instant';
  blockSender?: boolean;
  openComposer?: 'reply_only' | 'mark_interested_reply';
}

export interface ThreadActionCompleteEffects {
  setCategory?: 'Auto Reply';
  when: FinalizeWhen;
}

export interface ThreadActionFinalizePolicy {
  closeConversation: FinalizeWhen;
  dismissSmartHandling: FinalizeWhen;
  refresh: boolean;
}

export interface ThreadActionDefinition {
  phase: ThreadActionPhase;
  effects?: ThreadActionImmediateEffects;
  completeEffects?: ThreadActionCompleteEffects;
  presentation?: ThreadActionPresentation;
  finalize: ThreadActionFinalizePolicy;
  messages: { opening?: string; completed: string };
}

export interface ResolvedFinalizeSteps {
  closeConversation: boolean;
  dismissSmartHandling: boolean;
  refresh: boolean;
  setCategoryOnComplete: string | null;
}

const IMMEDIATE_AUTO_CLOSE = new Set<ThreadActionId>([
  'mark_ooo_dated',
  'mark_ooo_month',
  'mark_ooo_instant',
  'mark_not_interested',
  'mark_not_interested_block',
  'block_sender',
  'close_conversation',
]);

export const THREAD_ACTION_DEFINITIONS: Record<ThreadActionId, ThreadActionDefinition> = {
  close_conversation: {
    phase: 'immediate',
    finalize: {
      closeConversation: 'always',
      dismissSmartHandling: 'never',
      refresh: false,
    },
    messages: { completed: 'Conversation closed' },
  },
  replace_lead: {
    phase: 'deferred',
    presentation: {
      desktop: 'modal',
      mobile: 'page',
      mobileRoute: '/inbox/replace-lead',
    },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: true,
    },
    messages: { opening: 'Opening replace lead', completed: 'Replacement lead created.' },
  },
  mark_ooo_custom: {
    phase: 'deferred',
    presentation: { desktop: 'modal', mobile: 'modal' },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: true,
    },
    messages: { opening: 'Opening out of office', completed: 'Out of office saved' },
  },
  mark_out_of_office: {
    phase: 'deferred',
    presentation: { desktop: 'modal', mobile: 'modal' },
    finalize: {
      closeConversation: 'never',
      dismissSmartHandling: 'never',
      refresh: true,
    },
    messages: { completed: 'Out of office saved' },
  },
  mark_interested: {
    phase: 'immediate',
    effects: { setCategory: 'Interested' },
    finalize: {
      closeConversation: 'never',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Marked as Interested' },
  },
  mark_interested_reply: {
    phase: 'immediate',
    effects: { setCategory: 'Interested', openComposer: 'mark_interested_reply' },
    finalize: {
      closeConversation: 'never',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Marked as Interested — reply ready' },
  },
  mark_neutral: {
    phase: 'immediate',
    effects: { setCategory: 'Neutral' },
    finalize: {
      closeConversation: 'never',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Marked as Neutral' },
  },
  mark_not_interested: {
    phase: 'immediate',
    effects: { setCategory: 'Not Interested' },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Marked as Not Interested' },
  },
  mark_not_interested_block: {
    phase: 'immediate',
    effects: { setCategory: 'Not Interested', blockSender: true },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Marked as Not Interested and sender blocked' },
  },
  block_sender: {
    phase: 'immediate',
    effects: { blockSender: true },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Sender blocked' },
  },
  mark_ooo_dated: {
    phase: 'immediate',
    effects: { oooResume: 'dated' },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Out of office saved' },
  },
  mark_ooo_month: {
    phase: 'immediate',
    effects: { oooResume: 'month' },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Out of office saved' },
  },
  mark_ooo_instant: {
    phase: 'immediate',
    effects: { oooResume: 'instant' },
    finalize: {
      closeConversation: 'smart_handling_only',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Out of office saved' },
  },
  reply_only: {
    phase: 'immediate',
    effects: { openComposer: 'reply_only' },
    finalize: {
      closeConversation: 'never',
      dismissSmartHandling: 'smart_handling_only',
      refresh: false,
    },
    messages: { completed: 'Reply composer opened' },
  },
  dismiss: {
    phase: 'immediate',
    finalize: {
      closeConversation: 'never',
      dismissSmartHandling: 'always',
      refresh: false,
    },
    messages: { completed: 'Suggestion dismissed' },
  },
};

function resolveWhen(when: FinalizeWhen, source: ThreadActionSource): boolean {
  if (when === 'always') return true;
  if (when === 'never') return false;
  return source === 'smart_handling';
}

export function getThreadActionDefinition(actionId: ThreadActionId): ThreadActionDefinition {
  return THREAD_ACTION_DEFINITIONS[actionId];
}

export function isDeferredThreadAction(actionId: ThreadActionId): boolean {
  return THREAD_ACTION_DEFINITIONS[actionId].phase === 'deferred';
}

export function shouldAutoCloseConversationForAction(actionId: ThreadActionId): boolean {
  return IMMEDIATE_AUTO_CLOSE.has(actionId);
}

export function resolveFinalizeSteps(
  actionId: ThreadActionId,
  source: ThreadActionSource,
  phase: 'immediate' | 'complete' = 'immediate',
): ResolvedFinalizeSteps {
  const definition = THREAD_ACTION_DEFINITIONS[actionId];
  const completeEffects = definition.completeEffects;

  let setCategoryOnComplete: string | null = null;
  if (phase === 'complete' && completeEffects && resolveWhen(completeEffects.when, source)) {
    setCategoryOnComplete = completeEffects.setCategory ?? null;
  }

  return {
    closeConversation: resolveWhen(definition.finalize.closeConversation, source),
    dismissSmartHandling: resolveWhen(definition.finalize.dismissSmartHandling, source),
    refresh: definition.finalize.refresh,
    setCategoryOnComplete,
  };
}

export function getThreadActionSuccessMessage(
  actionId: ThreadActionId,
  phase: 'opening' | 'completed' = 'completed',
  label?: string,
): string {
  const definition = THREAD_ACTION_DEFINITIONS[actionId];
  if (phase === 'opening' && definition.messages.opening) {
    return definition.messages.opening;
  }
  return definition.messages.completed || `${label ?? actionId} applied`;
}

export function getSmartHandlingActionSuccessMessage(option: SmartHandlingActionOption): string {
  const definition = THREAD_ACTION_DEFINITIONS[option.action];
  return definition.messages.opening ?? definition.messages.completed ?? `${option.label} applied`;
}

export const SMART_HANDLING_DISMISS_SUCCESS_MESSAGE =
  THREAD_ACTION_DEFINITIONS.dismiss.messages.completed;
