import type { ThreadActionId, ThreadActionSource } from './threadActionDefinitions';
import type { InboxInteractionAction, InboxInteractionSource } from './inboxInteractionTypes';

export const INSTRUMENTED_THREAD_ACTIONS: readonly ThreadActionId[] = [
  'mark_ooo_dated',
  'mark_ooo_month',
  'mark_ooo_instant',
  'mark_ooo_custom',
  'mark_out_of_office',
  'mark_not_interested',
  'mark_not_interested_block',
  'block_sender',
  'mark_neutral',
  'mark_interested',
  'mark_interested_reply',
  'reply_only',
  'replace_lead',
  'close_conversation',
] as const;

export function mapThreadActionSourceToInteractionSource(source: ThreadActionSource): InboxInteractionSource {
  return source === 'smart_handling' ? 'smart_handling_bar' : 'message_menu';
}

export function mapThreadActionToInteractionAction(actionId: ThreadActionId): InboxInteractionAction {
  switch (actionId) {
    case 'mark_ooo_dated':
      return 'thread.mark_ooo_dated';
    case 'mark_ooo_month':
      return 'thread.mark_ooo_month';
    case 'mark_ooo_instant':
      return 'thread.mark_ooo_instant';
    case 'mark_ooo_custom':
      return 'thread.mark_ooo_custom';
    case 'mark_out_of_office':
      return 'thread.mark_out_of_office';
    case 'mark_not_interested':
      return 'thread.mark_not_interested';
    case 'mark_not_interested_block':
      return 'thread.mark_not_interested_block';
    case 'block_sender':
      return 'thread.block_sender';
    case 'mark_neutral':
      return 'thread.mark_neutral';
    case 'mark_interested':
      return 'thread.mark_interested';
    case 'mark_interested_reply':
      return 'thread.mark_interested_reply';
    case 'reply_only':
      return 'thread.reply_only';
    case 'replace_lead':
      return 'thread.replace_lead';
    case 'close_conversation':
      return 'thread.close_conversation';
  }
}
