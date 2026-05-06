import { getDisplayBody } from '@/lib/email';
import type { EmailThread } from '@/lib/supabase/types';

const DEFAULT_SNIPPET_MAX_LENGTH = 100;

interface ResolveThreadRecipientEmailOptions {
  thread: Pick<EmailThread, 'participants'>;
  leadEmail?: string | null;
  mailboxEmail?: string | null;
}

interface ResolveThreadCardTitleOptions extends ResolveThreadRecipientEmailOptions {
  leadDisplayName?: string | null;
  subject?: string | null;
  fallbackTitle?: string;
}

export interface ThreadSnippetRow {
  thread_id: string;
  direction: string | null;
  body_text: string | null;
  body_html: string | null;
}

function normalizeValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveThreadRecipientEmail({
  thread,
  leadEmail,
  mailboxEmail,
}: ResolveThreadRecipientEmailOptions): string | null {
  const normalizedLeadEmail = normalizeValue(leadEmail);
  if (normalizedLeadEmail) return normalizedLeadEmail;

  const normalizedMailboxEmail = normalizeValue(mailboxEmail)?.toLowerCase() ?? null;
  for (const participant of thread.participants ?? []) {
    const normalizedParticipant = normalizeValue(participant);
    if (!normalizedParticipant) continue;
    if (
      normalizedMailboxEmail &&
      normalizedParticipant.toLowerCase() === normalizedMailboxEmail
    ) {
      continue;
    }
    return normalizedParticipant;
  }

  return null;
}

export function resolveThreadCardTitle({
  thread,
  leadDisplayName,
  leadEmail,
  mailboxEmail,
  subject,
  fallbackTitle = 'Conversation',
}: ResolveThreadCardTitleOptions): string {
  const normalizedLeadDisplayName = normalizeValue(leadDisplayName);
  if (normalizedLeadDisplayName) return normalizedLeadDisplayName;

  return (
    resolveThreadRecipientEmail({ thread, leadEmail, mailboxEmail }) ??
    normalizeValue(subject) ??
    fallbackTitle
  );
}

export function toThreadSnippetText(
  row: Pick<ThreadSnippetRow, 'body_text' | 'body_html'>,
  maxLength = DEFAULT_SNIPPET_MAX_LENGTH
): string | null {
  const hasText = row.body_text != null && row.body_text.trim().length > 0;
  const body = hasText ? row.body_text! : (row.body_html ?? '');
  const display = getDisplayBody(body, { format: hasText ? 'text' : 'html' });
  const oneline = display.replace(/\s+/g, ' ').trim();
  if (!oneline) return null;
  return oneline.slice(0, maxLength);
}

export function buildThreadSnippetMap(
  rows: ThreadSnippetRow[],
  maxLength = DEFAULT_SNIPPET_MAX_LENGTH
): Record<string, string> {
  const fallbackSnippets: Record<string, string> = {};
  const receivedSnippets: Record<string, string> = {};

  for (const row of rows) {
    const snippet = toThreadSnippetText(row, maxLength);
    if (!snippet) continue;

    if (!(row.thread_id in fallbackSnippets)) {
      fallbackSnippets[row.thread_id] = snippet;
    }
    if (row.direction === 'received' && !(row.thread_id in receivedSnippets)) {
      receivedSnippets[row.thread_id] = snippet;
    }
  }

  return { ...fallbackSnippets, ...receivedSnippets };
}
