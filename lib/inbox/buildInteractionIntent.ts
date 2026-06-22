import type { InboxInteractionIntent } from './inboxInteractionTypes';
import type { SmartHandlingActionId, SmartHandlingMetadata } from './smartHandling';

export function inferSmartHandlingActionForCategory(
  category: string | null | undefined,
): SmartHandlingActionId | null {
  switch (category) {
    case 'Interested':
      return 'mark_interested';
    case 'Neutral':
      return 'mark_neutral';
    case 'Not Interested':
      return 'mark_not_interested';
    case 'Auto Reply':
      return 'mark_ooo_month';
    default:
      return null;
  }
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function detectSuggestedReplyUsage(
  suggestedReply: string | null | undefined,
  composedBody: string | null | undefined,
): boolean | null {
  const normalizedSuggested = normalizeText(suggestedReply);
  if (!normalizedSuggested) return null;

  const normalizedBody = normalizeText(composedBody);
  if (!normalizedBody) return false;

  return normalizedBody === normalizedSuggested || normalizedBody.startsWith(normalizedSuggested);
}

export interface BuildInteractionIntentParams {
  metadata?: SmartHandlingMetadata | null;
  actionId?: string | null;
  categorySelection?: string | null;
  composedBody?: string | null;
  usedSuggestedReply?: boolean | null;
}

export function buildInteractionIntent(
  params: BuildInteractionIntentParams,
): InboxInteractionIntent | null {
  const metadata = params.metadata ?? null;
  const suggestedPrimary = metadata?.primary?.action ?? null;
  const actionId = params.actionId ?? inferSmartHandlingActionForCategory(params.categorySelection);
  const usedSuggestedReply =
    params.usedSuggestedReply ?? detectSuggestedReplyUsage(metadata?.suggested_reply, params.composedBody);

  if (!metadata && !actionId && usedSuggestedReply == null) {
    return null;
  }

  const intent: InboxInteractionIntent = {
    action_id: actionId ?? null,
    suggested_primary: suggestedPrimary,
    suggested_category: metadata?.category ?? params.categorySelection ?? null,
    matched_suggestion: actionId ? actionId === suggestedPrimary : null,
    used_suggested_reply: usedSuggestedReply,
    suggestion_version: metadata?.suggestion_version ?? null,
  };

  return intent;
}
