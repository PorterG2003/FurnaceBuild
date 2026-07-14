import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { openImapInbox } from '../../../lib/mailbox/imapInbox';
import { ImapFlow } from 'imapflow';
import {
  INBOX_ATTACHMENTS_BUCKET,
  buildInboxAttachmentStoragePath,
  safeAttachmentFilename,
} from '../../../lib/inbox/attachmentStoragePath';
import { randomUUID } from 'crypto';

/**
 * Inbox attachment Lambda (Function URL).
 *
 * Actions (POST JSON):
 * - prepare_upload — signed PUT + pending row
 * - delete_upload — remove pending upload
 * - fetch — download by attachment_index (Storage signed GET JSON, or IMAP binary)
 * - drain_gc — service secret; remove queued Storage objects
 *
 * Legacy: { email_message_id, part } without action still fetches IMAP by part.
 */

interface FunctionUrlEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string };
  };
}

interface FunctionUrlResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

type AttachmentRow = {
  filename?: string;
  name?: string;
  contentType?: string;
  content_type?: string;
  size?: number;
  part?: string;
  partId?: string;
  imapUid?: number;
  storagePath?: string;
  storage_path?: string;
};

type ParsedBody = Record<string, unknown>;

function parseBody(event: FunctionUrlEvent): ParsedBody {
  if (!event.body) {
    const params = new URLSearchParams(event.rawQueryString || '');
    const out: ParsedBody = {};
    params.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
    return JSON.parse(raw) as ParsedBody;
  } catch {
    return {};
  }
}

