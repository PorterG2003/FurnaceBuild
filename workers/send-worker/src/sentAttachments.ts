import type { SupabaseClient } from '@supabase/supabase-js';

export const INBOX_ATTACHMENTS_BUCKET = 'inbox-attachments';

export type ResolvedSendAttachment = {
  filename: string;
  contentType: string;
  size: number;
  storagePath?: string;
  /** base64 content for nodemailer (downloaded from Storage or legacy job payload) */
  content: string;
};

/**
 * Resolve message_data.attachments into bytes for SMTP.
 * Prefers storagePath (download); falls back to legacy base64 `content`.
 */
export async function resolveSendAttachments(
  supabase: SupabaseClient,
  rawAttachments: unknown[]
): Promise<ResolvedSendAttachment[]> {
  const out: ResolvedSendAttachment[] = [];

  for (const raw of rawAttachments) {
    const a = raw as {
      filename?: string;
      contentType?: string;
      content_type?: string;
      size?: number;
      storagePath?: string;
      storage_path?: string;
      content?: string;
    };
    const filename = a.filename ?? 'attachment';
    const contentType = a.contentType ?? a.content_type ?? 'application/octet-stream';
    const storagePath = (a.storagePath || a.storage_path || '').trim() || undefined;

    if (storagePath) {
      const { data, error } = await supabase.storage.from(INBOX_ATTACHMENTS_BUCKET).download(storagePath);
      if (error || !data) {
        throw new Error(
          `Failed to download attachment from Storage (${storagePath}): ${error?.message ?? 'missing data'}`
        );
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      out.push({
        filename,
        contentType,
        size: a.size ?? buffer.length,
        storagePath,
        content: buffer.toString('base64'),
      });
      continue;
    }

    if (typeof a.content === 'string' && a.content.length > 0) {
      out.push({
        filename,
        contentType,
        size: a.size ?? Buffer.from(a.content, 'base64').length,
        content: a.content,
      });
      continue;
    }
  }

  return out;
}

export function buildSentAttachmentMetadata(
  attachments: ResolvedSendAttachment[]
): Array<{ filename: string; contentType: string; size: number; storagePath?: string }> {
  return attachments.map((att) => ({
    filename: att.filename,
    contentType: att.contentType,
    size: att.size,
    ...(att.storagePath ? { storagePath: att.storagePath } : {}),
  }));
}

export async function markAttachmentUploadsSent(
  supabase: SupabaseClient,
  attachments: ResolvedSendAttachment[]
): Promise<void> {
  const paths = attachments.map((a) => a.storagePath).filter((p): p is string => !!p);
  if (paths.length === 0) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('inbox_attachment_uploads')
    .update({ status: 'sent', sent_at: now })
    .in('storage_path', paths)
    .in('status', ['claimed', 'pending']);
  if (error) {
    console.warn(`[SEND WORKER] Failed to mark attachment uploads sent: ${error.message}`);
  }
}

/** Drain a batch of GC queue rows (Storage remove + row cleanup). */
export async function drainInboxAttachmentGcQueue(
  supabase: SupabaseClient,
  limit = 50
): Promise<number> {
  await supabase.rpc('enqueue_expired_pending_inbox_attachments', { p_older_than_hours: 24 });

  const { data: queueRows, error } = await supabase
    .from('inbox_attachment_gc_queue')
    .select('storage_path')
    .order('enqueued_at', { ascending: true })
    .limit(limit);

  if (error) {
    console.warn(`[SEND WORKER] GC queue select failed: ${error.message}`);
    return 0;
  }

  const paths = (queueRows ?? []).map((r) => r.storage_path as string).filter(Boolean);
  if (paths.length === 0) return 0;

  const { error: removeError } = await supabase.storage.from(INBOX_ATTACHMENTS_BUCKET).remove(paths);
  if (removeError) {
    console.warn(`[SEND WORKER] GC Storage remove failed: ${removeError.message}`);
  }

  await supabase.from('inbox_attachment_gc_queue').delete().in('storage_path', paths);
  await supabase.from('inbox_attachment_uploads').delete().in('storage_path', paths);
  return paths.length;
}
