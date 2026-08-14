import type { EmailMessage } from '@/lib/supabase/types';

export type MessageCursor = {
  receivedAt: string;
  id: string;
};

export type ThreadMessagesPage = {
  /** Chronological (oldest → newest) for display. */
  messages: EmailMessage[];
  hasOlder: boolean;
  oldestCursor: MessageCursor | null;
  newestCursor: MessageCursor | null;
};

export function messageCursorFrom(message: Pick<EmailMessage, 'id' | 'received_at'>): MessageCursor {
  return { receivedAt: message.received_at, id: message.id };
}

export function compareMessagesChronological(
  a: Pick<EmailMessage, 'id' | 'received_at'>,
  b: Pick<EmailMessage, 'id' | 'received_at'>,
): number {
  const byTime = a.received_at.localeCompare(b.received_at);
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

function isStrictlyOlderThanCursor(
  message: Pick<EmailMessage, 'id' | 'received_at'>,
  cursor: MessageCursor,
): boolean {
  if (message.received_at < cursor.receivedAt) return true;
  if (message.received_at > cursor.receivedAt) return false;
  return message.id < cursor.id;
}

/** Merge a refreshed newest page into already-loaded older history. */
export function mergeNewestMessagesPage(
  existing: EmailMessage[],
  page: ThreadMessagesPage,
  previousHasOlder: boolean,
): { messages: EmailMessage[]; hasOlder: boolean; oldestCursor: MessageCursor | null } {
  if (!page.hasOlder) {
    return {
      messages: page.messages,
      hasOlder: false,
      oldestCursor: page.oldestCursor,
    };
  }

  const pageIds = new Set(page.messages.map((message) => message.id));
  const pageOldest = page.oldestCursor;
  const olderKept =
    pageOldest == null
      ? []
      : existing.filter(
          (message) => !pageIds.has(message.id) && isStrictlyOlderThanCursor(message, pageOldest),
        );

  const byId = new Map<string, EmailMessage>();
  for (const message of olderKept) byId.set(message.id, message);
  for (const message of page.messages) byId.set(message.id, message);

  const messages = [...byId.values()].sort(compareMessagesChronological);
  const oldest = messages[0] ?? null;
  return {
    messages,
    hasOlder: olderKept.length > 0 ? previousHasOlder : page.hasOlder,
    oldestCursor: oldest ? messageCursorFrom(oldest) : null,
  };
}

/** Prepend an older page onto the currently loaded messages. */
export function mergeOlderMessagesPage(
  existing: EmailMessage[],
  page: ThreadMessagesPage,
): { messages: EmailMessage[]; hasOlder: boolean; oldestCursor: MessageCursor | null } {
  const byId = new Map<string, EmailMessage>();
  for (const message of page.messages) byId.set(message.id, message);
  for (const message of existing) byId.set(message.id, message);
  const messages = [...byId.values()].sort(compareMessagesChronological);
  const oldest = messages[0] ?? null;
  return {
    messages,
    hasOlder: page.hasOlder,
    oldestCursor: oldest ? messageCursorFrom(oldest) : null,
  };
}
