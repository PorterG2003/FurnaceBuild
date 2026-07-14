import { reportErrorToSlack } from '../slack/reportErrorToSlack';
import { INBOX_ATTACHMENTS_BUCKET } from '../inbox/attachmentStoragePath';

export type PrepareUploadResult = {
  storagePath: string;
  uploadUrl: string;
  token: string;
  filename: string;
  contentType: string;
};

async function postAttachmentAction(
  functionUrl: string,
  authToken: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Mint a signed upload URL and pending inbox_attachment_uploads row.
 */
export async function prepareAttachmentUpload(
  functionUrl: string,
  authToken: string,
  params: {
    accountId: string;
    threadId: string;
    filename: string;
    contentType: string;
    size: number;
  }
): Promise<PrepareUploadResult> {
  const res = await postAttachmentAction(functionUrl, authToken, {
    action: 'prepare_upload',
    account_id: params.accountId,
    thread_id: params.threadId,
    filename: params.filename,
    content_type: params.contentType,
    size: params.size,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `prepare_upload failed: ${res.status}`);
  }
  return res.json() as Promise<PrepareUploadResult>;
}

/**
 * Delete a pending upload (composer remove).
 */
export async function deleteAttachmentUpload(
  functionUrl: string,
  authToken: string,
  storagePath: string
): Promise<void> {
  const res = await postAttachmentAction(functionUrl, authToken, {
    action: 'delete_upload',
    storage_path: storagePath,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error || `delete_upload failed: ${res.status}`);
  }
}

/**
 * Upload bytes to a signed upload URL from prepare_upload.
 * Uses Supabase signed upload token when present; otherwise PUT to signedUrl.
 */
export async function uploadToSignedUrl(
  uploadUrl: string,
  file: Blob | ArrayBuffer | Uint8Array,
  contentType: string,
  token?: string
): Promise<void> {
  // Prefer Supabase storage.uploadToSignedUrl pattern via fetch with token query already in uploadUrl.
  const body = file instanceof Blob ? file : file instanceof ArrayBuffer ? file : new Uint8Array(file);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      ...(token ? { 'x-upsert': 'true' } : {}),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
}

/**
 * Fetch an email attachment. Always returns a Blob.
 * Uses attachment_index; Lambda returns signed URL JSON (Storage) or binary (IMAP).
 */
export async function fetchAttachment(
  functionUrl: string,
  authToken: string,
  emailMessageId: string,
  attachmentIndex: number
): Promise<Blob> {
  const res = await postAttachmentAction(functionUrl, authToken, {
    action: 'fetch',
    email_message_id: emailMessageId,
    attachment_index: attachmentIndex,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errMsg = (err as { error?: string }).error || `Failed to fetch attachment: ${res.status}`;
    reportErrorToSlack('Failed to fetch email attachment', {
      severity: 'warning',
      email_message_id: emailMessageId,
      attachment_index: attachmentIndex,
      error: errMsg,
    });
    throw new Error(errMsg);
  }

  const contentType = (res.headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      throw new Error('Missing signed download URL');
    }
    const fileRes = await fetch(data.url);
    if (!fileRes.ok) {
      throw new Error(`Failed to download attachment bytes: ${fileRes.status}`);
    }
    return fileRes.blob();
  }

  return res.blob();
}

export { INBOX_ATTACHMENTS_BUCKET };
