import { supabase } from '../../client';
import type { EmailMessage } from '../../types';
import {
  messageCursorFrom,
  type MessageCursor,
  type ThreadMessagesPage,
} from '@/lib/inbox/messagePagination';

export type { MessageCursor, ThreadMessagesPage } from '@/lib/inbox/messagePagination';
export {
  messageCursorFrom,
  compareMessagesChronological,
  mergeNewestMessagesPage,
  mergeOlderMessagesPage,
} from '@/lib/inbox/messagePagination';

/** Attachment metadata stored on email_messages */
export interface AttachmentMeta {
  filename: string;
  contentType?: string;
  content_type?: string;
  size?: number;
  part?: string;
  imapUid?: number;
  /** Outbound (Storage-backed) path in inbox-attachments bucket */
  storagePath?: string;
}

/** Attachment for sending (reply/forward): Storage ref only (no base64) */
export interface SendAttachment {
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
}

/** Columns required for inbox rendering, attachments, and reply/forward. */
export const INBOX_MESSAGE_SELECT =
  'id, thread_id, account_id, message_job_id, direction, from_email, from_name, to_email, to_name, to_emails, cc, subject, body_text, body_html, received_at, read_at, attachments, imap_uid';

export const MESSAGE_PAGE_SIZE = 50;

/**
 * Fetch a page of thread messages, newest-first from the DB, returned chronological.
 * Pass `before` to load older history relative to the current oldest visible message.
 */
export async function getMessagesByThreadPage(
  threadId: string,
  options?: {
    limit?: number;
    before?: MessageCursor | null;
    /** Override for tests (service-role harness client). */
    client?: typeof supabase;
  },
): Promise<ThreadMessagesPage> {
  const limit = Math.max(1, Math.min(options?.limit ?? MESSAGE_PAGE_SIZE, 200));
  const before = options?.before ?? null;
  const db = options?.client ?? supabase;

  let query = db
    .from('email_messages')
    .select(INBOX_MESSAGE_SELECT)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (before) {
    // Keyset: (received_at, id) < (before.receivedAt, before.id) under DESC ordering.
    const receivedAt = `"${before.receivedAt.replace(/"/g, '\\"')}"`;
    const id = `"${before.id.replace(/"/g, '\\"')}"`;
    query = query.or(
      `received_at.lt.${receivedAt},and(received_at.eq.${receivedAt},id.lt.${id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);

  const rows = (data ?? []) as EmailMessage[];
  const hasOlder = rows.length > limit;
  const pageDesc = hasOlder ? rows.slice(0, limit) : rows;
  const messages = [...pageDesc].reverse();
  const oldest = messages[0] ?? null;
  const newest = messages[messages.length - 1] ?? null;

  return {
    messages,
    hasOlder,
    oldestCursor: oldest ? messageCursorFrom(oldest) : null,
    newestCursor: newest ? messageCursorFrom(newest) : null,
  };
}

/**
 * Full-thread fetch with a narrow column projection.
 * Prefer {@link getMessagesByThreadPage} for inbox UI.
 */
export async function getMessagesByThread(threadId: string): Promise<EmailMessage[]> {
  const { data, error } = await supabase
    .from('email_messages')
    .select(INBOX_MESSAGE_SELECT)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
  return (data ?? []) as EmailMessage[];
}
