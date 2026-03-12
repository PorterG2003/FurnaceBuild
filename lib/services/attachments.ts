import { reportErrorToSlack } from '../slack/reportErrorToSlack';

/**
 * Fetch an email attachment from the Lambda Function URL.
 * Returns the raw bytes as a Blob (web).
 *
 * @param functionUrl - Lambda Function URL from amplify_outputs.custom.fetchEmailAttachmentUrl
 * @param authToken - Supabase access token (e.g. from getAccessToken())
 * @param emailMessageId - email_messages.id
 * @param part - MIME part identifier (e.g. "1", "1.2")
 */
export async function fetchAttachment(
  functionUrl: string,
  authToken: string,
  emailMessageId: string,
  part: string
): Promise<Blob> {
  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ email_message_id: emailMessageId, part }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errMsg = (err as { error?: string }).error || `Failed to fetch attachment: ${res.status}`;
    reportErrorToSlack('Failed to fetch email attachment', {
      severity: 'warning',
      email_message_id: emailMessageId,
      part,
      error: errMsg,
    });
    throw new Error(errMsg);
  }

  return res.blob();
}
