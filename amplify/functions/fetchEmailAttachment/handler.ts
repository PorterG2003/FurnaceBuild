import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { openImapInbox } from '../../../lib/mailbox/imapInbox';
import { ImapFlow } from 'imapflow';

/**
 * Lambda Function URL handler for fetching email attachments.
 *
 * Request: POST with JSON body { email_message_id, part } or GET with query params.
 * Headers: Authorization: Bearer <supabase_access_token>
 *
 * Returns: Binary attachment with Content-Type and Content-Disposition headers.
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

function parseRequest(event: FunctionUrlEvent): { emailMessageId: string; part: string } | null {
  const body = event.body;
  const queryString = event.rawQueryString || '';

  if (body) {
    try {
      const parsed = JSON.parse(event.isBase64Encoded ? Buffer.from(body, 'base64').toString() : body);
      if (parsed.email_message_id && parsed.part) {
        return { emailMessageId: parsed.email_message_id, part: String(parsed.part) };
      }
    } catch {
      // Fall through to query params
    }
  }

  const params = new URLSearchParams(queryString);
  const emailMessageId = params.get('email_message_id');
  const part = params.get('part');
  if (emailMessageId && part) {
    return { emailMessageId, part };
  }

  return null;
}

function getAuthHeader(event: FunctionUrlEvent): string | null {
  const auth = event.headers?.['authorization'] || event.headers?.['Authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

function response(statusCode: number, body?: string, headers?: Record<string, string>, isBase64Encoded?: boolean): FunctionUrlResponse {
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

  const token = getAuthHeader(event);
  if (!token) {
    return jsonResponse(401, { error: 'Missing or invalid Authorization header' });
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseSecretKey);

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse(401, { error: 'Invalid or expired token' });
  }
  const userId = user.id;

  const params = parseRequest(event);
  if (!params) {
    return jsonResponse(400, { error: 'Missing email_message_id or part' });
  }

  const { data: emailMessage, error: msgError } = await supabase
    .from('email_messages')
    .select('id, thread_id, imap_uid, attachments')
    .eq('id', params.emailMessageId)
    .maybeSingle();

  if (msgError || !emailMessage) {
    console.log('404: Message not found', {
      emailMessageId: params.emailMessageId,
      msgError: msgError?.message ?? null,
      found: !!emailMessage,
    });
    return jsonResponse(404, { error: 'Message not found' });
  }

  const imapUid = emailMessage.imap_uid ?? (emailMessage.attachments as any)?.[0]?.imapUid;
  if (imapUid == null) {
    return jsonResponse(400, { error: 'Message has no IMAP UID (cannot fetch attachment)' });
  }

  const { data: thread, error: threadError } = await supabase
    .from('email_threads')
    .select('id, account_id, mailbox_id')
    .eq('id', emailMessage.thread_id)
    .maybeSingle();

  if (threadError || !thread) {
    return jsonResponse(404, { error: 'Thread not found' });
  }

  const mailboxId = (thread as { mailbox_id?: string }).mailbox_id;
  if (!mailboxId) {
    return jsonResponse(400, { error: 'Thread has no mailbox (cannot fetch attachment)' });
  }

  // User id from JWT (Supabase auth.uid()); verify account membership
  const { data: membership } = await supabase
    .from('account_users')
    .select('id')
    .eq('account_id', thread.account_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!membership) {
    console.log('403: Access denied to this thread', { userId, accountId: thread.account_id });
    return jsonResponse(403, { error: 'Access denied to this thread' });
  }

  const attachments = (emailMessage.attachments as any) ?? [];
  const attachment = Array.isArray(attachments)
    ? attachments.find((a: any) => String(a.part ?? a.partId) === params.part)
    : null;
  const filename = attachment?.filename ?? attachment?.name ?? 'attachment';
  const contentType = attachment?.contentType ?? attachment?.content_type ?? 'application/octet-stream';

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

    const parsed = await client.download(imapUid, params.part, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of parsed.content) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    const safeFilename = filename.replace(/[^\w.-]/g, '_') || 'attachment';
    const encoded = buffer.toString('base64');

    return response(200, encoded, {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    }, true);
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
};
