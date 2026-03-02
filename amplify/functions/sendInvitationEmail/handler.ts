import { reportErrorToSlack } from '@furnace/slack-lib';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import type { Schema } from '../../data/resource';

const resend = new Resend(process.env.RESEND_API_KEY);

function isFunctionUrlEvent(event: any): event is { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean } {
  return event && typeof event.headers === 'object' && !event.arguments;
}

async function sendInvitationEmailLogic(args: {
  to: string;
  inviterName: string;
  inviterEmail: string;
  accountName: string;
  acceptUrl?: string;
}) {
  const { to, inviterName, inviterEmail, accountName, acceptUrl } = args;

  if (!to || !inviterName || !accountName) {
    throw new Error('Missing required fields: to, inviterName, and accountName are required');
  }

  const defaultAcceptUrl = acceptUrl || 'https://your-app-url.com/accept-invitation';

  const { data, error } = await resend.emails.send({
    from: 'Furnace <porter@getfurnace.io>',
    to: [to],
    subject: `You've been invited to join ${accountName} on Furnace`,
    html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Team Invitation</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #f33203 0%, #f85102 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">You've been invited!</h1>
            </div>
            <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e5e5; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                <strong>${inviterName}</strong> (${inviterEmail}) has invited you to join <strong>${accountName}</strong> on Furnace.
              </p>
              <p style="font-size: 16px; margin-bottom: 30px;">
                Furnace helps you build and manage automated lead generation campaigns. Click the button below to accept the invitation and get started.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${defaultAcceptUrl}" style="display: inline-block; background: #f33203; color: white; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                  Accept Invitation
                </a>
              </div>
              <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e5e5;">
                If you didn't expect this invitation, you can safely ignore this email.
              </p>
            </div>
            <div style="text-align: center; margin-top: 20px; color: #999; font-size: 12px;">
              <p>This email was sent by Furnace</p>
            </div>
          </body>
        </html>
      `,
    text: `
You've been invited to join ${accountName} on Furnace

${inviterName} (${inviterEmail}) has invited you to join ${accountName} on Furnace.

Furnace helps you build and manage automated lead generation campaigns.

Accept your invitation: ${defaultAcceptUrl}

If you didn't expect this invitation, you can safely ignore this email.
      `.trim(),
  });

  if (error) {
    console.error('Resend error:', error);
    throw new Error(`Failed to send email: ${JSON.stringify(error)}`);
  }

  return { success: true, messageId: data?.id || '', message: 'Invitation email sent successfully' };
}

export const handler = async (event: Parameters<Schema['sendInvitationEmail']['functionHandler']>[0] | { headers: Record<string, string>; body?: string | null; isBase64Encoded?: boolean }) => {
  const isUrlInvocation = isFunctionUrlEvent(event);
  try {
    if (isUrlInvocation) {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
      if (!supabaseUrl || !supabaseSecretKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
      }
      const auth = event.headers?.authorization || event.headers?.Authorization;
      const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
      if (!token) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Missing or invalid Authorization header' }) };
      }
      const supabase = createClient(supabaseUrl, supabaseSecretKey);
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
      }
      const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body) : '{}';
      const args = JSON.parse(body) as { to: string; inviterName: string; inviterEmail: string; accountName: string; acceptUrl?: string };
      const result = await sendInvitationEmailLogic(args);
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    const { to, inviterName, inviterEmail, accountName, acceptUrl } = event.arguments;
    const result = await sendInvitationEmailLogic({ to, inviterName, inviterEmail, accountName, acceptUrl: acceptUrl ?? undefined });
    return result;
  } catch (error) {
    console.error('Handler error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    reportErrorToSlack('Send invitation email failed', { severity: 'warning', error: msg });
    if (isUrlInvocation) {
      return { statusCode: 500, body: JSON.stringify({ error: msg }) };
    }
    throw error;
  }
};
