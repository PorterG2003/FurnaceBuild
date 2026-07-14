import { supabase } from '../../client';
import type { EmailThread, EmailMessage } from '../../types';

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

export async function getMessagesByThread(threadId: string): Promise<EmailMessage[]> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
  return data ?? [];
}
