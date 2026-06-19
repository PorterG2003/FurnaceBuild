import type { EmailMessage } from '@/lib/supabase/types';

export type ReplaceLeadCompletionIntent = 'replace_and_forward' | 'replace_only';

export interface ReplaceLeadForwardTarget {
  toEmail: string;
  toName: string | null;
}

export interface ReplaceLeadCompletionPayload {
  intent: ReplaceLeadCompletionIntent;
  preferredForwardMessageId?: string | null;
  forwardTarget?: ReplaceLeadForwardTarget | null;
}

export interface ReplaceLeadFollowUpAction {
  kind: 'open_forward_composer';
  preferredForwardMessageId: string | null;
  target: ReplaceLeadForwardTarget;
}

function normalizeForwardTarget(
  target: ReplaceLeadForwardTarget | null | undefined
): ReplaceLeadForwardTarget | null {
  const toEmail = target?.toEmail?.trim().toLowerCase() ?? '';
  if (!toEmail) return null;

  const trimmedName = target?.toName?.trim() ?? '';
  return {
    toEmail,
    toName: trimmedName || null,
  };
}

export function buildReplaceLeadFollowUpAction(
  payload: ReplaceLeadCompletionPayload | null | undefined
): ReplaceLeadFollowUpAction | null {
  if (!payload || payload.intent !== 'replace_and_forward') return null;

  const target = normalizeForwardTarget(payload.forwardTarget);
  if (!target) return null;

  return {
    kind: 'open_forward_composer',
    preferredForwardMessageId: payload.preferredForwardMessageId ?? null,
    target,
  };
}

export function resolveReplaceLeadForwardMessage(
  messages: EmailMessage[],
  preferredForwardMessageId?: string | null
): EmailMessage | null {
  if (preferredForwardMessageId) {
    const preferredMessage = messages.find((message) => message.id === preferredForwardMessageId) ?? null;
    if (preferredMessage) return preferredMessage;
  }

  const latestReceived =
    [...messages]
      .filter((message) => message.direction === 'received')
      .sort((left, right) => new Date(right.received_at).getTime() - new Date(left.received_at).getTime())[0] ?? null;
  if (latestReceived) return latestReceived;

  return (
    [...messages].sort(
      (left, right) => new Date(right.received_at).getTime() - new Date(left.received_at).getTime()
    )[0] ?? null
  );
}
