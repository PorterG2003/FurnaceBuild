/** Shared path helpers for inbox outbound attachment Storage keys. */

export const INBOX_ATTACHMENTS_BUCKET = 'inbox-attachments';

/** Strip unsafe filename characters; keep a usable extension when present. */
export function safeAttachmentFilename(filename: string): string {
  const trimmed = (filename || 'attachment').trim() || 'attachment';
  const sanitized = trimmed.replace(/[^\w.\-()+ ]+/g, '_').replace(/\s+/g, '_');
  return sanitized.slice(0, 180) || 'attachment';
}

/**
 * Object key shape: `{account_id}/{thread_id}/{upload_id}/{safeFilename}`
 */
export function buildInboxAttachmentStoragePath(params: {
  accountId: string;
  threadId: string;
  uploadId: string;
  filename: string;
}): string {
  const safe = safeAttachmentFilename(params.filename);
  return `${params.accountId}/${params.threadId}/${params.uploadId}/${safe}`;
}

export function parseInboxAttachmentPathPrefix(storagePath: string): {
  accountId: string;
  threadId: string;
  uploadId: string;
} | null {
  const parts = storagePath.split('/');
  if (parts.length < 4) return null;
  const [accountId, threadId, uploadId] = parts;
  if (!accountId || !threadId || !uploadId) return null;
  return { accountId, threadId, uploadId };
}

export type AttachmentDownloadMeta = {
  filename?: string;
  name?: string;
  contentType?: string;
  content_type?: string;
  size?: number;
  part?: string;
  imapUid?: number;
  storagePath?: string;
};

/** True when the inbox UI can offer Download for this attachment. */
export function canDownloadAttachment(
  att: AttachmentDownloadMeta,
  messageImapUid?: number | null
): boolean {
  if (att.storagePath) return true;
  const part = att.part;
  return !!part && (att.imapUid != null || messageImapUid != null);
}