function getAuthHeader(event: FunctionUrlEvent): string | null {
  const auth = event.headers?.['authorization'] || event.headers?.['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function getHeader(event: FunctionUrlEvent, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

function response(
  statusCode: number,
  body?: string,
  headers?: Record<string, string>,
  isBase64Encoded?: boolean
): FunctionUrlResponse {
  const res: FunctionUrlResponse = { statusCode };
  if (headers) res.headers = headers;
  if (body !== undefined) res.body = body;
  if (isBase64Encoded) res.isBase64Encoded = true;
  return res;
}

function jsonResponse(statusCode: number, data: object): FunctionUrlResponse {
  return response(statusCode, JSON.stringify(data), {
    'Content-Type': 'application/json',
  });
}

async function requireUser(supabase: SupabaseClient, token: string) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function requireMembership(supabase: SupabaseClient, accountId: string, userId: string) {
  const { data } = await supabase
    .from('account_users')
    .select('id')
    .eq('account_id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

function attachmentStoragePath(att: AttachmentRow | null | undefined): string | null {
  if (!att) return null;
  return (att.storagePath || att.storage_path || '').trim() || null;
}

async function handlePrepareUpload(
  supabase: SupabaseClient,
  userId: string,
  body: ParsedBody
): Promise<FunctionUrlResponse> {
  const accountId = String(body.account_id || '');
  const threadId = String(body.thread_id || '');
  const filename = String(body.filename || 'attachment');
  const contentType = String(body.content_type || body.contentType || 'application/octet-stream');
  const size = Number(body.size ?? 0);

  if (!accountId || !threadId) {
    return jsonResponse(400, { error: 'Missing account_id or thread_id' });
  }

  if (!(await requireMembership(supabase, accountId, userId))) {
    return jsonResponse(403, { error: 'Access denied' });
  }

  const { data: thread } = await supabase
    .from('email_threads')
    .select('id, account_id')
    .eq('id', threadId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (!thread) {
    return jsonResponse(404, { error: 'Thread not found' });
  }

  const uploadId = randomUUID();
  const storagePath = buildInboxAttachmentStoragePath({
    accountId,
    threadId,
    uploadId,
    filename,
  });

  const { error: insertError } = await supabase.from('inbox_attachment_uploads').insert({
    account_id: accountId,
    thread_id: threadId,
    storage_path: storagePath,
    filename: safeAttachmentFilename(filename) === filename ? filename : filename,
    content_type: contentType,
    size: Number.isFinite(size) ? size : 0,
    status: 'pending',
    created_by: userId,
  });

  if (insertError) {
    console.error('prepare_upload insert failed', insertError);
    return jsonResponse(500, { error: 'Failed to record upload' });
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(INBOX_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signError || !signed) {
    console.error('prepare_upload signed URL failed', signError);
    await supabase.from('inbox_attachment_uploads').delete().eq('storage_path', storagePath);
    return jsonResponse(500, { error: 'Failed to create upload URL' });
  }

  return jsonResponse(200, {
    storagePath,
    uploadUrl: signed.signedUrl,
    token: signed.token,
    path: signed.path,
    filename,
    contentType,
  });
}

async function handleDeleteUpload(
  supabase: SupabaseClient,
  userId: string,
  body: ParsedBody
): Promise<FunctionUrlResponse> {
  const storagePath = String(body.storage_path || body.storagePath || '');
  if (!storagePath) {
    return jsonResponse(400, { error: 'Missing storage_path' });
  }

  const { data: upload } = await supabase
    .from('inbox_attachment_uploads')
    .select('*')
    .eq('storage_path', storagePath)
    .maybeSingle();

  if (!upload) {
    return jsonResponse(404, { error: 'Upload not found' });
  }

  if (!(await requireMembership(supabase, upload.account_id, userId))) {
    return jsonResponse(403, { error: 'Access denied' });
  }

  if (upload.status !== 'pending') {
    return jsonResponse(409, { error: `Upload cannot be deleted (status=${upload.status})` });
  }

  await supabase.storage.from(INBOX_ATTACHMENTS_BUCKET).remove([storagePath]);
  await supabase.from('inbox_attachment_gc_queue').delete().eq('storage_path', storagePath);
  await supabase.from('inbox_attachment_uploads').delete().eq('id', upload.id);

  return jsonResponse(200, { ok: true });
}

async function fetchViaImap(
  supabase: SupabaseClient,
  mailboxId: string,
  imapUid: number,
  part: string,
  filename: string,
  contentType: string
): Promise<FunctionUrlResponse> {
  const { data: mailbox, error: mailboxError } = await supabase
    .from('mailboxes')
    .select('id, imap_host, imap_port, imap_use_ssl, imap_username, imap_password')
    .eq('id', mailboxId)
    .maybeSingle();

  if (mailboxError || !mailbox) {
    return jsonResponse(502, { error: 'Mailbox not found or unavailable' });
  }

  const client = new ImapFlow({
    host: mailbox.imap_host,
    port: mailbox.imap_port,
    secure: mailbox.imap_use_ssl,
    auth: {
      user: mailbox.imap_username,
      pass: mailbox.imap_password,
    },
    logger: false,
  });

  try {
    await client.connect();
    await openImapInbox(client);

    const parsed = await client.download(imapUid, part, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of parsed.content) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const safeFilename = safeAttachmentFilename(filename);
    const encoded = buffer.toString('base64');

    return response(
      200,
      encoded,
      {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
      },
      true
    );
  } catch (imapError) {
    console.error('IMAP fetch error:', imapError);
    return jsonResponse(502, { error: 'Failed to fetch attachment from mailbox' });
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore
    }
  }
}

async function handleFetch(
  supabase: SupabaseClient,
  userId: string,
  body: ParsedBody
): Promise<FunctionUrlResponse> {
  const emailMessageId = String(body.email_message_id || '');
  const attachmentIndexRaw = body.attachment_index;
  const legacyPart = body.part != null ? String(body.part) : null;

  if (!emailMessageId) {
    return jsonResponse(400, { error: 'Missing email_message_id' });
  }

  const { data: emailMessage, error: msgError } = await supabase
    .from('email_messages')
    .select('id, thread_id, imap_uid, attachments')
    .eq('id', emailMessageId)
    .maybeSingle();

  if (msgError || !emailMessage) {
    return jsonResponse(404, { error: 'Message not found' });
  }

  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id, account_id, mailbox_id')
    .eq('id', emailMessage.thread_id)
    .maybeSingle();

  if (threadError || !thread) {
    return jsonResponse(404, { error: 'Thread not found' });
  }

  if (!(await requireMembership(supabase, thread.account_id, userId))) {
    return jsonResponse(403, { error: 'Access denied to this thread' });
  }

  const attachments = (Array.isArray(emailMessage.attachments) ? emailMessage.attachments : []) as AttachmentRow[];

  let attachment: AttachmentRow | null = null;
  let resolvedIndex = -1;

  if (attachmentIndexRaw != null && attachmentIndexRaw !== '') {
    const idx = Number(attachmentIndexRaw);
    if (!Number.isInteger(idx) || idx < 0 || idx >= attachments.length) {
      return jsonResponse(400, { error: 'Invalid attachment_index' });
    }
    attachment = attachments[idx];
    resolvedIndex = idx;
  } else if (legacyPart) {
    resolvedIndex = attachments.findIndex((a) => String(a.part ?? a.partId) === legacyPart);
    attachment = resolvedIndex >= 0 ? attachments[resolvedIndex] : null;
    if (!attachment) {
      // Legacy: allow fetch even if metadata missing part match
      attachment = { part: legacyPart, filename: 'attachment' };
    }
  } else {
    return jsonResponse(400, { error: 'Missing attachment_index' });
  }

  const filename = attachment?.filename ?? attachment?.name ?? 'attachment';
  const contentType = attachment?.contentType ?? attachment?.content_type ?? 'application/octet-stream';
  const storagePath = attachmentStoragePath(attachment);

  if (storagePath) {
    // Ownership: path must match message metadata (already from row)
    const { data: signed, error: signError } = await supabase.storage
      .from(INBOX_ATTACHMENTS_BUCKET)
      .createSignedUrl(storagePath, 120);

    if (signError || !signed?.signedUrl) {
      console.error('signed GET failed', signError);
      return jsonResponse(502, { error: 'Failed to create download URL' });
    }

    return jsonResponse(200, {
      url: signed.signedUrl,
      filename,
      contentType,
      attachment_index: resolvedIndex >= 0 ? resolvedIndex : undefined,
    });
  }

  const part = attachment?.part ?? attachment?.partId ?? legacyPart;
  const imapUid = emailMessage.imap_uid ?? attachment?.imapUid;
  if (imapUid == null || !part) {
    return jsonResponse(400, { error: 'Attachment is not downloadable' });
  }

  const mailboxId = (thread as { mailbox_id?: string }).mailbox_id;
  if (!mailboxId) {
    return jsonResponse(400, { error: 'Thread has no mailbox (cannot fetch attachment)' });
  }

  return fetchViaImap(supabase, mailboxId, imapUid, String(part), filename, contentType);
}

async function handleDrainGc(supabase: SupabaseClient, event: FunctionUrlEvent): Promise<FunctionUrlResponse> {
  const secret = process.env.INBOX_ATTACHMENT_GC_SECRET;
  const provided =
    getHeader(event, 'x-inbox-attachment-gc-secret') ||
    (parseBody(event).gc_secret != null ? String(parseBody(event).gc_secret) : null);

  if (!secret || !provided || provided !== secret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  // Enqueue expired pendings then drain queue
  await supabase.rpc('enqueue_expired_pending_inbox_attachments', { p_older_than_hours: 24 });

  const { data: queueRows, error } = await supabase
    .from('inbox_attachment_gc_queue')
    .select('storage_path')
    .order('enqueued_at', { ascending: true })
    .limit(100);

  if (error) {
    return jsonResponse(500, { error: error.message });
  }

  const paths = (queueRows ?? []).map((r) => r.storage_path as string).filter(Boolean);
  if (paths.length === 0) {
    return jsonResponse(200, { removed: 0 });
  }

  const { error: removeError } = await supabase.storage.from(INBOX_ATTACHMENTS_BUCKET).remove(paths);
  if (removeError) {
    console.error('drain_gc remove failed', removeError);
  }

  await supabase.from('inbox_attachment_gc_queue').delete().in('storage_path', paths);
  await supabase.from('inbox_attachment_uploads').delete().in('storage_path', paths);

  return jsonResponse(200, { removed: paths.length });
}

export const handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResponse> => {
  console.log('fetchEmailAttachment invoked');
  const method = event.requestContext?.http?.method;
  if (event.headers?.['access-control-request-method'] || method === 'OPTIONS') {
    return response(204, '');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error('Missing env: SUPABASE_URL or SUPABASE_SECRET_KEY');
    return jsonResponse(500, { error: 'Server configuration error' });
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseSecretKey);
  const body = parseBody(event);
  const action = String(body.action || 'fetch');

  if (action === 'drain_gc') {
    return handleDrainGc(supabase, event);
  }

  const token = getAuthHeader(event);
  if (!token) {
    return jsonResponse(401, { error: 'Missing or invalid Authorization header' });
  }

  const user = await requireUser(supabase, token);
  if (!user) {
    return jsonResponse(401, { error: 'Invalid or expired token' });
  }

  if (action === 'prepare_upload') {
    return handlePrepareUpload(supabase, user.id, body);
  }
  if (action === 'delete_upload') {
    return handleDeleteUpload(supabase, user.id, body);
  }

  // Default / fetch (also legacy part-based)
  return handleFetch(supabase, user.id, body);
};
